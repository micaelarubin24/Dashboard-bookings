import { useState, useMemo, useEffect } from 'react'
import Head from 'next/head'
import fs from 'fs'
import path from 'path'
import * as XLSX from 'xlsx'

const PER_PAGE = 50
const MONEDAS = ['ARS', 'BRL', 'CLP', 'COP', 'MXN', 'USD']

// ── Mendel brand tokens ───────────────────────────────────────────────────────
const M = {
  orange:  '#e44400',
  blue:    '#004ff8',
  navy:    '#11161c',
  offwhite:'#fdfdfc',
  textSec: '#565656',
  border:  '#e5e7eb',
  bg:      '#f4f5f7',
  chartColors: ['#004ff8', '#e44400', '#11161c', '#0ea5e9', '#f97316', '#6366f1', '#10b981'],
}

// ── Styles (colors / spacing only — layout via CSS classes) ──────────────────
const inputStyle = {
  width: '100%', padding: '8px 12px', border: `1px solid ${M.border}`,
  borderRadius: '8px', fontSize: '13px', outline: 'none',
  background: M.offwhite, color: M.navy,
}
const badgeStyle = {
  display: 'inline-block', padding: '3px 10px', borderRadius: '20px',
  fontSize: '11px', fontWeight: 600, whiteSpace: 'nowrap', letterSpacing: '0.02em',
}
const pageBtn = {
  padding: '6px 10px', border: `1px solid ${M.border}`, borderRadius: '6px',
  background: M.offwhite, cursor: 'pointer', fontSize: '13px', color: M.navy,
}
const cardStyle = {
  background: M.offwhite, borderRadius: '12px',
  padding: '20px 22px', boxShadow: '0 1px 4px rgba(0,0,0,0.07)',
}

// ── Badge maps ────────────────────────────────────────────────────────────────
const estadoMap   = {
  ISSUED:    { bg:'#e6f4ea', color:'#1a6632' },
  ISSUING:   { bg:'#e8f0fe', color:'#0842d1' },
  BOOKED:    { bg:'#e6f4ea', color:'#1a6632' },
  BOOKING:   { bg:'#e8f0fe', color:'#0842d1' },
  ERROR:     { bg:'#fce8e6', color:'#c5221f' },
  CANCELLED: { bg:'#f4f5f7', color:'#565656' },
}
const aprobadoMap = {
  APPROVED:  { bg:'#e6f4ea', color:'#1a6632' },
  PENDING:   { bg:'#fff4e5', color:'#9a4b00' },
  ERROR:     { bg:'#fce8e6', color:'#c5221f' },
  CANCELLED: { bg:'#f4f5f7', color:'#565656' },
  EXPIRED:   { bg:'#f4f5f7', color:'#9a4b00' },
  DECLINED:  { bg:'#fce8e6', color:'#c5221f' },
}
const canalMap    = { ONLINE: { bg:'#e8f0fe', color:M.blue }, OFFLINE:{ bg:'#fff4e5', color:'#9a4b00' } }
const viajeMap    = { ONGOING:{ bg:'#e6f4ea', color:'#1a6632' }, PENDING:{ bg:'#f4f5f7', color:'#565656' }, NONE:{ bg:'#f4f5f7', color:'#9ca3af' } }

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtDate(d) {
  if (!d) return '-'
  const [, m, day] = d.split('-')
  return `${day}/${m}`
}
function fmtEmpresa(e) {
  if (!e) return '-'
  const m = e.match(/^[A-Z]{2}-([A-Z0-9]{2,6})-/)
  return m ? m[1] : e
}

function fmtMonto(n) {
  return Math.round(n).toLocaleString('es-AR')
}

// ── Pure helpers (module-level, no closures) ──────────────────────────────────
const TODAY    = () => new Date().toISOString().slice(0, 10)
const daysAgo  = n => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10) }
const isStuck        = r => r.estado === 'BOOKING'  && r.fecha && r.fecha < TODAY()
const isIssuingStuck = r => r.estado === 'ISSUING'  && r.fecha && r.fecha < daysAgo(2)
const isEmitida      = r => (r.estado === 'ISSUED' || r.estado === 'BOOKED') && (r.aprobado === 'APPROVED' || r.grupo === 'VIP')
const isEnProceso    = r => (r.estado === 'ISSUING' || r.estado === 'BOOKING') && !isStuck(r) && !isIssuingStuck(r) && !(r.estado === 'BOOKING' && r.aprobado === 'ERROR' && r.grupo === 'VIP')
const isError        = r => (r.error_message && r.pnr) || isIssuingStuck(r)
const isCancelada    = r => r.estado === 'CANCELLED'
const isErrorGeneral = r => !r.pnr

const CARD_FILTERS = {
  emitidas:        isEmitida,
  enProceso:       isEnProceso,
  errores:         isError,
  canceladas:      r => r.estado === 'CANCELLED' && r.aprobado === 'CANCELLED',
  expiradas:       r => r.estado === 'CANCELLED' && r.aprobado === 'EXPIRED',
  rechazadas:      r => r.estado === 'CANCELLED' && r.aprobado === 'DECLINED',
  erroresGenerales:isErrorGeneral,
  flights:         r => r.producto === 'FLIGHT',
  hotels:          r => r.producto === 'ACCOMMODATION',
  cars:            r => r.producto === 'CAR',
  pendAprobacion:  r => r.aprobado === 'PENDING',
}

function normalizeErrorMsg(msg) {
  return msg
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '')
    .replace(/tracking id\s*[\w-]*/gi, '')
    .replace(/\b\d{2}\/\d{2}\/\d{4}-\d{2}:\d{2}\b/g, '')
    .replace(/price difference is [\d.]+/gi, 'price difference is {amount}')
    .replace(/status code \d+/gi, 'status code {N}')
    .replace(/,?\s*see remaining messages for details\s*/gi, '')
    .replace(/\s+/g, ' ').trim()
}

function calcPcts(stats) {
  const total = stats.total
  if (!total) return { emitidas:0, enProceso:0, errores:0, canceladas:0, expiradas:0, rechazadas:0 }
  const keys = ['emitidas','enProceso','errores','canceladas','expiradas','rechazadas']
  const exacts = keys.map(k => stats[k] / total * 100)
  const floors = exacts.map(Math.floor)
  const rem = 100 - floors.reduce((a,b) => a+b, 0)
  const diffs = exacts.map((e,i) => e - floors[i])
  keys.map((_,i) => i).sort((a,b) => diffs[b]-diffs[a]).slice(0, rem).forEach(i => floors[i]++)
  return Object.fromEntries(keys.map((k,i) => [k, floors[i]]))
}

// ── Components ────────────────────────────────────────────────────────────────
const EXTERNAL_SVG = (
  <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
    style={{ opacity:0.6, flexShrink:0 }}>
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
    <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
  </svg>
)
function PnrLink({ uniqueCode, pnr }) {
  if (!uniqueCode || !pnr) return <>{pnr || '-'}</>
  return (
    <a href={`https://mx.app.mendel.com/v2/travels/solicitations/detail/${uniqueCode}`}
      target="_blank" rel="noreferrer"
      style={{ color:M.blue, textDecoration:'none', display:'inline-flex', alignItems:'center', gap:'4px' }}
      onMouseOver={e => e.currentTarget.style.textDecoration = 'underline'}
      onMouseOut={e => e.currentTarget.style.textDecoration = 'none'}>
      {pnr || '—'}{EXTERNAL_SVG}
    </a>
  )
}

function ErrorTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const d = payload[0]
  return (
    <div style={{ background:M.navy, color:'#fff', padding:'10px 14px', borderRadius:'8px',
      fontSize:'12px', maxWidth:'320px', lineHeight:'1.5', boxShadow:'0 4px 12px rgba(0,0,0,0.2)' }}>
      <div style={{ fontWeight:700, marginBottom:'4px' }}>{d.payload.rawCount} errores · {d.payload.count} usuarios afectados</div>
      <div style={{ color:'rgba(255,255,255,0.75)', fontSize:'11px' }}>{d.payload.full}</div>
    </div>
  )
}

function StatCard({ label, value, color, sub, tooltip, onClick, active }) {
  const [show, setShow] = useState(false)
  return (
    <div
      onClick={onClick}
      style={{ ...cardStyle, borderTop: `3px solid ${color}`, position:'relative',
        cursor: onClick ? 'pointer' : 'default',
        outline: active ? `2px solid ${color}` : 'none',
        boxShadow: active
          ? `0 0 0 3px ${color}33, 0 1px 4px rgba(0,0,0,0.07)`
          : cardStyle.boxShadow,
      }}>
      <div style={{ display:'flex', alignItems:'center', gap:'6px', marginBottom:'10px' }}>
        <div style={{ fontSize:'11px', fontWeight:700, color:M.textSec, letterSpacing:'0.06em', textTransform:'uppercase' }}>{label}</div>
        {tooltip && (
          <div style={{ position:'relative', display:'inline-flex' }}
            onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
            <div style={{ width:'15px', height:'15px', borderRadius:'50%', background:'#e2e8f0', color:'#64748b',
              fontSize:'10px', fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', cursor:'default' }}>?</div>
            {show && (
              <div style={{ position:'absolute', top:'20px', left:'0', zIndex:100, background:M.navy, color:'#fff',
                fontSize:'12px', lineHeight:'1.5', padding:'10px 12px', borderRadius:'8px', width:'220px',
                boxShadow:'0 4px 16px rgba(0,0,0,0.18)', whiteSpace:'pre-wrap' }}>
                {tooltip}
              </div>
            )}
          </div>
        )}
      </div>
      <div style={{ fontSize:'28px', fontWeight:800, color:M.navy, letterSpacing:'-0.5px' }}>{value.toLocaleString('es-AR')}</div>
      {sub && <div style={{ fontSize:'12px', color:M.textSec, marginTop:'4px' }}>{sub}</div>}
    </div>
  )
}

function Badge({ value, map }) {
  const cfg = map[value] || { bg:'#f4f5f7', color:M.textSec }
  return <span style={{ ...badgeStyle, background:cfg.bg, color:cfg.color }}>{value || '-'}</span>
}

function ChartTitle({ children }) {
  return <div style={{ fontSize:'11px', fontWeight:700, color:M.textSec, letterSpacing:'0.07em', textTransform:'uppercase', marginBottom:'16px' }}>{children}</div>
}

// ── Insights Panel ────────────────────────────────────────────────────────────
function InsightsPanel({ filtered, stats, onApplyFilter }) {
  const insights = useMemo(() => {
    const total = filtered.length
    if (total === 0) return []

    const results = []

    // 0. Errores (prioridad máxima)
    const errorEstado = filtered.filter(r => r.estado === 'ERROR')
    const totalErrors = new Set(errorEstado.map(r => r.unique_code)).size
    if (totalErrors > 0) {
      const errorPct = Math.round((totalErrors / total) * 100)
      const byEmpresa = {}
      errorEstado.forEach(r => { if (r.empresa) byEmpresa[r.empresa] = (byEmpresa[r.empresa] || 0) + 1 })
      const top = Object.entries(byEmpresa).sort(([,a],[,b]) => b-a)[0]
      results.push({ type: 'error', icon: 'alert',
        text: top
          ? `${totalErrors} solicitudes con ERROR (${errorPct}% del total) — ${top[1]} errores en ${fmtEmpresa(top[0])}`
          : `${totalErrors} solicitudes con ERROR (${errorPct}% del total) — revisión urgente`,
        filter: { estado: 'ERROR' } })
    }

    // 1. Autos sin emisiones
    const carsTotal    = filtered.filter(r => r.producto === 'CAR').length
    const carsEmitidos = filtered.filter(r => r.producto === 'CAR' && (r.estado === 'ISSUED' || r.estado === 'BOOKED')).length
    const carsError    = filtered.filter(r => r.producto === 'CAR' && r.estado === 'ERROR').length
    if (carsTotal > 0 && carsEmitidos === 0) {
      results.push({ type: 'error', icon: 'alert',
        text: `Autos: 0 solicitudes emitidas de ${carsTotal} — ${carsError} con error. Posible problema de integración`,
        filter: { producto: 'CAR', estado: 'ERROR' } })
    } else if (carsTotal > 0 && carsError > carsTotal * 0.3) {
      results.push({ type: 'warning', icon: 'alert',
        text: `Autos: ${Math.round(carsError/carsTotal*100)}% de errores (${carsError} de ${carsTotal} solicitudes)`,
        filter: { producto: 'CAR', estado: 'ERROR' } })
    }

    // 2. ISSUING elevado
    const issuingCount = filtered.filter(r => r.estado === 'ISSUING').length
    const issuingPct   = Math.round((issuingCount / total) * 100)
    if (issuingPct > 20) {
      results.push({ type: 'warning', icon: 'alert',
        text: `${issuingPct}% en proceso de emisión (${issuingCount} PNRs en ISSUING) — revisá posibles demoras`,
        filter: { estado: 'ISSUING' } })
    }

    // 3. Aprobaciones pendientes
    const pendingApproval = filtered.filter(r => r.aprobado === 'PENDING')
    const pendingPct      = Math.round((pendingApproval.length / total) * 100)
    if (pendingApproval.length > 0) {
      const byEmpresa = {}
      pendingApproval.forEach(r => { if (r.empresa) byEmpresa[r.empresa] = (byEmpresa[r.empresa] || 0) + 1 })
      const top = Object.entries(byEmpresa).sort(([,a],[,b]) => b-a)[0]
      results.push({ type: pendingPct > 20 ? 'warning' : 'info', icon: 'clock',
        text: top && top[1] > 1
          ? `${top[1]} viajes de ${fmtEmpresa(top[0])} esperando aprobación — ${pendingApproval.length} pendientes en total`
          : `${pendingApproval.length} solicitud${pendingApproval.length > 1 ? 'es' : ''} con aprobación pendiente (${pendingPct}%)`,
        filter: { aprobado: 'PENDING' } })
    }

    // 4. Canal offline elevado
    const offlineCount = filtered.filter(r => r.canal === 'OFFLINE').length
    const offlinePct   = Math.round((offlineCount / total) * 100)
    if (offlinePct > 15) {
      results.push({ type: 'info', icon: 'info',
        text: `${offlinePct}% de las solicitudes se gestionan por canal offline (${offlineCount})`,
        filter: { canal: 'OFFLINE' } })
    }

    // 5. Mix producto y volumen
    const flightMonto = filtered.filter(r => r.producto === 'FLIGHT').reduce((s,r) => s+(r.monto||0), 0)
    const hotelMonto  = filtered.filter(r => r.producto === 'ACCOMMODATION').reduce((s,r) => s+(r.monto||0), 0)
    const flightPct   = total ? Math.round((stats.flights / total) * 100) : 0
    const volDominant = flightMonto >= hotelMonto ? 'Vuelos' : 'Hospedajes'
    results.push({ type: 'insight', icon: 'trend',
      text: `Vuelos representan el ${flightPct}% de las solicitudes — ${volDominant} generan el mayor volumen de gasto` })

    return results
  }, [filtered, stats])

  if (insights.length === 0) return null

  const icons = {
    zap:   <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>,
    alert: <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>,
    clock: <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path strokeLinecap="round" d="M12 6v6l4 2"/></svg>,
    trend: <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"/></svg>,
    info:  <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path strokeLinecap="round" strokeLinejoin="round" d="M12 16v-4m0-4h.01"/></svg>,
  }

  const colors = {
    error:   { bg:'#fce8e6', border:'#c5221f', text:'#7f1d1d', icon:'#c5221f', btn:'#c5221f' },
    warning: { bg:'#FFF4E5', border:'#F97316', text:'#7C3500', icon:'#F97316', btn:'#F97316' },
    info:    { bg:'#EEF4FF', border:M.blue,    text:'#1E3A8A', icon:M.blue,    btn:M.blue    },
    insight: { bg:'#F0FDF4', border:'#10b981', text:'#065F46', icon:'#10b981', btn:'#10b981' },
  }

  const tooltipRules = [
    '🔴 Errores — alerta si hay cualquier reserva con estado ERROR',
    '🔴 Autos — alerta si ningún auto fue emitido (posible falla de integración)',
    '🟠 Autos — warning si más del 30% de autos tienen error',
    '🟠 ISSUING elevado — warning si más del 20% de reservas están en proceso de emisión',
    '🔵 Aprobaciones — info/warning si hay viajes con aprobación PENDING (warning si >20%)',
    '🔵 Canal offline — info si más del 15% de reservas se gestionan por OFFLINE',
    '🟢 Mix de producto — siempre muestra qué producto domina el volumen de gasto',
  ]

  return (
    <div style={{ background:M.offwhite, borderRadius:'12px', padding:'16px 20px',
      boxShadow:'0 1px 4px rgba(0,0,0,0.07)', border:`1px solid ${M.border}`, marginBottom:'20px' }}>
      <div style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'14px' }}>
        <span style={{ color:M.blue, display:'flex' }}>{icons.zap}</span>
        <span style={{ fontSize:'11px', fontWeight:700, color:M.navy, textTransform:'uppercase', letterSpacing:'0.07em' }}>
          Análisis Inteligente
        </span>
        <span style={{ ...badgeStyle, background:'#EEF4FF', color:M.blue, fontSize:'10px', marginLeft:'2px' }}>
          {insights.length} insight{insights.length > 1 ? 's' : ''}
        </span>
        <div style={{ marginLeft:'auto', position:'relative' }} className="tooltip-trigger">
          <span style={{ display:'flex', alignItems:'center', cursor:'default', color:M.textSec }}>
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/><path strokeLinecap="round" strokeLinejoin="round" d="M12 16v-4m0-4h.01"/>
            </svg>
          </span>
          <div className="tooltip-box" style={{
            display:'none', position:'absolute', right:0, top:'20px', zIndex:200,
            background:M.navy, color:'#fff', borderRadius:'10px', padding:'14px 16px',
            width:'340px', boxShadow:'0 8px 24px rgba(0,0,0,0.2)', fontSize:'12px', lineHeight:'1.7',
          }}>
            <div style={{ fontWeight:700, marginBottom:'8px', fontSize:'11px', letterSpacing:'0.06em', textTransform:'uppercase', color:'rgba(255,255,255,0.5)' }}>
              Reglas activas
            </div>
            {tooltipRules.map((r, i) => (
              <div key={i} style={{ marginBottom: i < tooltipRules.length - 1 ? '6px' : 0 }}>{r}</div>
            ))}
          </div>
        </div>
      </div>
      <div style={{ display:'flex', flexDirection:'column', gap:'8px' }}>
        {insights.map((ins, i) => {
          const cfg = colors[ins.type]
          return (
            <div key={i} style={{ display:'flex', alignItems:'center', gap:'10px',
              background:cfg.bg, borderRadius:'8px', padding:'10px 14px', borderLeft:`3px solid ${cfg.border}` }}>
              <span style={{ color:cfg.icon, flexShrink:0, display:'flex' }}>{icons[ins.icon]}</span>
              <span style={{ fontSize:'13px', color:cfg.text, lineHeight:'1.5', flex:1 }}>{ins.text}</span>
              {ins.filter && (
                <button
                  onClick={() => onApplyFilter(ins.filter)}
                  style={{
                    flexShrink: 0, padding:'4px 12px', fontSize:'12px', fontWeight:600,
                    border:`1.5px solid ${cfg.btn}`, borderRadius:'6px', cursor:'pointer',
                    background:'transparent', color:cfg.btn, whiteSpace:'nowrap',
                  }}
                >
                  Ver →
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Analytics ─────────────────────────────────────────────────────────────────
function groupErrorRows(rows) {
  // Sort ascending por fecha_hora
  const sorted = [...rows].sort((a, b) => (a.fecha_hora || '').localeCompare(b.fecha_hora || ''))
  const TWO_HOURS = 2 * 60 * 60 * 1000
  const groups = [] // { representative, count, mail, firstTs, lastTs }
  for (const r of sorted) {
    const ts = r.fecha_hora ? new Date(r.fecha_hora).getTime() : null
    const mail = r.mail || ''
    // buscar grupo existente del mismo mail donde el último error fue hace menos de 2h
    const existing = ts ? groups.find(g => g.mail === mail && ts - g.lastTs <= TWO_HOURS) : null
    if (existing) {
      existing.count++
      existing.lastTs = ts
    } else {
      groups.push({ representative: r, count: 1, mail, firstTs: ts, lastTs: ts })
    }
  }
  // Ordenar por lastTs desc (más reciente primero)
  return groups.sort((a, b) => (b.lastTs || 0) - (a.lastTs || 0))
}

function ErrorModal({ modal, filtered, onClose }) {
  if (!modal) return null
  const rows = filtered.filter(r => r.estado === 'ERROR' && r.producto === modal.prod && r.error_message && normalizeErrorMsg(r.error_message) === modal.normalizedKey)
  const groups = groupErrorRows(rows)
  const uniquePersons = new Set(rows.map(r => r.mail).filter(Boolean)).size

  return (
    <div
      onClick={onClose}
      style={{ position:'fixed', inset:0, background:'rgba(17,22,28,0.55)', zIndex:1000,
        display:'flex', alignItems:'center', justifyContent:'center', padding:'24px' }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background:M.offwhite, borderRadius:'14px', width:'100%', maxWidth:'1400px',
          maxHeight:'92vh', display:'flex', flexDirection:'column', boxShadow:'0 20px 60px rgba(0,0,0,0.25)' }}
      >
        {/* Header */}
        <div style={{ padding:'18px 22px', borderBottom:`1px solid ${M.border}`, display:'flex', alignItems:'flex-start', gap:'12px' }}>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:'11px', fontWeight:700, color:'#c5221f', textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:'6px', display:'flex', gap:'12px', alignItems:'center' }}>
              <span>{modal.prod}</span>
              <span style={{ color:M.textSec, fontWeight:500 }}>·</span>
              <span>{rows.length} errores</span>
              <span style={{ color:M.textSec, fontWeight:500 }}>·</span>
              <span style={{ color:M.navy }}>{uniquePersons} {uniquePersons === 1 ? 'persona' : 'personas'}</span>
              <span style={{ color:M.textSec, fontWeight:500 }}>·</span>
              <span style={{ color:M.blue }}>{groups.length} {groups.length === 1 ? 'incidente' : 'incidentes'}</span>
            </div>
            <div style={{ fontSize:'13px', color:M.navy, lineHeight:'1.5' }}>{modal.full}</div>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:M.textSec, padding:'2px', flexShrink:0, fontSize:'20px', lineHeight:1 }}>✕</button>
        </div>
        {/* Table */}
        <div style={{ overflowY:'auto', flex:1, padding:'0 8px 16px' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'13px' }}>
            <thead>
              <tr style={{ background:M.bg, position:'sticky', top:0 }}>
                {['Último error','PNR','Email','Grupo','Empresa','Tracking ID','Errores'].map(h => (
                  <th key={h} style={{ padding:'12px 20px', textAlign: h === 'Errores' ? 'center' : 'left', fontSize:'11px', fontWeight:700,
                    color:M.textSec, letterSpacing:'0.05em', textTransform:'uppercase', borderBottom:`1px solid ${M.border}` }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map(({ representative: r, count }, i) => (
                <tr key={i} style={{ borderBottom:`1px solid ${M.border}`, background: i%2===0 ? M.offwhite : M.bg }}>
                  <td style={{ padding:'12px 20px', color:M.textSec, whiteSpace:'nowrap' }} suppressHydrationWarning>
                    {new Date(r.lastTs || r.fecha_hora).toLocaleString('es-AR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) || '—'}
                  </td>
                  <td style={{ padding:'12px 20px', fontFamily:'monospace', fontWeight:600, color:M.navy }}>
                    {r.pnr || <span style={{ color:M.textSec }}>—</span>}
                  </td>
                  <td style={{ padding:'12px 20px', color:M.navy }}>{r.mail || '—'}</td>
                  <td style={{ padding:'12px 20px', color:M.textSec }}>{r.grupo || '—'}</td>
                  <td style={{ padding:'12px 20px', color:M.textSec }}>{r.empresa ? r.empresa.replace(/^[A-Z]{2}-[A-Z0-9]+-/, '') : '—'}</td>
                  <td style={{ padding:'12px 20px', fontFamily:'monospace', fontSize:'11px', color:M.textSec }}>
                    {(() => { const m = r.error_message?.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i); return m ? m[0] : '—' })()}
                  </td>
                  <td style={{ padding:'12px 20px', textAlign:'center' }}>
                    {count > 1
                      ? <span style={{ ...badgeStyle, background:'#fce8e6', color:'#c5221f' }}>{count}x</span>
                      : <span style={{ color:M.textSec }}>1</span>
                    }
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function Analytics({ filtered, stats, onCardClick, cardFilter, activeFilters, onClearFilters }) {
  const [recharts, setRecharts] = useState(null)
  const [errorModal, setErrorModal] = useState(null)
  useEffect(() => { import('recharts').then(rc => setRecharts(rc)) }, [])

  const pcts = useMemo(() => calcPcts(stats), [stats])

  const data = useMemo(() => {

    const byFecha = {}, byEmpresa = {}, montoByMon = {}
    filtered.forEach(r => {
      if (r.empresa)           byEmpresa[r.empresa] = (byEmpresa[r.empresa] || 0) + 1
      if (r.moneda && r.monto) montoByMon[r.moneda] = (montoByMon[r.moneda] || 0) + r.monto
      if (!r.fecha) return
      if (!byFecha[r.fecha]) byFecha[r.fecha] = { emitidas:0, enProceso:0, errores:0, canceladas:0, erroresGenerales:0 }
      if      (isEmitida(r))      byFecha[r.fecha].emitidas++
      else if (isEnProceso(r))    byFecha[r.fecha].enProceso++
      else if (isError(r))        byFecha[r.fecha].errores++
      else if (isCancelada(r))    byFecha[r.fecha].canceladas++
      else if (isErrorGeneral(r)) byFecha[r.fecha].erroresGenerales++
    })
    return {
      timeline: Object.entries(byFecha).sort(([a],[b])=>a.localeCompare(b))
        .map(([f, v]) => ({ fecha: f.slice(5).replace('-','/'), ...v })),
      productHealth: ['FLIGHT','ACCOMMODATION','CAR'].map(prod => {
        const rows = filtered.filter(r => r.producto === prod)
        if (!rows.length) return null
        return {
          name:       prod === 'FLIGHT' ? 'Vuelos' : prod === 'ACCOMMODATION' ? 'Hospedajes' : 'Autos',
          emitidas:        rows.filter(isEmitida).length,
          enProceso:       rows.filter(isEnProceso).length,
          errores:         rows.filter(isError).length,
          canceladas:      rows.filter(isCancelada).length,
          erroresGenerales: rows.filter(isErrorGeneral).length,
        }
      }).filter(Boolean),
      topEmpresas: Object.entries(byEmpresa).sort(([,a],[,b])=>b-a).slice(0,10)
        .map(([emp,count])=>({ empresa: fmtEmpresa(emp), count })),
      topEmpresasUSD: (() => {
        const map = {}
        filtered.filter(r=>isEmitida(r)&&r.monto_usd>0).forEach(r=>{
          const k = fmtEmpresa(r.empresa)
          map[k] = (map[k]||0) + r.monto_usd
        })
        return Object.entries(map).sort(([,a],[,b])=>b-a).slice(0,10)
          .map(([empresa, usd])=>({ empresa, usd: Math.round(usd) }))
      })(),
      countByMoneda: MONEDAS.map(m=>({ moneda:m, count:filtered.filter(r=>r.moneda===m).length })).filter(d=>d.count>0),
      montosCards: Object.entries(montoByMon).sort(([,a],[,b])=>b-a).map(([moneda,total])=>({ moneda, total })),
      totalUSD: filtered.filter(r => isEmitida(r) || isEnProceso(r)).reduce((s,r) => s + (r.monto_usd||0), 0),
      totalUSDEmitidas: filtered.filter(r =>
        (r.estado==='ISSUED'||r.estado==='BOOKED') && (r.aprobado==='APPROVED'||r.grupo==='VIP')
      ).reduce((s,r) => s + (r.monto_usd||0), 0),
      top5Caras: filtered
        .filter(r => r.estado==='ISSUED' && r.monto_usd > 0)
        .sort((a,b) => b.monto_usd - a.monto_usd)
        .slice(0, 5),
      usdByMoneda: MONEDAS.reduce((acc,m) => {
        acc[m] = filtered.filter(r=>r.moneda===m&&(r.estado==='ISSUED'||r.estado==='ISSUING')).reduce((s,r)=>s+(r.monto_usd||0),0)
        return acc
      }, {}),
      estados: ['ISSUED','BOOKED','ISSUING','BOOKING','ERROR','CANCELLED']
        .map(s=>({ name:s, value:filtered.filter(r=>r.estado===s).length }))
        .filter(d=>d.value>0),
      canales:  [{ name:'Online', value:filtered.filter(r=>r.canal==='ONLINE'&&(isEmitida(r)||isEnProceso(r))).length },
                 { name:'Offline',value:filtered.filter(r=>r.canal==='OFFLINE'&&(isEmitida(r)||isEnProceso(r))).length }].filter(d=>d.value>0),
      proveedores: [
        { name:'Sabre',         value: filtered.filter(r=>r.proveedor==='SABRE').length },
        { name:'TravelFusion',  value: filtered.filter(r=>r.proveedor==='TRAVELFUSION').length },
        { name:'Sin proveedor', value: filtered.filter(r=>!r.proveedor).length },
      ].filter(d=>d.value>0),
      topErrorsByProduct: ['FLIGHT','ACCOMMODATION','CAR'].map(prod => {
        const rows = filtered.filter(r => r.producto === prod && r.error_message && (isError(r) || isErrorGeneral(r)))
        const map = {}
        rows.forEach(r => {
          const key = normalizeErrorMsg(r.error_message)
          if (!map[key]) map[key] = { mails: new Set(), rawCount: 0, full: r.error_message }
          map[key].mails.add(r.mail || r.unique_code || r.pnr || 'unknown')
          map[key].rawCount++
        })
        const top10 = Object.entries(map).sort(([,a],[,b]) => b.rawCount-a.rawCount).slice(0,10)
          .map(([key, { mails, rawCount, full }]) => {
            const count = mails.size
            let label = key
              .replace(/^failed to book requested products \[type \w+ message /i, '')
              .replace(/\]$/, '')
              .replace(/attempt to book (itinerary|car rate) failed to (reserve\. failed to book flight\.|book car )/i, '')
              .replace(/creating pnr (on passenger details )?/i, '')
              .replace(/pnr: (WARN\.(SWS\.HOST\.ERROR_IN_RESPONSE|SP\.HALT_ON_STATUS_RECEIVED) - \w+: )/i, '')
            if (label.length > 55) label = label.slice(0, 55) + '…'
            return { label, count, rawCount, full, normalizedKey: key }
          })
        return {
          prod,
          name: prod === 'FLIGHT' ? 'Vuelos' : prod === 'ACCOMMODATION' ? 'Hospedajes' : 'Autos',
          color: prod === 'FLIGHT' ? M.blue : prod === 'ACCOMMODATION' ? M.orange : '#0ea5e9',
          data: top10,
          total: new Set(rows.map(r => r.mail).filter(Boolean)).size,
          totalRaw: rows.length,
        }
      }).filter(p => p.data.length > 0),
      viajeStatus:[{ name:'ONGOING',value:filtered.filter(r=>r.viaje_iniciado==='ONGOING').length },
                   { name:'PENDING',value:filtered.filter(r=>r.viaje_iniciado==='PENDING').length },
                   { name:'NONE',   value:filtered.filter(r=>r.viaje_iniciado==='NONE').length }].filter(d=>d.value>0),
      empresaHealth: (() => {
        const map = {}
        filtered.forEach(r => {
          if (!r.empresa) return
          const key = fmtEmpresa(r.empresa)
          if (!map[key]) map[key] = { name:key, emitidas:0, errores:0, enProceso:0, canceladas:0, erroresGenerales:0, total:0 }
          map[key].total++
          if      (isEmitida(r))      map[key].emitidas++
          else if (isError(r))        map[key].errores++
          else if (isEnProceso(r))    map[key].enProceso++
          else if (isCancelada(r))    map[key].canceladas++
          else if (isErrorGeneral(r)) map[key].erroresGenerales++
        })
        return Object.values(map).sort((a,b)=>b.total-a.total).slice(0,10)
      })(),
      topViajeros: (() => {
        const map = {}
        filtered
          .filter(r => isEmitida(r) || isEnProceso(r))
          .forEach(r => {
            if (!r.mail) return
            if (!map[r.mail]) map[r.mail] = { nombre:r.viajero, empresa:fmtEmpresa(r.empresa), viajes:0, vuelos:0, hoteles:0, autos:0, montos:{}, gastoUSD:0 }
            map[r.mail].viajes++
            if (r.producto==='FLIGHT')        map[r.mail].vuelos++
            if (r.producto==='ACCOMMODATION') map[r.mail].hoteles++
            if (r.producto==='CAR')           map[r.mail].autos++
            if (r.monto && r.moneda) map[r.mail].montos[r.moneda] = (map[r.mail].montos[r.moneda]||0) + r.monto
            if (r.monto_usd) map[r.mail].gastoUSD += r.monto_usd
          })
        return Object.values(map).sort((a,b)=>b.viajes-a.viajes).slice(0,10)
      })(),
      ticketProm: (() => {
        const res = {}
        ;['FLIGHT','ACCOMMODATION','CAR'].forEach(prod => {
          const rows = filtered.filter(r=>r.producto===prod&&isEmitida(r)&&r.monto_usd>0)
          if (!rows.length) return
          const avg = rows.reduce((s,r)=>s+r.monto_usd,0) / rows.length
          res[prod] = { moneda:'USD', avg, n: rows.length }
        })
        const allRows = filtered.filter(r=>isEmitida(r)&&r.monto_usd>0)
        if (allRows.length) res['ALL'] = { moneda:'USD', avg: allRows.reduce((s,r)=>s+r.monto_usd,0)/allRows.length, n: allRows.length }
        return res
      })(),
      picosPorPais: (() => {
        const PAISES = { AR:'Argentina', BR:'Brasil', CO:'Colombia', MX:'México', CL:'Chile', UY:'Uruguay', PE:'Perú' }
        // Offsets UTC → local (horas a sumar). DB guarda en UTC.
        const UTC_OFFSET = { AR:-3, BR:-3, CO:-5, MX:-6, CL:-3, UY:-3, PE:-5 }
        const byHour = {}
        filtered.forEach(r => {
          if (!r.hora || !r.empresa) return
          const horaUTC = parseInt(r.hora.slice(0,2), 10)
          if (isNaN(horaUTC)) return
          const pais = r.empresa.slice(0,2)
          if (!PAISES[pais]) return
          const hora = ((horaUTC + (UTC_OFFSET[pais] || 0)) % 24 + 24) % 24
          if (!byHour[hora]) byHour[hora] = {}
          byHour[hora][pais] = (byHour[hora][pais] || 0) + 1
        })
        const paisSet = new Set()
        filtered.forEach(r => { if (r.empresa && PAISES[r.empresa.slice(0,2)]) paisSet.add(r.empresa.slice(0,2)) })
        const paises = [...paisSet].sort()
        const chartData = Array.from({length:24}, (_,h) => {
          const entry = { hora: `${String(h).padStart(2,'0')}h` }
          paises.forEach(p => { entry[p] = byHour[h]?.[p] || 0 })
          return entry
        })
        return { chartData, paises, labels: PAISES }
      })(),
      sankeyByProduct: (() => {
        // Un Sankey por producto. Nodos por índice:
        // 0:[Producto]  1:Pend.Aprobación  2:Aprobada  3:Expirada
        // 4:Pend.Emisión  5:Emitida  6:Cancelada  7:Error
        const EXPIRED_APROBADO = ['EXPIRED', 'DECLINED']
        const PEND_EMISION     = ['BOOKING', 'BOOKED', 'ISSUING']
        return [
          { key: 'FLIGHT',        label: 'Vuelo',     color: M.blue    },
          { key: 'ACCOMMODATION', label: 'Hospedaje', color: M.orange  },
          { key: 'CAR',           label: 'Auto',      color: '#0ea5e9' },
        ].map(({ key, label, color }) => {
          const rows = filtered.filter(r => r.producto === key)
          if (!rows.length) return null
          const nodes = [
            { name: label },
            { name: 'Pend. Aprobación' },
            { name: 'Aprobada' },
            { name: 'Expirada' },
            { name: 'Pend. Emisión' },
            { name: 'Emitida' },
            { name: 'Cancelada' },
            { name: 'Error' },
          ]
          const links = []
          const add = (s, t, v) => { if (v > 0) links.push({ source: s, target: t, value: v }) }
          // Producto → Aprobación
          add(0, 1, rows.filter(r => r.aprobado === 'PENDING').length)
          add(0, 2, rows.filter(r => r.aprobado === 'APPROVED').length)
          add(0, 3, rows.filter(r => EXPIRED_APROBADO.includes(r.aprobado)).length)
          // Aprobada → Estado final
          const appr = rows.filter(r => r.aprobado === 'APPROVED')
          add(2, 4, appr.filter(r => PEND_EMISION.includes(r.estado)).length)
          add(2, 5, appr.filter(r => r.estado === 'ISSUED').length)
          add(2, 6, appr.filter(r => r.estado === 'CANCELLED').length)
          add(2, 7, appr.filter(r => r.estado === 'ERROR').length)
          // Pend.Aprobación que se cancelaron o dieron error
          const pend = rows.filter(r => r.aprobado === 'PENDING')
          add(1, 6, pend.filter(r => r.estado === 'CANCELLED').length)
          add(1, 7, pend.filter(r => r.estado === 'ERROR').length)
          return { label, color, total: rows.length, nodes, links }
        }).filter(Boolean)
      })(),
    }
  }, [filtered])

  if (!recharts) return (
    <div style={{ textAlign:'center', padding:'80px 24px', color:M.textSec }}>
      <div style={{ fontSize:'24px', marginBottom:'12px', animation:'spin 1s linear infinite', display:'inline-block' }}>⏳</div>
      <div style={{ fontSize:'14px', fontWeight:500 }}>Cargando gráficos...</div>
      <style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
    </div>
  )

  const { BarChart:BC, Bar, LineChart:LC, Line, PieChart:PC, Pie, Cell,
          XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
          Sankey, Layer, Rectangle } = recharts
  const tt = { fontSize:'12px', borderRadius:'8px', border:`1px solid ${M.border}` }

  return (
    <div>
      <div className="grid-stats">
        <StatCard label="Total Solicitudes" value={stats.total} color={M.navy}
          tooltip="Solicitudes que llegaron a generar un PNR, independientemente de su estado final."
          onClick={onClearFilters} active={activeFilters === 0} />
        <StatCard label="Emitidas"          value={stats.emitidas}   color="#10b981"
          sub={`${pcts.emitidas}% del total`}
          tooltip={"Reservas con estado ISSUED o BOOKED y aprobación APPROVED.\nUsuarios VIP: estado ISSUED/BOOKED (sin flujo de aprobación)."}
          onClick={() => onCardClick('emitidas')} active={cardFilter === 'emitidas'} />
        <StatCard label="En Proceso"        value={stats.enProceso}  color={M.blue}
          sub={`${pcts.enProceso}% del total`}
          tooltip={"Reservas en estado ISSUING o BOOKING que aún no finalizaron.\nNo incluye BOOKING atascados (fecha anterior a hoy) ni VIP con aprobado ERROR."}
          onClick={() => onCardClick('enProceso')} active={cardFilter === 'enProceso'} />
        <StatCard label="Con Error"         value={stats.errores}    color="#c5221f"
          sub={`${pcts.errores}% del total`}
          tooltip={"Reservas con error_message y PNR, BOOKING atascados (fecha anterior a hoy), estado ISSUED/BOOKED con aprobado ERROR (no VIP), BOOKING+ERROR para VIP, o estado ERROR con PNR."}
          onClick={() => onCardClick('errores')} active={cardFilter === 'errores'} />
        <StatCard label="Canceladas"        value={stats.canceladas} color="#94a3b8"
          sub={`${pcts.canceladas}% del total`}
          tooltip="Reservas con estado CANCELLED y aprobado CANCELLED. El viajero o un admin canceló la reserva."
          onClick={() => onCardClick('canceladas')} active={cardFilter === 'canceladas'} />
        <StatCard label="Expiradas"         value={stats.expiradas}  color="#f97316"
          sub={`${pcts.expiradas}% del total`}
          tooltip="Reservas con estado CANCELLED y aprobado EXPIRED. El tiempo de aprobación venció antes de que se aprobara."
          onClick={() => onCardClick('expiradas')} active={cardFilter === 'expiradas'} />
        <StatCard label="Rechazadas"        value={stats.rechazadas} color="#be123c"
          sub={`${pcts.rechazadas}% del total`}
          tooltip="Reservas con estado CANCELLED y aprobado DECLINED. Un aprobador rechazó la solicitud."
          onClick={() => onCardClick('rechazadas')} active={cardFilter === 'rechazadas'} />
        <StatCard label="Viajeros Únicos"   value={stats.viajeros}   color="#6366f1"
          tooltip="Cantidad de mails distintos en el período. Refleja cuántos viajeros únicos generaron al menos una solicitud." />
        <StatCard label="Errores Generales" value={stats.erroresGenerales} color="#7c3aed"
          sub="sin PNR asociado"
          tooltip="Solicitudes con error_message o estado ERROR que nunca generaron PNR. No se computan en el total ni en los porcentajes."
          onClick={() => onCardClick('erroresGenerales')} active={cardFilter === 'erroresGenerales'} />
      </div>

      <div className="grid-2-1">
        <div style={cardStyle}>
          <ChartTitle>Solicitudes por fecha — por estado</ChartTitle>
          <ResponsiveContainer width="100%" height={230}>
            <BC data={data.timeline} margin={{ top:5, right:10, left:-10, bottom:0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
              <XAxis dataKey="fecha" tick={{ fontSize:11, fill:M.textSec }} tickLine={false} />
              <YAxis tick={{ fontSize:11, fill:M.textSec }} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={tt} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize:'11px', paddingTop:'8px' }} />
              <Bar dataKey="emitidas"        name="Emitidas"          stackId="a" fill="#10b981" />
              <Bar dataKey="enProceso"       name="En Proceso"        stackId="a" fill={M.blue} />
              <Bar dataKey="errores"         name="Errores"           stackId="a" fill="#c5221f" />
              <Bar dataKey="canceladas"      name="Canceladas"        stackId="a" fill="#94a3b8" />
              <Bar dataKey="erroresGenerales" name="Errores Generales" stackId="a" fill="#f87171" radius={[3,3,0,0]} />
            </BC>
          </ResponsiveContainer>
        </div>
        <div style={cardStyle}>
          <ChartTitle>Health por producto</ChartTitle>
          <ResponsiveContainer width="100%" height={230}>
            <BC data={data.productHealth} layout="vertical" margin={{ top:10, right:20, left:10, bottom:0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
              <XAxis type="number" tick={{ fontSize:11, fill:M.textSec }} tickLine={false} axisLine={false} />
              <YAxis type="category" dataKey="name" width={76} tick={{ fontSize:12, fill:M.navy }} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={tt} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize:'11px', paddingTop:'8px' }} />
              <Bar dataKey="emitidas"        name="Emitidas"          stackId="a" fill="#10b981" />
              <Bar dataKey="enProceso"       name="En Proceso"        stackId="a" fill={M.blue} />
              <Bar dataKey="errores"         name="Errores"           stackId="a" fill="#c5221f" />
              <Bar dataKey="canceladas"      name="Canceladas"        stackId="a" fill="#94a3b8" />
              <Bar dataKey="erroresGenerales" name="Errores Generales" stackId="a" fill="#f87171" radius={[0,3,3,0]} />
            </BC>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid-3-2">
        <div className="grid-2-equal">
          <div style={cardStyle}>
            <ChartTitle>Top 10 por reservas</ChartTitle>
            <ResponsiveContainer width="100%" height={280}>
              <BC data={data.topEmpresas} layout="vertical" margin={{ top:0, right:20, left:0, bottom:0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                <XAxis type="number" tick={{ fontSize:11, fill:M.textSec }} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="empresa" width={50} tick={{ fontSize:11, fill:M.navy }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={tt} formatter={(v)=>[v,'Reservas']} />
                <Bar dataKey="count" name="Reservas" fill={M.blue} radius={[0,6,6,0]} barSize={16} />
              </BC>
            </ResponsiveContainer>
          </div>
          <div style={cardStyle}>
            <ChartTitle>Top 10 por gasto USD — Issued</ChartTitle>
            <ResponsiveContainer width="100%" height={280}>
              <BC data={data.topEmpresasUSD} layout="vertical" margin={{ top:0, right:20, left:0, bottom:0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                <XAxis type="number" tick={{ fontSize:11, fill:M.textSec }} tickLine={false} axisLine={false} tickFormatter={v=>`$${fmtMonto(v)}`} />
                <YAxis type="category" dataKey="empresa" width={50} tick={{ fontSize:11, fill:M.navy }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={tt} formatter={(v)=>[`USD ${v.toLocaleString('es-AR',{maximumFractionDigits:0})}`,'Gasto']} />
                <Bar dataKey="usd" name="USD" fill="#1a3a6e" radius={[0,6,6,0]} barSize={16} />
              </BC>
            </ResponsiveContainer>
          </div>
        </div>
        <div style={cardStyle}>
          <ChartTitle>Reservas por moneda</ChartTitle>
          <ResponsiveContainer width="100%" height={280}>
            <BC data={data.countByMoneda} margin={{ top:5, right:10, left:-10, bottom:0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="moneda" tick={{ fontSize:12, fill:M.navy }} tickLine={false} />
              <YAxis tick={{ fontSize:11, fill:M.textSec }} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={tt} />
              <Bar dataKey="count" name="Reservas" radius={[6,6,0,0]} barSize={36}>
                {data.countByMoneda.map((_,i)=><Cell key={i} fill={M.chartColors[i%M.chartColors.length]} />)}
              </Bar>
            </BC>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Fila 1: 3 tortas */}
      <div className="grid-donuts-3">
        {[{ title:'Estado de solicitudes', cd:data.estados,     colors:['#10b981','#22c55e',M.blue,'#60a5fa','#c5221f','#94a3b8'] },
          { title:'Canal de compra',       cd:data.canales,     colors:[M.blue, M.orange] },
          { title:'Estado del viaje',      cd:data.viajeStatus, colors:['#10b981','#f97316','#94a3b8'] },
        ].map(({ title, cd, colors }) => {
          const total = cd.reduce((s,d) => s+d.value, 0)
          return (
            <div key={title} style={cardStyle}>
              <ChartTitle>{title}</ChartTitle>
              <ResponsiveContainer width="100%" height={150}>
                <PC>
                  <Pie data={cd} cx="50%" cy="50%" innerRadius={44} outerRadius={68}
                    dataKey="value" label={false} labelLine={false}>
                    {cd.map((_,i) => <Cell key={i} fill={colors[i%colors.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={tt} formatter={(v,n) => [`${v.toLocaleString('es-AR')} (${Math.round(v/total*100)}%)`, n]} />
                </PC>
              </ResponsiveContainer>
              <div style={{ display:'flex', flexDirection:'column', gap:'5px', marginTop:'10px' }}>
                {cd.map((item,i) => (
                  <div key={i} style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:'7px' }}>
                      <div style={{ width:'8px', height:'8px', borderRadius:'50%', background:colors[i%colors.length], flexShrink:0 }} />
                      <span style={{ fontSize:'12px', color:M.textSec }}>{item.name}</span>
                    </div>
                    <span style={{ fontSize:'12px', fontWeight:700, color:M.navy }}>
                      {item.value.toLocaleString('es-AR')}
                      <span style={{ fontWeight:400, color:M.textSec }}> ({Math.round(item.value/total*100)}%)</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {/* Fila 2: 2 tortas más anchas con leyenda lateral */}
      <div className="grid-donuts-2">
        {[{ title:'Por proveedor',        cd:data.proveedores,  colors:[M.blue, M.orange, '#94a3b8'] },
          { title:'Emitidas por producto', cd:data.productHealth.map(p=>({name:p.name, value:p.emitidas})).filter(d=>d.value>0), colors:[M.blue, M.orange, '#0ea5e9'] },
        ].map(({ title, cd, colors }) => {
          const total = cd.reduce((s,d) => s+d.value, 0)
          return (
            <div key={title} style={cardStyle} className="donut-wide-card">
              <div className="donut-chart-col" style={{ flexShrink:0, width:'180px' }}>
                <ChartTitle>{title}</ChartTitle>
                <ResponsiveContainer width="100%" height={160}>
                  <PC>
                    <Pie data={cd} cx="50%" cy="50%" innerRadius={48} outerRadius={72}
                      dataKey="value" label={false} labelLine={false}>
                      {cd.map((_,i) => <Cell key={i} fill={colors[i%colors.length]} />)}
                    </Pie>
                    <Tooltip contentStyle={tt} formatter={(v,n) => [`${v.toLocaleString('es-AR')} (${Math.round(v/total*100)}%)`, n]} />
                  </PC>
                </ResponsiveContainer>
              </div>
              <div style={{ flex:1, display:'flex', flexDirection:'column', gap:'12px' }}>
                {cd.map((item,i) => (
                  <div key={i} style={{ display:'flex', alignItems:'center', gap:'10px' }}>
                    <div style={{ width:'10px', height:'10px', borderRadius:'50%', background:colors[i%colors.length], flexShrink:0 }} />
                    <div>
                      <div style={{ fontSize:'12px', color:M.textSec, marginBottom:'1px' }}>{item.name}</div>
                      <div style={{ fontSize:'16px', fontWeight:800, color:M.navy, letterSpacing:'-0.3px' }}>
                        {item.value.toLocaleString('es-AR')}
                        <span style={{ fontSize:'12px', fontWeight:400, color:M.textSec, marginLeft:'5px' }}>({Math.round(item.value/total*100)}%)</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {/* Gasto total USD */}
      {data.totalUSD > 0 && (
        <div className="usd-total-card" style={{ ...cardStyle, display:'flex', gap:'32px', alignItems:'center', flexWrap:'wrap', marginBottom:'16px',
          background: 'linear-gradient(135deg, #0f1e3e 0%, #1a3a6e 100%)', color:'white' }}>
          <div>
            <div style={{ fontSize:'11px', fontWeight:700, letterSpacing:'0.08em', textTransform:'uppercase', opacity:0.6, marginBottom:'6px' }}>
              Solo Emitidas
            </div>
            <div style={{ fontSize:'36px', fontWeight:800, letterSpacing:'-1px', lineHeight:1 }}>
              USD {fmtMonto(data.totalUSDEmitidas)}
            </div>
            <div style={{ fontSize:'12px', opacity:0.5, marginTop:'4px' }}>
              TC del día de cada solicitud
            </div>
          </div>
          <div className="usd-divider" style={{ width:'1px', background:'rgba(255,255,255,0.1)', alignSelf:'stretch' }} />
          <div>
            <div style={{ fontSize:'11px', fontWeight:700, letterSpacing:'0.08em', textTransform:'uppercase', opacity:0.6, marginBottom:'6px' }}>
              Emitidas + En Proceso
            </div>
            <div style={{ fontSize:'28px', fontWeight:800, letterSpacing:'-0.5px', lineHeight:1 }}>
              USD {fmtMonto(data.totalUSD)}
            </div>
          </div>
        </div>
      )}

      <div style={cardStyle}>
        <ChartTitle>Gasto total por moneda</ChartTitle>
        <div style={{ display:'flex', flexWrap:'wrap', gap:'14px', marginTop:'4px' }}>
          {data.montosCards.map(({ moneda, total },i)=>{
            const usd = data.usdByMoneda[moneda]
            return (
              <div key={moneda} style={{ background:M.bg, borderRadius:'10px', padding:'14px 20px', minWidth:'140px', borderTop:`3px solid ${M.chartColors[i%M.chartColors.length]}` }}>
                <div style={{ fontSize:'11px', fontWeight:700, color:M.textSec, letterSpacing:'0.06em', textTransform:'uppercase', marginBottom:'6px' }}>{moneda}</div>
                <div style={{ fontSize:'22px', fontWeight:800, color:M.navy, letterSpacing:'-0.5px' }}>{fmtMonto(total)}</div>
                <div style={{ fontSize:'11px', color:M.textSec, marginTop:'2px' }}>{total.toLocaleString('es-AR',{maximumFractionDigits:0})}</div>
                {usd > 0 && moneda !== 'USD' && (
                  <div style={{ marginTop:'8px', paddingTop:'8px', borderTop:`1px solid ${M.border}` }}>
                    <div style={{ fontSize:'10px', fontWeight:600, color:M.textSec, letterSpacing:'0.04em', marginBottom:'2px' }}>≈ USD</div>
                    <div style={{ fontSize:'14px', fontWeight:700, color:'#1a3a6e' }}>{fmtMonto(usd)}</div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Top 5 reservas más caras ── */}
      {data.top5Caras.length > 0 && (
        <div style={{ ...cardStyle, padding:0, overflow:'hidden' }}>
          <div style={{ padding:'16px 20px 12px' }}>
            <ChartTitle>Top 5 reservas más caras — solo Issued</ChartTitle>
          </div>
          <div className="table-scroll">
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'13px' }}>
            <thead>
              <tr style={{ background:M.bg, borderBottom:`2px solid ${M.border}` }}>
                {['#','PNR','Viajero','Empresa','Producto','Fecha','Moneda orig.','USD'].map(h=>(
                  <th key={h} style={{
                    padding:'8px 14px', textAlign: h==='#'||h==='USD'||h==='Moneda orig.' ? 'center' : 'left',
                    fontSize:'11px', fontWeight:700, color:M.textSec,
                    textTransform:'uppercase', letterSpacing:'0.05em', whiteSpace:'nowrap',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.top5Caras.map((r, i) => (
                <tr key={i} style={{ borderBottom:`1px solid ${M.bg}`, background: i%2===0 ? M.offwhite : '#fafafa' }}>
                  <td style={{ padding:'12px 14px', textAlign:'center', width:'36px' }}>
                    <span style={{ fontSize:'13px', fontWeight:800, color: i===0 ? '#f59e0b' : i===1 ? '#94a3b8' : i===2 ? '#cd7c3a' : M.textSec }}>
                      {i+1}
                    </span>
                  </td>
                  <td style={{ padding:'12px 14px', fontFamily:'monospace', fontWeight:700, color:M.blue }}>
                    <PnrLink uniqueCode={r.unique_code} pnr={r.pnr} />
                  </td>
                  <td style={{ padding:'12px 14px', fontWeight:600, color:M.navy, whiteSpace:'nowrap' }}>{r.viajero||'—'}</td>
                  <td style={{ padding:'12px 14px', color:M.textSec, fontSize:'12px', whiteSpace:'nowrap' }}>{fmtEmpresa(r.empresa)}</td>
                  <td style={{ padding:'12px 14px' }}>
                    <span style={{ ...badgeStyle,
                      background: r.producto==='FLIGHT'?'#e8f0fe':r.producto==='ACCOMMODATION'?'#fff0eb':'#e0f2fe',
                      color:      r.producto==='FLIGHT'?M.blue:r.producto==='ACCOMMODATION'?M.orange:'#0369a1',
                    }}>
                      {r.producto==='FLIGHT'?'Vuelo':r.producto==='ACCOMMODATION'?'Hotel':'Auto'}
                    </span>
                  </td>
                  <td style={{ padding:'12px 14px', color:M.textSec, fontSize:'12px', whiteSpace:'nowrap' }}>{fmtDate(r.fecha)}</td>
                  <td style={{ padding:'12px 14px', textAlign:'center', fontSize:'12px', color:M.textSec, whiteSpace:'nowrap' }}>
                    {r.moneda} {r.monto?.toLocaleString('es-AR',{maximumFractionDigits:0})}
                  </td>
                  <td style={{ padding:'12px 14px', textAlign:'center', whiteSpace:'nowrap' }}>
                    <span style={{ fontSize:'15px', fontWeight:800, color:'#1a3a6e' }}>
                      USD {fmtMonto(r.monto_usd)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {/* ── KPIs de eficiencia operativa ── */}
      <div style={cardStyle}>
        <ChartTitle>Eficiencia operativa</ChartTitle>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(160px, 1fr))', gap:'16px', marginTop:'4px' }}>
          {[
            { label:'Tasa de emisión',    value:`${stats.total?Math.round(stats.emitidas/stats.total*100):0}%`,   sub:`${stats.emitidas} emitidas`,    color:'#10b981' },
            { label:'Tasa de error',      value:`${stats.total?Math.round(stats.errores/stats.total*100):0}%`,    sub:`${stats.errores} con error`,    color:'#c5221f' },
            { label:'Errores generales',  value:stats.erroresGenerales, sub:'sin PNR asociado', color:'#7c3aed' },
            { label:'Tasa de cancelación',value:`${stats.total?Math.round(stats.canceladas/stats.total*100):0}%`, sub:`${stats.canceladas} canceladas`, color:'#94a3b8' },
            { label:'Pend. aprobación',   value:`${stats.total?Math.round(stats.pendAprobacion/stats.total*100):0}%`, sub:`${stats.pendAprobacion} solicitudes`, color:'#f97316' },
            ...(data.ticketProm['ALL'] ? [{ label:'Ticket prom. total', value:`USD ${fmtMonto(data.ticketProm['ALL'].avg)}`, sub:`promedio · ${data.ticketProm['ALL'].n} emitidos`, color:'#6366f1' }] : []),
            ...(['FLIGHT','ACCOMMODATION','CAR'].filter(p=>data.ticketProm[p]).map(p=>({
              label: `Ticket prom. ${p==='FLIGHT'?'vuelo':p==='ACCOMMODATION'?'hotel':'auto'}`,
              value: `USD ${fmtMonto(data.ticketProm[p].avg)}`,
              sub:   `promedio · ${data.ticketProm[p].n} emitidos`,
              color: p==='FLIGHT'?M.blue:p==='ACCOMMODATION'?M.orange:'#0ea5e9',
            }))),
          ].map(({ label, value, sub, color })=>(
            <div key={label} style={{ background:M.bg, borderRadius:'10px', padding:'16px 18px', borderLeft:`3px solid ${color}` }}>
              <div style={{ fontSize:'11px', fontWeight:700, color:M.textSec, textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:'8px' }}>{label}</div>
              <div style={{ fontSize:'28px', fontWeight:800, color, letterSpacing:'-0.5px', lineHeight:1 }}>{value}</div>
              <div style={{ fontSize:'11px', color:M.textSec, marginTop:'6px' }}>{sub}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Eficiencia por empresa ── */}
      <div style={cardStyle}>
        <ChartTitle>Eficiencia por empresa — top 10 por volumen</ChartTitle>
        <ResponsiveContainer width="100%" height={320}>
          <BC data={data.empresaHealth} layout="vertical" margin={{ top:0, right:20, left:10, bottom:0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
            <XAxis type="number" tick={{ fontSize:11, fill:M.textSec }} tickLine={false} axisLine={false} />
            <YAxis type="category" dataKey="name" width={90} tick={{ fontSize:11, fill:M.navy }} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={tt} formatter={(v,n)=>[v,n]} />
            <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize:'11px', paddingTop:'12px' }} />
            <Bar dataKey="emitidas"   name="Emitidas"   stackId="a" fill="#10b981" />
            <Bar dataKey="enProceso"  name="En Proceso" stackId="a" fill={M.blue} />
            <Bar dataKey="errores"    name="Errores"    stackId="a" fill="#c5221f" />
            <Bar dataKey="canceladas"       name="Canceladas"        stackId="a" fill="#94a3b8" />
            <Bar dataKey="erroresGenerales" name="Errores Generales" stackId="a" fill="#f87171" radius={[0,4,4,0]} />
          </BC>
        </ResponsiveContainer>
      </div>

      {/* ── Top viajeros frecuentes ── */}
      <div style={{ ...cardStyle, padding:0, overflow:'hidden' }}>
        <div style={{ padding:'16px 20px 12px' }}>
          <ChartTitle>Top 10 viajeros frecuentes</ChartTitle>
        </div>
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'13px' }}>
            <thead>
              <tr style={{ background:M.bg, borderBottom:`2px solid ${M.border}` }}>
                {['#','Viajero','Empresa','Vuelos','Hoteles','Autos','Total','Gasto'].map(h=>(
                  <th key={h} style={{
                    padding:'8px 14px', textAlign: h==='#'||h==='Vuelos'||h==='Hoteles'||h==='Autos'||h==='Total'||h==='Gasto' ? 'center' : 'left',
                    fontSize:'11px', fontWeight:700, color:M.textSec,
                    textTransform:'uppercase', letterSpacing:'0.05em', whiteSpace:'nowrap',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.topViajeros.map((v, i) => {
                const topMoneda = Object.entries(v.montos).sort(([,a],[,b])=>b-a)[0]
                const initials  = v.nombre.split(' ').filter(Boolean).map(w=>w[0]).join('').slice(0,2).toUpperCase()
                return (
                  <tr key={i} style={{ borderBottom:`1px solid ${M.bg}`, background: i%2===0 ? M.offwhite : '#fafafa' }}>
                    <td style={{ padding:'10px 14px', textAlign:'center', width:'36px' }}>
                      <span style={{ fontSize:'12px', fontWeight:700, color: i<3 ? M.orange : M.textSec }}>{i+1}</span>
                    </td>
                    <td style={{ padding:'10px 14px' }}>
                      <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
                        <div style={{
                          width:'30px', height:'30px', borderRadius:'50%', flexShrink:0,
                          background:M.chartColors[i%M.chartColors.length],
                          display:'flex', alignItems:'center', justifyContent:'center',
                          fontSize:'11px', fontWeight:700, color:'white',
                        }}>{initials}</div>
                        <span style={{ fontWeight:600, color:M.navy, whiteSpace:'nowrap' }}>{v.nombre}</span>
                      </div>
                    </td>
                    <td style={{ padding:'10px 14px', color:M.textSec, fontSize:'12px', whiteSpace:'nowrap' }}>{v.empresa}</td>
                    <td style={{ padding:'10px 14px', textAlign:'center' }}>
                      {v.vuelos>0 ? <span style={{ ...badgeStyle, background:'#e8f0fe', color:M.blue }}>{v.vuelos}</span> : <span style={{ color:M.border }}>—</span>}
                    </td>
                    <td style={{ padding:'10px 14px', textAlign:'center' }}>
                      {v.hoteles>0 ? <span style={{ ...badgeStyle, background:'#fff0eb', color:M.orange }}>{v.hoteles}</span> : <span style={{ color:M.border }}>—</span>}
                    </td>
                    <td style={{ padding:'10px 14px', textAlign:'center' }}>
                      {v.autos>0 ? <span style={{ ...badgeStyle, background:'#e0f2fe', color:'#0369a1' }}>{v.autos}</span> : <span style={{ color:M.border }}>—</span>}
                    </td>
                    <td style={{ padding:'10px 14px', textAlign:'center' }}>
                      <span style={{ fontWeight:700, color:M.navy }}>{v.viajes}</span>
                    </td>
                    <td style={{ padding:'10px 14px', textAlign:'center', whiteSpace:'nowrap' }}>
                      {v.gastoUSD > 0
                        ? <div>
                            <div style={{ fontWeight:700, color:M.navy }}>USD {fmtMonto(v.gastoUSD)}</div>
                            {topMoneda && topMoneda[0]!=='USD' && <div style={{ fontSize:'11px', color:M.textSec }}>{topMoneda[0]} {fmtMonto(topMoneda[1])}</div>}
                          </div>
                        : topMoneda
                          ? <span style={{ fontWeight:600, color:M.navy }}>{topMoneda[0]} {fmtMonto(topMoneda[1])}</span>
                          : <span style={{ color:M.border }}>—</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Picos de compras por país ── */}
      {data.picosPorPais.paises.length > 0 && (
        <div style={cardStyle}>
          <ChartTitle>Picos de compra por país — hora local</ChartTitle>
          <div style={{ display:'flex', flexWrap:'wrap', gap:'10px', marginTop:'4px' }}>
            {data.picosPorPais.paises.map((pais, i) => {
              const porHora = data.picosPorPais.chartData.map((d, h) => ({ h, v: d[pais] || 0 }))
              // ventana deslizante de 3 horas con más reservas
              let bestStart = 0, bestSum = 0
              for (let h = 0; h <= 21; h++) {
                const sum = (porHora[h]?.v||0) + (porHora[h+1]?.v||0) + (porHora[h+2]?.v||0)
                if (sum > bestSum) { bestSum = sum; bestStart = h }
              }
              if (!bestSum) return null
              const desde = String(bestStart).padStart(2,'0')
              const hasta  = String(bestStart + 3).padStart(2,'0')
              return (
                <div key={pais} style={{ background:M.bg, borderRadius:'8px', padding:'10px 14px',
                  borderLeft:`3px solid ${M.chartColors[i % M.chartColors.length]}`, minWidth:'140px' }}>
                  <div style={{ fontSize:'11px', fontWeight:700, color:M.textSec, textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:'4px' }}>
                    {data.picosPorPais.labels[pais] || pais}
                  </div>
                  <div style={{ fontSize:'13px', fontWeight:700, color:M.navy }}>
                    {desde}:00–{hasta}:00 h
                  </div>
                  <div style={{ fontSize:'11px', color:M.textSec, marginTop:'2px' }}>
                    {bestSum} reservas
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Sankeys por producto ── */}
      {data.sankeyByProduct.length > 0 && (() => {
        // Índices:  0=Producto(col izq)  1-3=col media  4-7=col derecha
        // Colores por índice de nodo:
        const STAGE_COLORS = ['', '#f97316', '#10b981', '#94a3b8', '#60a5fa', '#059669', '#6b7280', '#c5221f']

        const makeSankeyNode = (prodColor, prodTotal) =>
          function SankeyNode({ x, y, width, height, index, payload }) {
            const color   = index === 0 ? prodColor : STAGE_COLORS[index]
            const isLeft  = index === 0          // col izquierda → etiqueta a la izquierda
            const isMid   = index >= 1 && index <= 3  // col media → etiqueta a la izquierda (espacio libre)
            const isRight = index >= 4           // col derecha → etiqueta a la derecha

            const GAP = 8
            const labelX = isRight ? x + width + GAP : x - GAP
            const anchor = isRight ? 'start' : 'end'

            const val = payload.value != null ? payload.value.toLocaleString('es-AR') : ''
            const pct = prodTotal > 0 ? ` (${Math.round((payload.value / prodTotal) * 100)}%)` : ''

            const bar = <Rectangle x={x} y={y} width={width} height={height} fill={color} fillOpacity={0.95} rx={2} />
            // Nodo muy pequeño: solo la barra sin texto
            if (height < 8) return <Layer key={`node-${index}`}>{bar}</Layer>
            // Nodo pequeño: una sola línea compacta
            const compact = height < 26
            return (
              <Layer key={`node-${index}`}>
                {bar}
                {compact ? (
                  <text x={labelX} y={y + height / 2} textAnchor={anchor}
                    fill={M.navy} fontSize={10} fontWeight={600} dy="0.35em">
                    {`${payload.name}: ${val}${pct}`}
                  </text>
                ) : (
                  <>
                    <text x={labelX} y={y + height / 2 - 7} textAnchor={anchor}
                      fill={M.navy} fontSize={11} fontWeight={700} dy="0.35em">
                      {`${val}${pct}`}
                    </text>
                    <text x={labelX} y={y + height / 2 + 8} textAnchor={anchor}
                      fill={M.textSec} fontSize={10} dy="0.35em">
                      {payload.name}
                    </text>
                  </>
                )}
              </Layer>
            )
          }

        const makeSankeyLink = (prodColor) =>
          function SankeyLink({ sourceX, targetX, sourceY, targetY, sourceControlX, targetControlX, linkWidth, index, payload }) {
            const color = payload.source.index === 0 ? prodColor : (STAGE_COLORS[payload.source.index] || '#aaa')
            return (
              <Layer key={`link-${index}`}>
                <path
                  d={`M${sourceX},${sourceY + linkWidth / 2} C${sourceControlX},${sourceY + linkWidth / 2} ${targetControlX},${targetY + linkWidth / 2} ${targetX},${targetY + linkWidth / 2} L${targetX},${targetY - linkWidth / 2} C${targetControlX},${targetY - linkWidth / 2} ${sourceControlX},${sourceY - linkWidth / 2} ${sourceX},${sourceY - linkWidth / 2} Z`}
                  fill={color} fillOpacity={0.15} stroke={color} strokeWidth={0.5} strokeOpacity={0.25}
                />
              </Layer>
            )
          }

        return (
          <div className="sankey-section">
            <div style={{ ...cardStyle, marginBottom:'4px' }}>
              <ChartTitle>Flujo de solicitudes por producto — aprobación → emisión</ChartTitle>
              <div style={{ display:'flex', flexWrap:'wrap', gap:'10px' }}>
                {[
                  { label:'Pend. Aprobación', color:'#f97316' },
                  { label:'Aprobada',         color:'#10b981' },
                  { label:'Expirada',         color:'#94a3b8' },
                  { label:'Pend. Emisión',    color:'#60a5fa' },
                  { label:'Emitida',          color:'#059669' },
                  { label:'Cancelada',        color:'#6b7280' },
                  { label:'Error',            color:'#c5221f' },
                ].map(({ label, color }) => (
                  <div key={label} style={{ display:'flex', alignItems:'center', gap:'5px' }}>
                    <div style={{ width:'8px', height:'8px', borderRadius:'2px', background:color, flexShrink:0 }} />
                    <span style={{ fontSize:'11px', color:M.textSec }}>{label}</span>
                  </div>
                ))}
              </div>
            </div>
            {data.sankeyByProduct.map(({ label, color, total: prodTotal, nodes, links }) => (
              <div key={label} style={{ ...cardStyle, marginBottom:'12px' }}>
                <div style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'4px' }}>
                  <div style={{ width:'10px', height:'10px', borderRadius:'2px', background:color }} />
                  <span style={{ fontSize:'12px', fontWeight:700, color:M.navy, textTransform:'uppercase', letterSpacing:'0.06em' }}>
                    {label}
                  </span>
                  <span style={{ fontSize:'12px', color:M.textSec }}>— {prodTotal.toLocaleString('es-AR')} solicitudes</span>
                </div>
                <ResponsiveContainer width="100%" height={240}>
                  <Sankey
                    data={{ nodes, links }}
                    nodePadding={14}
                    nodeWidth={14}
                    margin={{ top:10, right:185, left:140, bottom:10 }}
                    node={makeSankeyNode(color, prodTotal)}
                    link={makeSankeyLink(color)}
                  >
                    <Tooltip
                      contentStyle={{ fontSize:'12px', borderRadius:'8px', border:`1px solid ${M.border}` }}
                      formatter={(v) => [v.toLocaleString('es-AR'), 'solicitudes']}
                    />
                  </Sankey>
                </ResponsiveContainer>
              </div>
            ))}
          </div>
        )
      })()}

      <ErrorModal modal={errorModal} filtered={filtered} onClose={() => setErrorModal(null)} />

      {/* ── Top 10 Errores por Producto ─────────────────────────────────────── */}
      {data.topErrorsByProduct.length > 0 && (() => {
        return (
          <>
            <div style={{ marginTop:'32px', marginBottom:'16px', display:'flex', alignItems:'center', gap:'10px' }}>
              <div style={{ width:'3px', height:'20px', background:'#c5221f', borderRadius:'2px' }} />
              <span style={{ fontSize:'11px', fontWeight:700, color:M.textSec, letterSpacing:'0.07em', textTransform:'uppercase' }}>
                Top 10 Errores por Producto
              </span>
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>
              {data.topErrorsByProduct.map(({ prod, name, color, data: errData, total, totalRaw }) => (
                <div key={prod} style={cardStyle}>
                  <div style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'16px' }}>
                    <div style={{ width:'10px', height:'10px', borderRadius:'2px', background:color }} />
                    <span style={{ fontSize:'12px', fontWeight:700, color:M.navy, textTransform:'uppercase', letterSpacing:'0.06em' }}>
                      {name}
                    </span>
                    <span style={{ fontSize:'12px', color:M.textSec }}>— {total} usuarios afectados · {totalRaw} errores</span>
                  </div>
                  <div className="chart-scroll">
                  <ResponsiveContainer width="100%" minWidth={480} height={errData.length * 36 + 20}>
                    <BC
                      data={errData}
                      layout="vertical"
                      margin={{ top:0, right:50, left:8, bottom:0 }}
                      style={{ cursor:'pointer' }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize:11, fill:M.textSec }} tickLine={false} axisLine={false} allowDecimals={false} />
                      <YAxis
                        type="category"
                        dataKey="label"
                        width={220}
                        tick={{ fontSize:11, fill:M.navy }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <Tooltip content={<ErrorTooltip />} />
                      <Bar dataKey="rawCount" name="Errores" fill={color} radius={[0,4,4,0]}>
                        {errData.map((entry, i) => (
                          <Cell
                            key={i}
                            fill={color}
                            fillOpacity={1 - i * 0.07}
                            style={{ cursor:'pointer' }}
                            onClick={() => setErrorModal({ prod, full: entry.full, normalizedKey: entry.normalizedKey })}
                          />
                        ))}
                      </Bar>
                    </BC>
                  </ResponsiveContainer>
                  </div>
                </div>
              ))}
            </div>
          </>
        )
      })()}
    </div>
  )
}

// ── Main Dashboard ────────────────────────────────────────────────────────────
export default function Dashboard({ data }) {
  const { reservas, last_updated } = data

  const [tab, setTab]                       = useState('analytics')
  const [search, setSearch]                 = useState('')
  const [filterProducto, setFilterProducto] = useState('')
  const [filterEstado, setFilterEstado]     = useState('')
  const [filterAprobado, setFilterAprobado] = useState('')
  const [filterCanal, setFilterCanal]       = useState('')
  const [filterMoneda, setFilterMoneda]     = useState('')
  const [fechaDesde, setFechaDesde]         = useState('')
  const [fechaHasta, setFechaHasta]         = useState('')
  const [sortCol, setSortCol]               = useState('fecha')
  const [sortDir, setSortDir]               = useState('desc')
  const [page, setPage]                     = useState(1)
  const [cardFilter, setCardFilter]         = useState('')
  const [lastUpdatedFmt, setLastUpdatedFmt] = useState('')

  useEffect(() => {
    setLastUpdatedFmt(new Date(last_updated).toLocaleString('es-AR', {
      day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit',
    }))
  }, [last_updated])

  const filteredBase = useMemo(() => {
    let rows = reservas.filter(r => r.fecha)
    if (search.trim()) {
      const s = search.toLowerCase()
      rows = rows.filter(r =>
        (r.empresa || '').toLowerCase().includes(s) ||
        (r.viajero || '').toLowerCase().includes(s) ||
        (r.pnr     || '').toLowerCase().includes(s) ||
        (r.mail    || '').toLowerCase().includes(s)
      )
    }
    if (filterProducto) rows = rows.filter(r => r.producto === filterProducto)
    if (filterEstado)   rows = rows.filter(r => r.estado   === filterEstado)
    if (filterAprobado) rows = rows.filter(r => r.aprobado === filterAprobado)
    if (filterCanal)    rows = rows.filter(r => r.canal    === filterCanal)
    if (filterMoneda)   rows = rows.filter(r => r.moneda   === filterMoneda)
    if (fechaDesde)     rows = rows.filter(r => r.fecha >= fechaDesde)
    if (fechaHasta)     rows = rows.filter(r => r.fecha <= fechaHasta)
    return rows
  }, [reservas, search, filterProducto, filterEstado, filterAprobado, filterCanal, filterMoneda, fechaDesde, fechaHasta])

  const filtered = useMemo(() => {
    const rows = cardFilter && CARD_FILTERS[cardFilter]
      ? filteredBase.filter(CARD_FILTERS[cardFilter])
      : filteredBase
    return [...rows].sort((a, b) => {
      let cmp
      if (sortCol === 'monto') {
        cmp = (a.monto || 0) - (b.monto || 0)
      } else if (sortCol === 'fecha') {
        cmp = (a.fecha_hora || '').localeCompare(b.fecha_hora || '')
      } else if (sortCol === 'empresa') {
        cmp = fmtEmpresa(a.empresa).localeCompare(fmtEmpresa(b.empresa))
      } else {
        const va = (a[sortCol] || '').toLowerCase()
        const vb = (b[sortCol] || '').toLowerCase()
        cmp = va.localeCompare(vb)
      }
      return sortDir === 'desc' ? -cmp : cmp
    })
  }, [filteredBase, cardFilter, sortCol, sortDir])

  useEffect(() => setPage(1), [search, filterProducto, filterEstado, filterAprobado, filterCanal, filterMoneda, fechaDesde, fechaHasta, cardFilter, sortCol, sortDir])

  const stats = useMemo(() => ({
    total:           filteredBase.filter(r => r.pnr).length,
    emitidas:        filteredBase.filter(isEmitida).length,
    enProceso:       filteredBase.filter(isEnProceso).length,
    errores:         filteredBase.filter(isError).length,
    erroresGenerales:filteredBase.filter(isErrorGeneral).length,
    canceladas:      filteredBase.filter(r => r.estado === 'CANCELLED' && r.aprobado === 'CANCELLED').length,
    expiradas:       filteredBase.filter(r => r.estado === 'CANCELLED' && r.aprobado === 'EXPIRED').length,
    rechazadas:      filteredBase.filter(r => r.estado === 'CANCELLED' && r.aprobado === 'DECLINED').length,
    pendAprobacion:  filteredBase.filter(r => r.aprobado === 'PENDING').length,
    flights:         filteredBase.filter(r => r.producto === 'FLIGHT').length,
    hotels:          filteredBase.filter(r => r.producto === 'ACCOMMODATION').length,
    cars:            filteredBase.filter(r => r.producto === 'CAR').length,
    carsEmitidas:    filteredBase.filter(r => r.producto === 'CAR' && isEmitida(r)).length,
    viajeros:        new Set(filteredBase.map(r => r.mail).filter(Boolean)).size,
  }), [filteredBase])

  const pcts = useMemo(() => calcPcts(stats), [stats])

  const totalPages = Math.ceil(filtered.length / PER_PAGE)
  const rows       = filtered.slice((page-1)*PER_PAGE, page*PER_PAGE)
  const startPage  = Math.max(1, Math.min(totalPages-4, page-2))
  const pageWindow = Array.from({ length: Math.min(5, totalPages) }, (_,i) => startPage+i)

  const clearFilters = () => {
    setSearch(''); setFilterProducto(''); setFilterEstado(''); setFilterAprobado('')
    setFilterCanal(''); setFilterMoneda(''); setFechaDesde(''); setFechaHasta('')
    setCardFilter('')
  }

  const handleCardClick = (key) => {
    setCardFilter(prev => prev === key ? '' : key)
    setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 50)
  }

  const applyInsightFilter = ({ estado, aprobado, producto, canal } = {}) => {
    clearFilters()
    if (estado)   setFilterEstado(estado)
    if (aprobado) setFilterAprobado(aprobado)
    if (producto) setFilterProducto(producto)
    if (canal)    setFilterCanal(canal)
    setTab('reservas')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const activeFilters = [search,filterProducto,filterEstado,filterAprobado,filterCanal,filterMoneda,fechaDesde,fechaHasta,cardFilter].filter(Boolean).length

  const exportToExcel = () => {
    const rows = filtered.map(r => ({
      'Fecha':       r.fecha,
      'Hora':        r.hora,
      'Tipo':        r.producto,
      'PNR':         r.pnr,
      'Grupo':       r.grupo,
      'Viajero':     r.viajero,
      'Mail':        r.mail,
      'Empresa':     r.empresa,
      'Estado':      r.estado,
      'Aprobado':    r.aprobado,
      'Proveedor':   r.proveedor,
      'Canal':       r.canal,
      'Monto':       r.monto,
      'Moneda':      r.moneda,
      'Monto USD':   r.monto_usd,
      'Viaje':       r.viaje_iniciado,
      'Aprobador':   r.aprobador,
      'Error':       r.error_message,
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Reservas')
    const fecha = new Date().toISOString().slice(0,10)
    XLSX.writeFile(wb, `reservas_${fecha}.xlsx`)
  }

  const handleSort = (col) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }
  const sortIcon = (col) => {
    if (sortCol !== col) return <span style={{ opacity:0.3, marginLeft:'4px', fontSize:'10px' }}>↕</span>
    return <span style={{ marginLeft:'4px', color: M.orange, fontWeight:700 }}>{sortDir === 'asc' ? '↑' : '↓'}</span>
  }


  return (
    <div style={{ minHeight:'100vh', background:M.bg }}>
      <Head>
        <title>Mendel Travel Dashboard</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
        <meta name="description" content="Dashboard de reservas de viajes corporativos — Mendel Travel" />
        <meta property="og:title" content="Mendel Travel Dashboard" />
        <meta property="og:description" content="Dashboard de reservas de viajes corporativos — Mendel Travel" />
        <meta property="og:url" content="https://reservas-dashboard.vercel.app" />
        <meta property="og:type" content="website" />
        <meta property="og:image" content="https://reservas-dashboard.vercel.app/og-image.png" />
      </Head>

      {/* ── Header ── */}
      <header className="header-root">
        <div className="header-left">
          <div className="header-logo-area">
            <div>
              <img className="header-logo-img" src="/mendel_travel.svg" alt="Mendel Travel"
                style={{ height:'26px', filter:'brightness(0) invert(1)', display:'block' }} />
              <div className="header-logo-sub">Travel Dashboard</div>
            </div>
          </div>
          <nav className="header-tabs">
            {[['reservas','Reservas'],['analytics','Analytics']].map(([key,label])=>(
              <button key={key} onClick={()=>setTab(key)} style={{
                padding:'0 22px', fontSize:'13px', fontWeight:600,
                cursor:'pointer', border:'none', background:'transparent',
                color: tab===key ? M.offwhite : 'rgba(255,255,255,0.45)',
                borderBottom: tab===key ? `3px solid ${M.orange}` : '3px solid transparent',
                fontWeight: tab===key ? 700 : 500,
              }}>{label}</button>
            ))}
          </nav>
        </div>
        <div className="header-right">
          <div style={{ width:'6px', height:'6px', borderRadius:'50%', background:'#10b981', flexShrink:0 }} />
          <span><span className="header-updated-label">Actualizado: </span><b style={{ color:'rgba(255,255,255,0.75)' }}>{lastUpdatedFmt}</b></span>
          <button className="header-logout" onClick={() => {
            if (!window.confirm('¿Cerrar sesión?')) return
            document.cookie = 'mendel_auth=; path=/; max-age=0'
            window.location.href = '/login'
          }} style={{
            marginLeft: '16px', padding: '5px 12px', fontSize: '12px', fontWeight: 600,
            background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.6)',
            border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', cursor: 'pointer',
          }}>Salir</button>
        </div>
      </header>

      <main className="main-pad">

        {/* ── Filters ── */}
        <div style={{ background:M.offwhite, borderRadius:'12px', padding:'16px 20px',
          boxShadow:'0 1px 4px rgba(0,0,0,0.07)', marginBottom:'20px', border:`1px solid ${M.border}` }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'12px' }}>
            <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
              <span style={{ fontWeight:700, fontSize:'13px', color:M.navy }}>Filtros</span>
              {activeFilters>0 && (
                <span style={{ ...badgeStyle, background:'#e8f0fe', color:M.blue, fontSize:'10px' }}>
                  {activeFilters} activo{activeFilters>1?'s':''}
                </span>
              )}
            </div>
            {activeFilters>0 && (
              <button onClick={clearFilters} style={{ fontSize:'12px', color:M.orange, background:'none', border:'none', cursor:'pointer', fontWeight:600 }}>
                Limpiar
              </button>
            )}
          </div>
          <div className="grid-filters">
            <input placeholder="Empresa, viajero, PNR, mail..." value={search} onChange={e=>setSearch(e.target.value)} style={inputStyle} />
            <select value={filterProducto} onChange={e=>setFilterProducto(e.target.value)} style={inputStyle}>
              <option value="">Todos los productos</option>
              <option value="FLIGHT">Vuelo</option>
              <option value="ACCOMMODATION">Hospedaje</option>
              <option value="CAR">Auto</option>
            </select>
            <select value={filterEstado} onChange={e=>setFilterEstado(e.target.value)} style={inputStyle}>
              <option value="">Todos los estados</option>
              <option value="ISSUED">ISSUED</option>
              <option value="ISSUING">ISSUING</option>
              <option value="BOOKED">BOOKED</option>
              <option value="BOOKING">BOOKING</option>
              <option value="ERROR">ERROR</option>
              <option value="CANCELLED">CANCELLED</option>
            </select>
            <select value={filterAprobado} onChange={e=>setFilterAprobado(e.target.value)} style={inputStyle}>
              <option value="">Todos los aprobados</option>
              <option value="APPROVED">APPROVED</option>
              <option value="PENDING">PENDING</option>
              <option value="ERROR">ERROR</option>
              <option value="CANCELLED">CANCELLED</option>
              <option value="EXPIRED">EXPIRED</option>
              <option value="DECLINED">DECLINED</option>
            </select>
            <select value={filterCanal} onChange={e=>setFilterCanal(e.target.value)} style={inputStyle}>
              <option value="">Todos los canales</option>
              <option value="ONLINE">ONLINE</option>
              <option value="OFFLINE">OFFLINE</option>
            </select>
            <select value={filterMoneda} onChange={e=>setFilterMoneda(e.target.value)} style={inputStyle}>
              <option value="">Todas las monedas</option>
              {MONEDAS.map(m=><option key={m} value={m}>{m}</option>)}
            </select>
            <div>
              <label style={{ fontSize:'11px', fontWeight:600, color:M.textSec, marginBottom:'4px', display:'block', textTransform:'uppercase', letterSpacing:'0.04em' }}>Desde</label>
              <input type="date" value={fechaDesde} onChange={e=>setFechaDesde(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={{ fontSize:'11px', fontWeight:600, color:M.textSec, marginBottom:'4px', display:'block', textTransform:'uppercase', letterSpacing:'0.04em' }}>Hasta</label>
              <input type="date" value={fechaHasta} onChange={e=>setFechaHasta(e.target.value)} style={inputStyle} />
            </div>
          </div>
        </div>

        {/* ── Tab: Reservas ── */}
        {tab === 'reservas' && (
          <>
            {/* Fila 1: funnel de estados */}
            <div className="grid-stats">
              <StatCard label="Total Solicitudes" value={stats.total} color={M.navy}
                tooltip="Solicitudes que llegaron a generar un PNR, independientemente de su estado final."
                onClick={clearFilters} active={activeFilters === 0} />
              <StatCard label="Emitidas"          value={stats.emitidas}   color="#10b981"
                sub={`${pcts.emitidas}% del total`}
                tooltip={"Reservas con estado ISSUED o BOOKED y aprobación APPROVED.\nUsuarios VIP: estado ISSUED/BOOKED (sin flujo de aprobación)."}
                onClick={() => handleCardClick('emitidas')} active={cardFilter === 'emitidas'} />
              <StatCard label="En Proceso"        value={stats.enProceso}  color={M.blue}
                sub={`${pcts.enProceso}% del total`}
                tooltip={"Reservas en estado ISSUING o BOOKING que aún no finalizaron.\nNo incluye BOOKING atascados (fecha anterior a hoy) ni VIP con aprobado ERROR."}
                onClick={() => handleCardClick('enProceso')} active={cardFilter === 'enProceso'} />
              <StatCard label="Con Error"         value={stats.errores}    color="#c5221f"
                sub={`${pcts.errores}% del total`}
                tooltip={"Reservas con error_message y PNR, BOOKING atascados (fecha anterior a hoy), estado ISSUED/BOOKED con aprobado ERROR (no VIP), BOOKING+ERROR para VIP, o estado ERROR con PNR."}
                onClick={() => handleCardClick('errores')} active={cardFilter === 'errores'} />
              <StatCard label="Canceladas"        value={stats.canceladas} color="#94a3b8"
                sub={`${pcts.canceladas}% del total`}
                tooltip="Reservas con estado CANCELLED y aprobado CANCELLED. El viajero o un admin canceló la reserva."
                onClick={() => handleCardClick('canceladas')} active={cardFilter === 'canceladas'} />
              <StatCard label="Expiradas"         value={stats.expiradas}  color="#f97316"
                sub={`${pcts.expiradas}% del total`}
                tooltip="Reservas con estado CANCELLED y aprobado EXPIRED. El tiempo de aprobación venció antes de que se aprobara."
                onClick={() => handleCardClick('expiradas')} active={cardFilter === 'expiradas'} />
              <StatCard label="Rechazadas"        value={stats.rechazadas} color="#be123c"
                sub={`${pcts.rechazadas}% del total`}
                tooltip="Reservas con estado CANCELLED y aprobado DECLINED. Un aprobador rechazó la solicitud."
                onClick={() => handleCardClick('rechazadas')} active={cardFilter === 'rechazadas'} />
              <StatCard label="Errores Generales" value={stats.erroresGenerales} color="#7c3aed"
                sub="sin PNR asociado"
                tooltip="Solicitudes con error_message o estado ERROR que nunca generaron PNR. No se computan en el total ni en los porcentajes."
                onClick={() => handleCardClick('erroresGenerales')} active={cardFilter === 'erroresGenerales'} />
            </div>
            {/* Fila 2: por producto y aprobación */}
            <div className="grid-stats" style={{ marginTop:'12px' }}>
              <StatCard label="Vuelos"               value={stats.flights}        color={M.blue}
                sub={`${stats.total ? Math.round(stats.flights/stats.total*100):0}% del total`}
                onClick={() => handleCardClick('flights')} active={cardFilter === 'flights'} />
              <StatCard label="Hospedajes"           value={stats.hotels}         color={M.orange}
                sub={`${stats.total ? Math.round(stats.hotels/stats.total*100):0}% del total`}
                onClick={() => handleCardClick('hotels')} active={cardFilter === 'hotels'} />
              <StatCard label="Autos"                value={stats.cars}           color="#0ea5e9"
                sub={stats.carsEmitidas === 0 ? '⚠ 0 emitidos' : `${stats.carsEmitidas} emitidos`}
                onClick={() => handleCardClick('cars')} active={cardFilter === 'cars'} />
              <StatCard label="Pend. Aprobación"     value={stats.pendAprobacion} color="#f97316"
                sub={`${stats.total ? Math.round(stats.pendAprobacion/stats.total*100):0}% del total`}
                onClick={() => handleCardClick('pendAprobacion')} active={cardFilter === 'pendAprobacion'} />
              <StatCard label="Viajeros Únicos"      value={stats.viajeros}       color="#6366f1" />
            </div>

            <InsightsPanel filtered={filteredBase} stats={stats} onApplyFilter={applyInsightFilter} />

            <div style={{ background:M.offwhite, borderRadius:'12px', boxShadow:'0 1px 4px rgba(0,0,0,0.07)', border:`1px solid ${M.border}`, overflow:'hidden' }}>
              <div style={{ padding:'12px 20px', borderBottom:`1px solid ${M.border}`, display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                <span style={{ fontSize:'14px', color:M.navy, fontWeight:600 }}>
                  {filtered.length.toLocaleString('es-AR')} solicitudes
                </span>
                <button
                  onClick={exportToExcel}
                  style={{ display:'flex', alignItems:'center', gap:'6px', padding:'6px 14px', fontSize:'12px', fontWeight:600, color:'#fff', background:M.blue, border:'none', borderRadius:'8px', cursor:'pointer' }}
                >
                  ↓ Exportar Excel
                </button>
              </div>

              <div style={{ overflowX:'auto' }}>
                <table className="dash-table" style={{ width:'100%', borderCollapse:'collapse', fontSize:'13px' }}>
                  <thead>
                    <tr style={{ background:M.bg, borderBottom:`2px solid ${M.border}` }}>
                      {[
                        { label:'Fecha',    col:'fecha',          align:'left',  cls:'' },
                        { label:'Tipo',     col:'producto',       align:'left',  cls:'' },
                        { label:'Grupo',    col:'grupo',          align:'left',  cls:'col-hora' },
                        { label:'PNR',      col:'pnr',            align:'left',  cls:'' },
                        { label:'Viajero',  col:'viajero',        align:'left',  cls:'' },
                        { label:'Mail',     col:'mail',           align:'left',  cls:'col-hora' },
                        { label:'Empresa',  col:'empresa',        align:'left',  cls:'' },
                        { label:'Estado',   col:'estado',         align:'left',  cls:'' },
                        { label:'Aprobado', col:'aprobado',       align:'left',  cls:'col-aprobado' },
                        { label:'Monto',    col:'monto',          align:'right', cls:'' },
                        { label:'Proveedor', col:'proveedor',      align:'left',  cls:'col-hora' },
                        { label:'Canal',    col:'canal',          align:'left',  cls:'' },
                        { label:'Viaje',    col:'viaje_iniciado', align:'left',  cls:'col-viaje' },
                      ].map(({ label, col, align, cls }) => (
                        <th key={col} className={cls}
                          onClick={() => handleSort(col)}
                          style={{
                            textAlign: align, fontWeight:700, whiteSpace:'nowrap',
                            fontSize:'11px', letterSpacing:'0.05em', textTransform:'uppercase',
                            cursor:'pointer', userSelect:'none',
                            color: sortCol === col ? M.navy : M.textSec,
                            transition:'color .15s',
                          }}>
                          {label}{sortIcon(col)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r,i)=>(
                      <tr key={r.unique_code||i} style={{ borderBottom:`1px solid ${M.bg}`, background: i%2===0 ? M.offwhite : '#fafafa' }}>
                        <td style={{ whiteSpace:'nowrap' }}>
                          <div style={{ color:M.navy, fontWeight:500 }}>{fmtDate(r.fecha)}</div>
                          <div style={{ color:M.textSec, fontSize:'11px' }}>{r.hora?.slice(0,5)}</div>
                        </td>
                        <td>
                          <span style={{ ...badgeStyle,
                            background: r.producto==='FLIGHT' ? '#e8f0fe' : r.producto==='ACCOMMODATION' ? '#fff0eb' : '#e0f2fe',
                            color:      r.producto==='FLIGHT' ? M.blue    : r.producto==='ACCOMMODATION' ? M.orange  : '#0369a1' }}>
                            {r.producto==='FLIGHT' ? 'Vuelo' : r.producto==='ACCOMMODATION' ? 'Hotel' : r.producto==='CAR' ? 'Auto' : r.producto||'-'}
                          </span>
                        </td>
                        <td className="col-hora" style={{ whiteSpace:'nowrap', color:M.textSec, fontSize:'12px' }}>{r.grupo||'-'}</td>
                        <td style={{ fontFamily:'monospace', fontWeight:700, color:M.blue, whiteSpace:'nowrap' }}>
                          <PnrLink uniqueCode={r.unique_code} pnr={r.pnr} />
                        </td>
                                        <td style={{ maxWidth:'150px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', color:M.navy }} title={r.viajero}>{r.viajero||'-'}</td>
                        <td className="col-hora" style={{ maxWidth:'200px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', color:M.textSec, fontSize:'12px' }} title={r.mail}>{r.mail||'-'}</td>
                        <td style={{ whiteSpace:'nowrap', color:M.textSec, fontSize:'12px', fontWeight:500 }} title={r.empresa}>{fmtEmpresa(r.empresa)}</td>
                        <td><Badge value={r.estado}          map={estadoMap} /></td>
                        <td className="col-aprobado"><Badge value={r.aprobado}        map={aprobadoMap} /></td>
                        <td style={{ whiteSpace:'nowrap', textAlign:'right', fontWeight:600, color:M.navy }}>
                          {r.monto ? `${r.moneda} ${r.monto.toLocaleString('es-AR',{maximumFractionDigits:0})}` : '-'}
                        </td>
                        <td className="col-hora" style={{ whiteSpace:'nowrap', color:M.textSec, fontSize:'12px' }}>{r.proveedor||'N/A'}</td>
                        <td><Badge value={r.canal}           map={canalMap} /></td>
                        <td className="col-viaje"><Badge value={r.viaje_iniciado}  map={viajeMap} /></td>
                      </tr>
                    ))}
                    {rows.length===0 && (
                      <tr><td colSpan={12} style={{ padding:'56px 24px', textAlign:'center' }}>
                        <div style={{ fontSize:'28px', marginBottom:'12px' }}>🔍</div>
                        <div style={{ fontSize:'14px', fontWeight:600, color:M.navy, marginBottom:'6px' }}>Sin resultados</div>
                        <div style={{ fontSize:'13px', color:M.textSec }}>Ninguna solicitud coincide con los filtros activos.</div>
                        {activeFilters > 0 && (
                          <button onClick={clearFilters} style={{ marginTop:'14px', padding:'8px 18px', fontSize:'13px', fontWeight:600,
                            background:M.blue, color:'white', border:'none', borderRadius:'8px', cursor:'pointer' }}>
                            Limpiar filtros
                          </button>
                        )}
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              {totalPages>1 && (
                <div style={{ padding:'12px 20px', borderTop:`1px solid ${M.border}`, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <span className="pagination-info" style={{ color:M.textSec }}>
                    Pag. {page}/{totalPages} · {((page-1)*PER_PAGE)+1}–{Math.min(page*PER_PAGE,filtered.length)} de {filtered.length}
                  </span>
                  <div style={{ display:'flex', gap:'6px' }}>
                    <button onClick={()=>setPage(1)}           disabled={page===1}          style={pageBtn}>«</button>
                    <button onClick={()=>setPage(p=>p-1)}     disabled={page===1}          style={pageBtn}>‹</button>
                    {pageWindow.map(p=>(
                      <button key={p} onClick={()=>setPage(p)} style={{ ...pageBtn,
                        background: p===page ? M.blue : M.offwhite,
                        color:      p===page ? 'white': M.navy,
                        borderColor:p===page ? M.blue : M.border,
                        fontWeight: p===page ? 700   : 400,
                      }}>{p}</button>
                    ))}
                    <button onClick={()=>setPage(p=>p+1)}     disabled={page===totalPages} style={pageBtn}>›</button>
                    <button onClick={()=>setPage(totalPages)} disabled={page===totalPages} style={pageBtn}>»</button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {/* ── Tab: Analytics ── */}
        {tab==='analytics' && <Analytics filtered={filtered} stats={stats} onCardClick={handleCardClick} cardFilter={cardFilter} activeFilters={activeFilters} onClearFilters={clearFilters} />}

      </main>
    </div>
  )
}

export async function getStaticProps() {
  const filePath = path.join(process.cwd(), 'public', 'data.json')
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  return { props: { data } }
}
