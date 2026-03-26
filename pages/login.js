import { useState } from 'react'
import Head from 'next/head'
import { useRouter } from 'next/router'

export default function Login() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const router = useRouter()

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!email.toLowerCase().endsWith('@mendel.com')) {
      setError('Solo se permiten cuentas @mendel.com')
      return
    }
    document.cookie = `mendel_auth=${email}; path=/; max-age=${60 * 60 * 24 * 7}`
    router.push('/')
  }

  return (
    <>
      <Head>
        <title>Mendel Viajes — Dashboard</title>
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <div style={{
        minHeight: '100vh',
        background: '#0D1B35',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: "'Inter', system-ui, sans-serif",
        position: 'relative',
        overflow: 'hidden',
      }}>

        {/* Fondo geométrico tipo Mendel */}
        <svg
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
          viewBox="0 0 1440 900"
          preserveAspectRatio="xMidYMid slice"
        >
          <polygon points="-100,900 350,150 750,900" fill="#12264A" opacity="0.8" />
          <polygon points="550,900 950,80 1400,900" fill="#12264A" opacity="0.8" />
          <polygon points="150,900 550,350 850,900" fill="#0F1E3E" opacity="0.6" />
          <polygon points="900,900 1200,300 1500,900" fill="#0F1E3E" opacity="0.5" />
        </svg>

        {/* Card */}
        <div style={{
          position: 'relative',
          zIndex: 1,
          background: '#ffffff',
          borderRadius: '20px',
          padding: '48px 40px 40px',
          width: '100%',
          maxWidth: '420px',
          boxShadow: '0 12px 48px rgba(0,0,0,0.35)',
          margin: '0 16px',
        }}>

          {/* Logo */}
          <div style={{ textAlign: 'center', marginBottom: '10px' }}>
            <img
              src="/mendel_travel.svg"
              alt="Mendel Viajes"
              style={{ height: '30px' }}
            />
          </div>

          {/* Subtítulo */}
          <p style={{
            textAlign: 'center',
            color: '#6B7280',
            fontSize: '14px',
            margin: '0 0 32px',
          }}>
            Ingresá con tu cuenta corporativa
          </p>

          <form onSubmit={handleSubmit}>

            {/* Campo email */}
            <div style={{ marginBottom: '20px' }}>
              <div style={{ position: 'relative' }}>
                <span style={{
                  position: 'absolute', left: '13px', top: '50%',
                  transform: 'translateY(-50%)', color: '#9CA3AF',
                  display: 'flex', alignItems: 'center',
                }}>
                  <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round"
                      d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </span>
                <input
                  type="email"
                  placeholder="Email"
                  value={email}
                  onChange={e => { setEmail(e.target.value); setError('') }}
                  required
                  style={{
                    width: '100%',
                    padding: '12px 14px 12px 40px',
                    border: `1.5px solid ${error ? '#EF4444' : '#E5E7EB'}`,
                    borderRadius: '10px',
                    fontSize: '14px',
                    outline: 'none',
                    background: '#EEF4FF',
                    color: '#111827',
                    boxSizing: 'border-box',
                    transition: 'border-color 0.15s',
                  }}
                />
              </div>
              {error && (
                <div style={{ fontSize: '12px', color: '#EF4444', marginTop: '6px' }}>
                  {error}
                </div>
              )}
            </div>

            {/* Botón */}
            <button
              type="submit"
              style={{
                width: '100%',
                padding: '13px',
                background: '#4361EE',
                color: '#ffffff',
                border: 'none',
                borderRadius: '10px',
                fontSize: '15px',
                fontWeight: 600,
                cursor: 'pointer',
                letterSpacing: '0.01em',
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => e.target.style.background = '#3451D1'}
              onMouseLeave={e => e.target.style.background = '#4361EE'}
            >
              Ingresar
            </button>

          </form>
        </div>

        {/* Footer */}
        <div style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          background: '#060E1E',
          padding: '14px 40px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <img
            src="/mendel_travel.svg"
            alt="Mendel Viajes"
            style={{ height: '16px', filter: 'brightness(0) invert(1)', opacity: 0.5 }}
          />
          <div style={{ display: 'flex', gap: '24px' }}>
            <a href="#" style={{ color: '#6B7280', fontSize: '12px', textDecoration: 'none' }}>
              Política de privacidad
            </a>
            <a href="#" style={{ color: '#6B7280', fontSize: '12px', textDecoration: 'none' }}>
              Términos y condiciones
            </a>
          </div>
        </div>

      </div>
    </>
  )
}
