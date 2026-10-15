import { useState, type FormEvent } from 'react'
import { KeyRound, Link2, ShieldCheck, Store } from 'lucide-react'
import { AuthArt } from './common'
import { authErrorText } from '../lib/shared'
import { createTemporaryOwnerClient, ventasSupabase } from '../lib/supabaseVentas'

// Pantalla para vincular un equipo como caja de un almacén.
// El dueño autoriza con su clave (que no queda guardada) o con un código generado desde su panel.
export function LinkTerminal({ onLinked, initialError }: { onLinked: () => void; initialError?: string }) {
  const [mode, setMode] = useState<'owner' | 'code'>('owner')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [label, setLabel] = useState('Caja 1')
  const [code, setCode] = useState('')
  const [error, setError] = useState(initialError ?? '')
  const [busy, setBusy] = useState(false)

  async function claim(linkCode: string) {
    const { data: { session } } = await ventasSupabase.auth.getSession()
    if (!session) {
      const { error: anonError } = await ventasSupabase.auth.signInAnonymously()
      if (anonError) throw new Error(authErrorText(anonError.message))
    }
    const { error: claimError } = await ventasSupabase.rpc('claim_terminal_code', { link_code: linkCode })
    if (claimError) {
      if (claimError.message.includes('inválido') || claimError.message.includes('vencido')) throw new Error('El código no existe o ya venció. Pide uno nuevo al dueño.')
      if (claimError.message.includes('function') || claimError.code === 'PGRST202') throw new Error('Falta ejecutar supabase/ventas_migration.sql en Supabase.')
      throw new Error(claimError.message)
    }
  }

  async function linkWithOwner(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true); setError('')
    const temporary = createTemporaryOwnerClient()
    try {
      const { error: signInError } = await temporary.auth.signInWithPassword({ email, password })
      if (signInError) throw new Error(authErrorText(signInError.message))
      const { data: newCode, error: codeError } = await temporary.rpc('create_terminal_code', { terminal_label: label })
      await temporary.auth.signOut({ scope: 'local' })
      if (codeError || typeof newCode !== 'string') {
        throw new Error(codeError?.message.includes('not authorized')
          ? 'Esa cuenta no es dueña de un almacén aprobado.'
          : 'No se pudo generar el código. Revisa que esté ejecutado ventas_migration.sql.')
      }
      await claim(newCode)
      setPassword('')
      onLinked()
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'No se pudo vincular la caja')
    } finally {
      setBusy(false)
    }
  }

  async function linkWithCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true); setError('')
    try {
      await claim(code)
      onLinked()
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'No se pudo vincular la caja')
    } finally {
      setBusy(false)
    }
  }

  return <main className="auth-shell">
    <AuthArt eyebrow="PUNTO DE VENTA" title={['Vende rápido.', 'Cuadra la caja.']} text="Esta página es solo para vender. El panel del dueño queda en otra parte." stats={['Turno con PIN', 'Venta y fiado', 'Funciona sin internet']}/>
    <section className="auth-form-side">
      <div className="auth-form">
        <span className="auth-mobile-brand"><Store size={18}/> mister. ventas</span>
        <p className="eyebrow">CONFIGURACIÓN INICIAL</p>
        <h2>Vincular esta caja</h2>
        <p className="auth-subtitle">Se hace una sola vez en cada computador o tablet de venta.</p>
        <div className="link-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={mode === 'owner'} className={mode === 'owner' ? 'selected' : ''} onClick={() => { setMode('owner'); setError('') }}><KeyRound size={14}/> Clave del dueño</button>
          <button type="button" role="tab" aria-selected={mode === 'code'} className={mode === 'code' ? 'selected' : ''} onClick={() => { setMode('code'); setError('') }}><Link2 size={14}/> Código de caja</button>
        </div>
        {mode === 'owner' ? <form onSubmit={(event) => void linkWithOwner(event)}>
          <label>Correo del dueño<input type="email" required autoComplete="off" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="dueno@negocio.cl"/></label>
          <label>Clave del dueño<input type="password" required autoComplete="off" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="••••••••"/></label>
          <label>Nombre de esta caja<input required maxLength={40} value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Caja 1"/></label>
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button className="button button-dark auth-submit" type="submit" disabled={busy}>{busy ? 'Vinculando…' : 'Vincular caja'}<span>→</span></button>
          <p className="auth-security"><ShieldCheck size={14}/> La clave del dueño no queda guardada en este equipo.</p>
        </form> : <form onSubmit={(event) => void linkWithCode(event)}>
          <label>Código de 8 caracteres<input required autoComplete="off" value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="Ej. 4F9A21C0" maxLength={8} className="code-input"/></label>
          <p className="auth-hint">El dueño lo genera en su panel, en <strong>Centro de cajas → Vincular caja</strong>. Dura 15 minutos.</p>
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button className="button button-dark auth-submit" type="submit" disabled={busy || code.trim().length < 8}>{busy ? 'Vinculando…' : 'Usar código'}<span>→</span></button>
        </form>}
      </div>
      <span className="auth-legal">Cada caja queda conectada solo a su almacén.</span>
    </section>
  </main>
}
