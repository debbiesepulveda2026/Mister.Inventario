import { useState, type FormEvent } from 'react'
import { ArrowLeft, Delete, LockKeyhole, SignalZero, UserRound } from 'lucide-react'
import { Brand } from './common'
import { initials, type Employee } from '../lib/shared'
import { ventasSupabase } from '../lib/supabaseVentas'

export type Shift = { id: string; name: string; startedAt: string }

// Inicio de turno: la cajera elige su nombre y escribe su PIN. El PIN se verifica en Supabase.
export function ShiftPicker({ storeName, terminalLabel, employees, online, onStart }: {
  storeName: string
  terminalLabel: string
  employees: Employee[]
  online: boolean
  onStart: (shift: Shift) => void
}) {
  const [selected, setSelected] = useState<Employee | null>(null)
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const available = employees.filter((employee) => employee.active)

  async function verify(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault()
    if (!selected || pin.length < 4) return
    setBusy(true); setError('')
    const { data, error: rpcError } = await ventasSupabase.rpc('verify_employee_pin', { target_employee: selected.id, pin })
    setBusy(false)
    if (rpcError) { setError('No se pudo verificar el PIN. Revisa la conexión.'); return }
    const result = data as { ok: boolean; reason?: string; id?: string; name?: string }
    if (result.ok && result.id && result.name) { onStart({ id: result.id, name: result.name, startedAt: new Date().toISOString() }); return }
    setPin('')
    setError(result.reason === 'locked' ? 'Demasiados intentos. Este PIN quedó bloqueado por 5 minutos.'
      : result.reason === 'no_pin' ? 'Aún no tienes PIN. Pídele al dueño que lo asigne en Panel → Personal.'
      : result.reason === 'not_found' ? 'Esta persona ya no está activa.'
      : 'PIN incorrecto.')
  }

  function press(digit: string) {
    setError('')
    setPin((value) => value.length >= 8 ? value : value + digit)
  }

  return <main className="shift-shell">
    <header className="shift-top"><span className="brand"><Brand caption="VENTAS"/></span><span className="shift-store">{storeName} · {terminalLabel}</span></header>
    <section className="shift-card">
      {!online && <p className="auth-error" role="alert"><SignalZero size={14}/> Sin conexión. Para iniciar turno se necesita internet un momento.</p>}
      {!selected ? <>
        <p className="eyebrow">INICIO DE TURNO</p>
        <h1>¿Quién atiende?</h1>
        {available.length ? <div className="shift-people">{available.map((employee) => <button key={employee.id} className="shift-person" onClick={() => { setSelected(employee); setPin(''); setError('') }}><span className="table-person-avatar">{initials(employee.name)}</span><strong>{employee.name}</strong>{!employee.pin_set && <small>Sin PIN</small>}</button>)}</div>
          : <div className="shift-empty"><UserRound size={22}/><p>No hay personal activo. El dueño debe agregarlo en su panel, en <strong>Personal</strong>, con un PIN.</p></div>}
      </> : <form onSubmit={(event) => void verify(event)}>
        <button type="button" className="shift-back" onClick={() => { setSelected(null); setError('') }}><ArrowLeft size={15}/> Cambiar persona</button>
        <p className="eyebrow">HOLA, {selected.name.toUpperCase()}</p>
        <h1><LockKeyhole size={20}/> Escribe tu PIN</h1>
        <input className="pin-display" type="password" inputMode="numeric" autoFocus value={pin} maxLength={8} onChange={(event) => { setError(''); setPin(event.target.value.replace(/\D/g, '').slice(0, 8)) }} aria-label="PIN"/>
        <div className="pin-pad">{['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => <button type="button" key={digit} onClick={() => press(digit)}>{digit}</button>)}<button type="button" onClick={() => setPin('')} aria-label="Borrar todo">C</button><button type="button" onClick={() => press('0')}>0</button><button type="button" onClick={() => setPin((value) => value.slice(0, -1))} aria-label="Borrar"><Delete size={18}/></button></div>
        {error && <p className="auth-error" role="alert">{error}</p>}
        <button className="button button-dark modal-submit" type="submit" disabled={busy || pin.length < 4 || !online}>{busy ? 'Verificando…' : 'Iniciar turno'}</button>
      </form>}
    </section>
  </main>
}
