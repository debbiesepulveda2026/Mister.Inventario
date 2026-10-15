import { useState, type FormEvent } from 'react'
import { ArrowLeftRight, Building2, Check, KeyRound, LogOut, MailCheck, ShieldCheck, ShoppingBag, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { authErrorText } from '../lib/shared'
import { AuthArt, Brand } from './common'

export type StoreSignupRequest = { id: string; email: string; rut: string; legal_name: string; business: string; address: string; created_at: string }

type AuthMode = 'login' | 'signup' | 'forgot'

const loginArt = <AuthArt eyebrow="TU NEGOCIO, EN ORDEN" title={['Vender bien', 'se siente bien.']} text="Inventario, caja y cuentas claras. Todo en el mismo lugar." stats={['Inventario vivo', 'Ventas al día', 'Caja en control']}/>
const signupArt = <AuthArt eyebrow="UN ESPACIO SOLO TUYO" title={['Tu almacén.', 'Tus números.']} text="Productos, clientes y ventas quedan separados de los demás negocios." stats={['Una cuenta', 'Un almacén', 'Datos privados']}/>

// Dirección a la que vuelve el enlace de recuperación (la misma página del dueño).
const recoveryRedirect = () => `${window.location.origin}${window.location.pathname.replace(/ventas\.html$/, '')}`

// Login del dueño + registro de almacén + recuperación de clave por correo.
export function OwnerAuth({ ready }: { ready: boolean }) {
  const [mode, setMode] = useState<AuthMode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [rut, setRut] = useState('')
  const [legalName, setLegalName] = useState('')
  const [business, setBusiness] = useState('')
  const [address, setAddress] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  function switchMode(next: AuthMode) { setMode(next); setError(''); setMessage('') }

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true); setError(''); setMessage('')
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setBusy(false)
    if (signInError) setError(authErrorText(signInError.message))
  }

  async function sendRecovery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true); setError(''); setMessage('')
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: recoveryRedirect() })
    setBusy(false)
    if (resetError) { setError(authErrorText(resetError.message)); return }
    // Por seguridad el mensaje es el mismo exista o no la cuenta.
    setMessage('Si ese correo tiene una cuenta, te llegará un enlace para crear una clave nueva. Revisa también la carpeta de spam.')
  }

  async function registerStore(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true); setError(''); setMessage('')
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { emailRedirectTo: recoveryRedirect(), data: { rut: rut.trim(), legal_name: legalName.trim(), business: business.trim(), address: address.trim() } },
    })
    if (signUpError) { setBusy(false); setError(authErrorText(signUpError.message)); return }
    if (data.user?.identities?.length === 0) {
      setBusy(false); setMode('login')
      setMessage('Ese correo ya tiene una cuenta. Inicia sesión o recupera tu clave.')
      return
    }
    let emailSent = false
    if (data.user?.id) {
      const { data: notification, error: notificationError } = await supabase.functions.invoke('notify-store-signup', { body: { user_id: data.user.id } })
      emailSent = !notificationError && notification?.email_sent === true
    }
    setBusy(false); setMode('login'); setPassword('')
    setMessage(emailSent
      ? 'Solicitud enviada. Confirma tu correo; la administradora recibió tu solicitud y debe aprobarla antes de que puedas entrar.'
      : 'Solicitud recibida. Confirma tu correo; tu almacén quedará habilitado cuando la administradora lo apruebe.')
  }

  if (mode === 'signup') return <main className="auth-shell">{signupArt}<section className="auth-form-side"><form className="auth-form signup-form" onSubmit={(event) => void registerStore(event)}><span className="auth-mobile-brand"><ShoppingBag size={18}/> mister.</span><p className="eyebrow">REGISTRO DE NEGOCIO</p><h2>Inscribe tu almacén</h2><p className="auth-subtitle">La administradora revisa cada solicitud antes de habilitarla.</p><label>RUT comercial<input required value={rut} onChange={(event) => setRut(event.target.value)} placeholder="76.123.456-7" autoComplete="organization"/></label><label>Razón social<input required value={legalName} onChange={(event) => setLegalName(event.target.value)} placeholder="Almacén Ejemplo SpA" autoComplete="organization-title"/></label><label>Giro comercial<input required value={business} onChange={(event) => setBusiness(event.target.value)} placeholder="Venta al por menor"/></label><label>Dirección<input required value={address} onChange={(event) => setAddress(event.target.value)} placeholder="Comuna y dirección" autoComplete="street-address"/></label><label>Correo del dueño<input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="nombre@negocio.cl" autoComplete="email"/></label><label>Clave<input type="password" required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Mínimo 8 caracteres" autoComplete="new-password"/></label>{error && <p className="auth-error" role="alert">{error}</p>}{message && <p className="auth-message" role="status">{message}</p>}<button className="button button-dark auth-submit" type="submit" disabled={!ready || busy}>{busy ? 'Enviando solicitud…' : 'Enviar solicitud'}<span>→</span></button><button className="auth-mode-toggle" type="button" onClick={() => switchMode('login')}>¿Ya tienes cuenta? Inicia sesión</button><p className="auth-security"><ShieldCheck size={14}/> Tus datos quedan en un espacio separado</p></form></section></main>

  if (mode === 'forgot') return <main className="auth-shell">{loginArt}<section className="auth-form-side"><form className="auth-form" onSubmit={(event) => void sendRecovery(event)}><span className="auth-mobile-brand"><ShoppingBag size={18}/> mister.</span><p className="eyebrow">RECUPERAR ACCESO</p><h2>¿Olvidaste tu clave?</h2><p className="auth-subtitle">Escribe el correo con que inscribiste el almacén. Te enviaremos un enlace para crear una clave nueva.</p><label>Correo electrónico<input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="nombre@negocio.cl"/></label>{error && <p className="auth-error" role="alert">{error}</p>}{message && <p className="auth-message" role="status"><MailCheck size={14}/> {message}</p>}<button className="button button-dark auth-submit" type="submit" disabled={!ready || busy}>{busy ? 'Enviando…' : 'Enviar enlace'}<span>→</span></button><button className="auth-mode-toggle" type="button" onClick={() => switchMode('login')}>Volver a iniciar sesión</button></form></section></main>

  return <main className="auth-shell">{loginArt}<section className="auth-form-side"><form className="auth-form" onSubmit={(event) => void signIn(event)}><span className="auth-mobile-brand"><ShoppingBag size={18}/> mister.</span><p className="eyebrow">PANEL DEL DUEÑO</p><h2>Inicia sesión</h2><p className="auth-subtitle">Administra tu almacén, tu equipo y tus números.</p>{!ready && <div className="auth-loading">Conectando con Supabase…</div>}<label>Correo electrónico<input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="nombre@negocio.cl"/></label><label>Clave<input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="••••••••••"/></label><button type="button" className="forgot-link" onClick={() => switchMode('forgot')}>¿Olvidaste tu clave?</button>{error && <p className="auth-error" role="alert">{error}</p>}{message && <p className="auth-message" role="status">{message}</p>}<button className="button button-dark auth-submit" type="submit" disabled={!ready || busy}>{busy ? 'Ingresando…' : 'Entrar al panel'}<span>→</span></button><button className="auth-mode-toggle" type="button" onClick={() => switchMode('signup')}>¿Primera vez? Inscribe tu almacén</button><p className="auth-security"><ShieldCheck size={14}/> Acceso protegido por Supabase Auth</p></form></section></main>
}

// Se muestra al abrir el enlace del correo de recuperación.
export function ResetPassword({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (password.length < 8) { setError('La clave debe tener al menos 8 caracteres.'); return }
    if (password !== confirm) { setError('Las dos claves no coinciden.'); return }
    setBusy(true); setError('')
    const { error: updateError } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (updateError) { setError(authErrorText(updateError.message)); return }
    setDone(true)
  }

  return <main className="auth-shell">{loginArt}<section className="auth-form-side">{done
    ? <div className="auth-form"><p className="eyebrow">LISTO</p><h2><Check size={22}/> Clave actualizada</h2><p className="auth-subtitle">Ya puedes usar tu clave nueva.</p><button className="button button-dark auth-submit" onClick={onDone}>Ir al panel<span>→</span></button></div>
    : <form className="auth-form" onSubmit={(event) => void save(event)}><p className="eyebrow">RECUPERAR ACCESO</p><h2><KeyRound size={22}/> Crea tu clave nueva</h2><p className="auth-subtitle">Elige una clave que no uses en otros sitios.</p><label>Clave nueva<input type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Mínimo 8 caracteres"/></label><label>Repite la clave<input type="password" autoComplete="new-password" required minLength={8} value={confirm} onChange={(event) => setConfirm(event.target.value)}/></label>{error && <p className="auth-error" role="alert">{error}</p>}<button className="button button-dark auth-submit" type="submit" disabled={busy}>{busy ? 'Guardando…' : 'Guardar clave'}<span>→</span></button></form>}</section></main>
}

export function ApprovalInbox({ email, requests, error, onReview, onRefresh, onSignOut }: {
  email: string
  requests: StoreSignupRequest[]
  error: string
  onReview: (id: string, decision: 'approve' | 'reject') => Promise<string | null>
  onRefresh: () => Promise<string | null>
  onSignOut: () => void
}) {
  const [busyId, setBusyId] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [message, setMessage] = useState('')

  async function decide(id: string, decision: 'approve' | 'reject') {
    setBusyId(id)
    setMessage('')
    const result = await onReview(id, decision)
    setMessage(result ?? (decision === 'approve' ? 'Almacén aprobado. La persona ya puede ingresar.' : 'Solicitud rechazada. La cuenta no tendrá acceso.'))
    setBusyId('')
  }

  async function refresh() {
    setRefreshing(true)
    setMessage(await onRefresh() ?? '')
    setRefreshing(false)
  }

  return <main className="approval-shell"><header className="approval-topbar"><a className="brand" href="#aprobaciones"><Brand caption="ADMINISTRACIÓN"/></a><div className="approval-user"><span>{email}</span><button className="button button-light" onClick={onSignOut}><LogOut size={15}/> Cerrar sesión</button></div></header><section className="approval-content"><p className="eyebrow">ALTAS DE COMERCIOS</p><div className="approval-title"><div><h1>Solicitudes de almacén</h1><p>Revisa los datos comerciales y aprueba quién puede ingresar.</p></div><div className="approval-title-actions"><span className="approval-count">{requests.length} pendientes</span><button className="icon-button approval-refresh" aria-label="Actualizar solicitudes" title="Actualizar solicitudes" disabled={refreshing} onClick={() => void refresh()}><ArrowLeftRight size={16}/></button></div></div>{error && <p className="approval-error" role="alert">{error}</p>}{message && <p className="approval-feedback" role="status">{message}</p>}{requests.length ? <div className="approval-list">{requests.map((request) => <article className="approval-request" key={request.id}><div className="request-main"><span className="request-avatar"><Building2 size={19}/></span><div className="request-heading"><h2>{request.legal_name}</h2><span>{request.email}</span></div><time>{new Intl.DateTimeFormat('es-CL',{dateStyle:'medium',timeStyle:'short'}).format(new Date(request.created_at))}</time></div><dl className="request-details"><div><dt>RUT comercial</dt><dd>{request.rut}</dd></div><div><dt>Giro</dt><dd>{request.business}</dd></div><div><dt>Dirección</dt><dd>{request.address}</dd></div></dl><div className="request-actions"><button className="button button-light reject-button" disabled={busyId === request.id} onClick={() => void decide(request.id, 'reject')}><X size={15}/> Rechazar</button><button className="button button-dark" disabled={busyId === request.id} onClick={() => void decide(request.id, 'approve')}><Check size={15}/>{busyId === request.id ? 'Procesando…' : 'Aprobar almacén'}</button></div></article>)}</div> : <div className="approval-empty"><span><Check size={21}/></span><h2>No hay solicitudes pendientes</h2><p>Cuando alguien registre un almacén, aparecerá aquí y recibirás un correo.</p></div>}</section></main>
}
