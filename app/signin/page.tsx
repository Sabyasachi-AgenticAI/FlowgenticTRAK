'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { TrakMark } from '../trak-mark'
import '../landing.css'

export default function SignIn() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim() || !password.trim()) {
      setError('Enter your email and password to sign in.')
      return
    }
    setError('')
    setBusy(true)
    // Demo access: any credentials open the operator dashboard.
    try { sessionStorage.setItem('trak_operator', email.trim()) } catch {}
    router.push('/dashboard')
  }

  return (
    <div className="si-page">
      <div className="ld-mark">
        <TrakMark size={28} />
        <span className="ld-mark-flow">Flowgentic</span>
        <span className="ld-mark-trak">TRAK</span>
      </div>

      <form className="si-ticket" onSubmit={handleSubmit}>
        <p className="si-kicker">Flowgentic TRAK</p>
        <h1 className="si-title">Operator sign-in</h1>

        <div className="si-field">
          <label className="si-label" htmlFor="si-email">Email</label>
          <input
            id="si-email"
            className="si-input"
            type="email"
            autoComplete="email"
            placeholder="you@yourcompany.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div className="si-field">
          <label className="si-label" htmlFor="si-password">Password</label>
          <input
            id="si-password"
            className="si-input"
            type="password"
            autoComplete="current-password"
            placeholder="••••••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        {error && <div className="si-error" role="alert">{error}</div>}

        <button type="submit" className="ld-btn si-submit" disabled={busy}>
          {busy ? 'Opening the desk…' : 'Sign in'}
        </button>

        <p className="si-note">
          Operator access is provisioned by your account team. Ask your Flowgentic
          representative for credentials.
        </p>
      </form>

      <Link href="/" className="si-back">← Back to flowgentic-trak</Link>
    </div>
  )
}
