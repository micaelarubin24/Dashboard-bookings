#!/usr/bin/env python3
"""
Enrich data.json with USD amount at historical FX rates (rate of the booking date).
API: cdn.jsdelivr.net/npm/@fawazahmed0/currency-api — free, no auth, 150+ currencies.

Run: python3 scripts/enrich_fx.py
"""
import os, json, urllib.request, ssl
from datetime import datetime

_ctx = ssl.create_default_context()
_ctx.check_hostname = False
_ctx.verify_mode    = ssl.CERT_NONE

PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_PATH   = os.path.join(PROJECT_DIR, 'public', 'data.json')

with open(DATA_PATH, encoding='utf-8') as f:
    data = json.load(f)

reservas = data['reservas']
dates    = sorted(set(r['fecha'] for r in reservas if r['fecha']))
print(f"Fetching historical FX rates for {len(dates)} dates...")

fx_cache = {}   # date -> { 'ars': 1407.34, 'brl': 5.26, ... }  (all rates relative to 1 USD)
for d in dates:
    url = f"https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@{d}/v1/currencies/usd.json"
    try:
        with urllib.request.urlopen(url, timeout=8, context=_ctx) as resp:
            fx_cache[d] = json.loads(resp.read())['usd']
        print(f"  {d} OK  —  1 USD = {fx_cache[d].get('ars', '?'):.0f} ARS | {fx_cache[d].get('brl', '?'):.2f} BRL")
    except Exception as e:
        print(f"  {d} FAILED: {e}")

converted, skipped = 0, 0
for r in reservas:
    r['monto_usd'] = None
    r['fx_rate']   = None
    if not r.get('monto') or not r.get('moneda') or not r.get('fecha'):
        skipped += 1
        continue
    rates  = fx_cache.get(r['fecha'])
    moneda = r['moneda'].lower()
    if not rates:
        skipped += 1
        continue
    if moneda == 'usd':
        r['monto_usd'] = round(r['monto'], 2)
        r['fx_rate']   = 1.0
        converted += 1
    elif moneda in rates:
        rate           = rates[moneda]
        r['monto_usd'] = round(r['monto'] / rate, 2)
        r['fx_rate']   = round(rate, 4)
        converted += 1
    else:
        skipped += 1

data['fx_enriched'] = datetime.now().isoformat()

with open(DATA_PATH, 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False)

print(f"\nDone: {converted} reservas con monto_usd | {skipped} sin conversión → {DATA_PATH}")
