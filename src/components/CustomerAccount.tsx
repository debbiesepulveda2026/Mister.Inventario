import { useCallback, useEffect, useState, type FormEvent } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ArrowDownLeft, Check, HeartHandshake, MessageCircle, Pencil, Plus, ShoppingBag } from 'lucide-react'
import { ModalHeading } from './common'
import { errorDetail, money, whatsappDigits, type Customer } from '../lib/shared'

type Movement = { kind: 'fiado' | 'abono'; movement_id: string; happened_at: string; amount: number; detail: string }

const dateTime = new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
const todayValue = () => { const now = new Date(); now.setMinutes(now.getMinutes() - now.getTimezoneOffset()); return now.toISOString().slice(0, 10) }
// Si la fecha es hoy se usa la hora actual; si es otro día, el mediodía de ese día.
const dateParam = (value: string) => !value || value === todayValue() ? null : new Date(`${value}T12:00:00`).toISOString()

export function whatsappChargeUrl(customer: Customer, storeName: string) {
  const phone = whatsappDigits(customer.phone)
  if (!phone) return ''
  const firstName = customer.name.trim().split(' ')[0] || customer.name
  const text = `Hola ${firstName}, te saludamos de ${storeName || 'el almacén'}. Te recordamos que tu cuenta de fiado tiene un saldo pendiente de ${money(customer.balance)}. Puedes abonar en el local o por transferencia. ¡Muchas gracias!`
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`
}

// Cuenta de un cliente de fiado: saldo, movimientos, abonos y cobro por WhatsApp.
// La usan la página de ventas y el panel del dueño.
export function CustomerAccount({ client, customer, storeName, receivedBy, online, canExceedLimit = false, onUpdated, onNotice }: {
  client: SupabaseClient
  customer: Customer
  storeName: string
  receivedBy: string
  online: boolean
  canExceedLimit?: boolean
  onUpdated: (customer: Customer, cashPayment?: number) => void
  onNotice: (message: string) => void
}) {
  const [movements, setMovements] = useState<Movement[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<'cash' | 'transfer'>('cash')
  const [action, setAction] = useState<'abono' | 'fiado'>(customer.balance > 0 ? 'abono' : 'fiado')
  const [when, setWhen] = useState(todayValue())
  const [note, setNote] = useState('')
  const [phone, setPhone] = useState(customer.phone)
  const [editingPhone, setEditingPhone] = useState(!customer.phone)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const available = Math.max(0, customer.credit_limit - customer.balance)
  const chargeUrl = whatsappChargeUrl(customer, storeName)

  const load = useCallback(async () => {
    if (!online) { setLoading(false); setLoadError('Sin conexión: los movimientos se ven cuando vuelve internet.'); return }
    setLoading(true); setLoadError('')
    const { data, error: rpcError } = await client.rpc('get_customer_statement', { target_customer: customer.id })
    setLoading(false)
    if (rpcError) { setLoadError('No se pudieron cargar los movimientos.' + errorDetail(rpcError)); return }
    setMovements((data ?? []) as Movement[])
  }, [client, customer.id, online])

  useEffect(() => { void load() }, [load])

  // Saldo después de cada movimiento, calculado hacia atrás desde el saldo actual.
  const balances: number[] = []
  movements.reduce((after, movement, index) => {
    balances[index] = after
    return movement.kind === 'fiado' ? after - movement.amount : after + movement.amount
  }, customer.balance)

  async function savePayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = Math.round(Number(amount))
    if (!value || value <= 0) { setError('Escribe el monto del abono.'); return }
    if (value > customer.balance) { setError(`El abono no puede ser mayor que lo que debe (${money(customer.balance)}).`); return }
    if (!online) { setError('Conéctate a internet para registrar el abono.'); return }
    setBusy(true); setError('')
    const { data, error: rpcError } = await client.rpc('record_customer_payment', { payment_customer: customer.id, payment_amount: value, paid_with: method, received_name: receivedBy, paid_on: dateParam(when) })
    setBusy(false)
    if (rpcError || typeof data !== 'number') { setError('No se pudo registrar el abono.' + errorDetail(rpcError)); return }
    onUpdated({ ...customer, balance: data }, method === 'cash' && when === todayValue() ? value : 0)
    onNotice(`Abono de ${money(value)} registrado. Ahora debe ${money(data)}.`)
    setAmount(''); setWhen(todayValue())
    void load()
  }

  async function saveCharge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = Math.round(Number(amount))
    if (!value || value <= 0) { setError('Escribe el monto del fiado.'); return }
    if (!canExceedLimit && customer.balance + value > customer.credit_limit) { setError(`Supera el límite. Le quedan ${money(available)} disponibles; para anotar más, pídele al dueño que suba el límite.`); return }
    if (!online) { setError('Conéctate a internet para anotar el fiado.'); return }
    setBusy(true); setError('')
    const { data, error: rpcError } = await client.rpc('record_customer_charge', { target_customer: customer.id, charge_amount: value, charge_note: note, charge_date: dateParam(when), created_name: receivedBy })
    setBusy(false)
    if (rpcError || typeof data !== 'number') { setError((rpcError?.message.includes('credit limit') ? 'Supera el límite de crédito del cliente.' : 'No se pudo anotar el fiado.') + errorDetail(rpcError)); return }
    onUpdated({ ...customer, balance: data })
    onNotice(`Fiado de ${money(value)} anotado. Ahora debe ${money(data)}.`)
    setAmount(''); setNote(''); setWhen(todayValue())
    void load()
  }

  async function savePhone() {
    if (!online) { setError('Conéctate a internet para guardar el WhatsApp.'); return }
    setBusy(true); setError('')
    const { error: rpcError } = await client.rpc('set_customer_phone', { target_customer: customer.id, new_phone: phone })
    setBusy(false)
    if (rpcError) { setError('No se pudo guardar el WhatsApp.' + errorDetail(rpcError)); return }
    onUpdated({ ...customer, phone: phone.trim() })
    setEditingPhone(false)
    onNotice('WhatsApp guardado')
  }

  return <div className="account">
    <ModalHeading icon={HeartHandshake} title={customer.name} subtitle={`RUT ${customer.rut || '—'} · Cuenta de fiado`}/>
    <div className="account-summary">
      <div className="account-due"><span>Debe</span><strong className={customer.balance > 0 ? 'balance-due' : 'balance-clear'}>{money(customer.balance)}</strong></div>
      <div><span>Límite</span><strong>{money(customer.credit_limit)}</strong></div>
      <div><span>Disponible</span><strong>{money(available)}</strong></div>
    </div>

    <div className="account-phone">
      {editingPhone
        ? <><input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="WhatsApp, ej. 9 8765 4321" inputMode="tel" aria-label="WhatsApp del cliente"/><button className="button button-small button-light" type="button" disabled={busy || phone.trim() === customer.phone} onClick={() => void savePhone()}><Check size={14}/> Guardar</button></>
        : <><span><MessageCircle size={14}/> {customer.phone}</span><button className="icon-button" type="button" aria-label="Cambiar WhatsApp" onClick={() => setEditingPhone(true)}><Pencil size={14}/></button></>}
      {chargeUrl && customer.balance > 0 && !editingPhone
        ? <a className="button button-small whatsapp-button" href={chargeUrl} target="_blank" rel="noreferrer"><MessageCircle size={14}/> Cobrar por WhatsApp</a>
        : null}
    </div>

    <div className="account-actions">
      <div className="method-toggle account-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={action === 'abono'} className={action === 'abono' ? 'chosen' : ''} onClick={() => { setAction('abono'); setError('') }}><ArrowDownLeft size={13}/> Registrar abono</button>
        <button type="button" role="tab" aria-selected={action === 'fiado'} className={action === 'fiado' ? 'chosen' : ''} onClick={() => { setAction('fiado'); setError('') }}><Plus size={13}/> Anotar fiado</button>
      </div>
      {action === 'abono'
        ? (customer.balance > 0
          ? <form className="account-payment" onSubmit={(event) => void savePayment(event)}>
              <label className="form-label">Monto<div className="money-input"><span>$</span><input type="number" min="1" max={customer.balance} step="1" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0"/></div></label>
              <label className="form-label">Fecha<input type="date" value={when} max={todayValue()} onChange={(event) => setWhen(event.target.value)}/></label>
              <div className="method-toggle" role="radiogroup" aria-label="Forma de pago">
                <button type="button" role="radio" aria-checked={method === 'cash'} className={method === 'cash' ? 'chosen' : ''} onClick={() => setMethod('cash')}>Efectivo</button>
                <button type="button" role="radio" aria-checked={method === 'transfer'} className={method === 'transfer' ? 'chosen' : ''} onClick={() => setMethod('transfer')}>Transferencia</button>
              </div>
              <button className="button button-dark" type="submit" disabled={busy}><Check size={15}/> {busy ? 'Guardando…' : 'Guardar abono'}</button>
            </form>
          : <p className="account-empty">No debe nada, no hay nada que abonar.</p>)
        : <form className="account-payment account-charge" onSubmit={(event) => void saveCharge(event)}>
            <label className="form-label">Monto<div className="money-input"><span>$</span><input type="number" min="1" step="1" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0"/></div></label>
            <label className="form-label">Fecha<input type="date" value={when} max={todayValue()} onChange={(event) => setWhen(event.target.value)}/></label>
            <label className="form-label account-note-input">Qué llevó<input value={note} maxLength={200} onChange={(event) => setNote(event.target.value)} placeholder="Ej. pan, bebidas y cigarros"/></label>
            <button className="button button-dark" type="submit" disabled={busy}><Check size={15}/> {busy ? 'Guardando…' : 'Guardar fiado'}</button>
          </form>}
      {action === 'fiado' && <p className="account-hint">Para deudas que no pasaron por la caja, como las del cuaderno. Las ventas a fiado hechas en la caja se anotan solas.</p>}
    </div>
    {error && <p className="auth-error" role="alert">{error}</p>}

    <div className="account-movements">
      <h3>Movimientos</h3>
      {loading ? <p className="muted">Cargando…</p>
        : loadError ? <p className="auth-error">{loadError}</p>
        : movements.length ? <ul>{movements.map((movement, index) => <li key={`${movement.kind}-${movement.movement_id}`} className={`movement movement-${movement.kind}`}>
            <span className="movement-icon">{movement.kind === 'fiado' ? <ShoppingBag size={14}/> : <ArrowDownLeft size={14}/>}</span>
            <span className="movement-main"><strong>{movement.kind === 'fiado' ? 'Fiado' : 'Abono'} · {dateTime.format(new Date(movement.happened_at))}</strong><small>{movement.detail || '—'}</small></span>
            <span className="movement-amount"><strong>{movement.kind === 'fiado' ? '+' : '−'}{money(movement.amount)}</strong><small>Saldo {money(balances[index])}</small></span>
          </li>)}</ul>
        : <p className="muted">Todavía no tiene movimientos.</p>}
      <p className="account-note">Las ventas a fiado hechas sin internet aparecen cuando se sincronizan.</p>
    </div>
  </div>
}
