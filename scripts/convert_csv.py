#!/usr/bin/env python3
"""
Convierte Result_XXX.csv → public/data.json con tipo de cambio USD histórico.
Uso: python3 scripts/convert_csv.py [ruta/al/archivo.csv]
     Si no se pasa ruta busca automáticamente ~/Downloads/Result_*.csv más reciente.
"""
import csv, json, sys, os, ssl, urllib.request, glob
from datetime import datetime

# ── Paths ─────────────────────────────────────────────────────────────────────
SCRIPT_DIR  = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
OUTPUT_PATH = os.path.join(PROJECT_DIR, 'public', 'data.json')

def find_latest_csv():
    pattern = os.path.expanduser('~/Downloads/Result_*.csv')
    files   = glob.glob(pattern)
    if not files:
        return None
    return max(files, key=os.path.getmtime)

INPUT = sys.argv[1] if len(sys.argv) > 1 else find_latest_csv()
if not INPUT or not os.path.exists(INPUT):
    print("ERROR: No se encontró el CSV. Pasalo como argumento: python3 scripts/convert_csv.py archivo.csv")
    sys.exit(1)

print(f"📂 Leyendo: {INPUT}")

# ── 1. Leer CSV ───────────────────────────────────────────────────────────────
def clean(val):
    v = val.strip()
    return '' if v.lower() == 'null' else v

def parse_row(row):
    """Detecta el formato del CSV (nuevo vs viejo) y devuelve un dict normalizado."""
    raw = row[0].strip()
    fecha_str, hora_str, new_fmt = '', '', False

    # Formato NUEVO: "2026-02-26 03:50:04.057000" (datetime completo en col 0)
    for fmt in ('%Y-%m-%d %H:%M:%S.%f', '%Y-%m-%d %H:%M:%S', '%Y-%m-%d'):
        try:
            dt        = datetime.strptime(raw, fmt)
            fecha_str = dt.strftime('%Y-%m-%d')
            hora_str  = dt.strftime('%H:%M:%S')
            new_fmt   = True
            break
        except ValueError:
            pass

    if not new_fmt:
        # Formato VIEJO: col 0 = dd/mm/yyyy, col 1 = hora
        try:
            fecha_str = datetime.strptime(raw, '%d/%m/%Y').strftime('%Y-%m-%d')
        except ValueError:
            fecha_str = raw
        hora_str = row[1].strip() if len(row) > 1 else ''

    fecha_hora = f"{fecha_str}T{hora_str}" if fecha_str and hora_str else fecha_str

    def g(i): return clean(row[i]) if len(row) > i else ''

    if new_fmt:
        # Nuevo esquema de columnas:
        # 0:datetime  1:empresa  2:unique_code  3:grupo  4:v_nombre  5:v_apellido
        # 6:ap_nombre 7:ap_apellido  8:canal  9:proveedor  10:monto  11:moneda
        # 12:producto  13:aprobado  14:estado  15:pnr  16:viaje_iniciado
        try:    monto = float(row[10].strip()) if len(row) > 10 and row[10].strip() else 0.0
        except: monto = 0.0
        return {
            'fecha':              fecha_str,
            'hora':               hora_str,
            'fecha_hora':         fecha_hora,
            'empresa':            g(1),
            'unique_code':        g(2),
            'grupo':              g(3),
            'viajero_nombre':     g(4),
            'viajero_apellido':   g(5),
            'viajero':            f"{g(4)} {g(5)}".strip(),
            'aprobador_nombre':   g(6),
            'aprobador_apellido': g(7),
            'aprobador':          f"{g(6)} {g(7)}".strip(),
            'canal':              g(8),
            'proveedor':          g(9),
            'monto':              monto,
            'moneda':             g(11),
            'producto':           g(12),
            'aprobado':           g(13),
            'estado':             g(14),
            'pnr':                g(15),
            'viaje_iniciado':     g(16),
            'mail':               '',
            'error_message':      '',
            'monto_usd':          None,
            'fx_rate':            None,
        }
    else:
        # Viejo esquema de columnas:
        # 0:fecha  1:hora  2:producto  3:pnr  4:grupo  5:mail  6:empresa
        # 7:estado  8:aprobado  9:proveedor  10:unique_code  11:v_nombre
        # 12:v_apellido  13:ap_nombre  14:ap_apellido  15:canal  16:monto
        # 17:moneda  18:error_message  19:viaje_iniciado
        try:    monto = float(row[16].strip()) if len(row) > 16 and row[16].strip() else 0.0
        except: monto = 0.0
        return {
            'fecha':              fecha_str,
            'hora':               hora_str,
            'fecha_hora':         fecha_hora,
            'producto':           g(2),
            'pnr':                g(3),
            'grupo':              g(4),
            'mail':               g(5),
            'empresa':            g(6),
            'estado':             g(7),
            'aprobado':           g(8),
            'proveedor':          g(9),
            'unique_code':        g(10),
            'viajero_nombre':     g(11),
            'viajero_apellido':   g(12),
            'viajero':            f"{g(11)} {g(12)}".strip(),
            'aprobador_nombre':   g(13),
            'aprobador_apellido': g(14),
            'aprobador':          f"{g(13)} {g(14)}".strip(),
            'canal':              g(15),
            'monto':              monto,
            'moneda':             g(17),
            'error_message':      g(18),
            'viaje_iniciado':     g(19),
            'monto_usd':          None,
            'fx_rate':            None,
        }

reservas = []
with open(INPUT, encoding='utf-8') as f:
    for row in csv.reader(f):
        if not any(v.strip() for v in row[:10]):
            continue
        reservas.append(parse_row(row))

# ── 2. Deduplicar ─────────────────────────────────────────────────────────────
seen, deduped = set(), []
for r in reservas:
    key = (r['pnr'], r['producto'], r['viajero'], r['fecha'], r['hora'])
    if key not in seen:
        seen.add(key)
        deduped.append(r)

removed = len(reservas) - len(deduped)
if removed:
    print(f"🔁 {removed} duplicados eliminados")
reservas = deduped
reservas.sort(key=lambda x: x['fecha_hora'], reverse=True)
print(f"✅ {len(reservas)} reservas procesadas")

# ── 3. Tipo de cambio histórico ───────────────────────────────────────────────
dates  = sorted(set(r['fecha'] for r in reservas if r['fecha']))
ctx    = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode    = ssl.CERT_NONE

fx_cache = {}
print(f"\n💱 Obteniendo tipo de cambio para {len(dates)} fechas...")
for d in dates:
    url = f"https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@{d}/v1/currencies/usd.json"
    try:
        with urllib.request.urlopen(url, timeout=8, context=ctx) as resp:
            fx_cache[d] = json.loads(resp.read())['usd']
        rates = fx_cache[d]
        print(f"  {d} ✓  1 USD = {rates.get('ars','?'):>10,.0f} ARS | {rates.get('brl','?'):>6.2f} BRL | {rates.get('mxn','?'):>6.2f} MXN | {rates.get('clp','?'):>8,.0f} CLP | {rates.get('cop','?'):>8,.0f} COP")
    except Exception as e:
        print(f"  {d} ✗  Error: {e}")

# ── 4. Aplicar conversión ─────────────────────────────────────────────────────
converted, skipped = 0, 0
for r in reservas:
    moneda = r.get('moneda', '').lower()
    fecha  = r.get('fecha', '')
    monto  = r.get('monto', 0)
    rates  = fx_cache.get(fecha)

    if not monto or not moneda or not rates:
        skipped += 1
        continue

    if moneda == 'usd':
        r['monto_usd'] = round(monto, 2)
        r['fx_rate']   = 1.0
        converted += 1
    elif moneda in rates:
        r['monto_usd'] = round(monto / rates[moneda], 2)
        r['fx_rate']   = round(rates[moneda], 4)
        converted += 1
    else:
        skipped += 1

print(f"\n💵 {converted} reservas con monto_usd | {skipped} sin conversión (sin monto o moneda desconocida)")

# ── 5. Guardar ────────────────────────────────────────────────────────────────
output = {
    'last_updated': datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ'),
    'fx_enriched':  datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ'),
    'total':        len(reservas),
    'reservas':     reservas,
}
os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
    json.dump(output, f, ensure_ascii=False)

print(f"\n🚀 Listo → {OUTPUT_PATH}")
print(f"   {len(reservas)} reservas · Actualizado: {output['last_updated'][:19]}")
