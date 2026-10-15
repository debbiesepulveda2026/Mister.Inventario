import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  ArrowLeftRight, Barcode, Camera, Check, CircleDollarSign, Clock3, CreditCard, HeartHandshake, LogOut, Menu,
  Minus, Package, Plus, Search, Settings2, ShieldCheck, ShoppingBag, ShoppingCart, Signal, SignalZero, Tags,
  Trash2, Unlink, UserRound, Wallet, X,
} from 'lucide-react'
import { ventasSupabase as client } from './lib/supabaseVentas'
import { cacheProducts, getCachedProducts, getPendingSales, removePendingSale, savePendingSale, type PendingSale } from './lib/offline'
import {
  emptyCompany, initials, makeId, money, paymentLabel, shortDate,
  type BarcodeScanner, type CompanyProfile, type Customer, type Employee, type OpenCash, type Product, type Sale,
} from './lib/shared'
import { Brand, EmptyTable, Metric, ModalHeading } from './components/common'
import { ProductForm } from './components/ProductForm'
import { ProductPriceCalculator } from './components/PriceCalculator'
import { LinkTerminal } from './components/LinkTerminal'
import { ShiftPicker, type Shift } from './components/ShiftPicker'

type VScreen = 'pos' | 'products' | 'customers' | 'cash'
type Modal = 'cash-open' | 'cash-close' | 'product' | 'customer' | 'payment' | 'scanner' | 'receipt' | null
type Stage = 'loading' | 'unlinked' | 'linked' | 'blocked'

const navItems: { id: VScreen; label: string; icon: typeof ShoppingCart }[] = [
  { id: 'pos', label: 'Vender', icon: ShoppingCart },
  { id: 'products', label: 'Productos', icon: Package },
  { id: 'customers', label: 'Clientes fiado', icon: HeartHandshake },
  { id: 'cash', label: 'Caja', icon: Wallet },
]

function readJson<T>(key: string): T | null {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : null } catch { return null }
}
function writeJson(key: string, value: unknown) {
  try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(value)) } catch { /* sin almacenamiento */ }
}

export default function Ventas() {
  const [stage, setStage] = useState<Stage>('loading')
  const [stageError, setStageError] = useState('')
  const [userId, setUserId] = useState<string | null>(null)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [company, setCompany] = useState<CompanyProfile>(emptyCompany)
  const [terminalLabel, setTerminalLabel] = useState('Caja')
  const [online, setOnline] = useState(navigator.onLine)
  const [products, setProducts] = useState<Product[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [shift, setShift] = useState<Shift | null>(null)
  const [openCash, setOpenCash] = useState<OpenCash | null>(null)
  const [expectedCash, setExpectedCash] = useState<number | null>(null)
  const [sessionSales, setSessionSales] = useState<Sale[]>([])
  const [pendingCount, setPendingCount] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const [screen, setScreen] = useState<VScreen>('pos')
  const [menuOpen, setMenuOpen] = useState(false)
  const [cart, setCart] = useState<{ product: Product; quantity: number }[]>([])
  const [query, setQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState('Todos')
  const [modal, setModal] = useState<Modal>(null)
  const [notice, setNotice] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card' | 'credit'>('cash')
  const [selectedCustomer, setSelectedCustomer] = useState('')
  const [customerReturnsToPayment, setCustomerReturnsToPayment] = useState(false)
  const [receipt, setReceipt] = useState<Sale | null>(null)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)
  const [scannerError, setScannerError] = useState('')
  const scannerVideo = useRef<HTMLVideoElement>(null)
  const scannerStream = useRef<MediaStream | null>(null)
  const syncingRef = useRef(false)

  const cartTotal = cart.reduce((sum, item) => sum + item.product.price * item.quantity, 0)
  const categories = ['Todos', ...Array.from(new Set(products.map((product) => product.category).filter(Boolean)))]
  const filteredProducts = useMemo(() => products.filter((product) =>
    (activeCategory === 'Todos' || product.category === activeCategory) &&
    `${product.name} ${product.sku}`.toLowerCase().includes(query.toLowerCase()),
  ), [products, activeCategory, query])
  const filteredCustomers = useMemo(() => customers.filter((customer) => `${customer.name} ${customer.rut}`.toLowerCase().includes(query.toLowerCase())), [customers, query])
  const totals = useMemo(() => ({
    cash: sessionSales.filter((sale) => sale.payment_method === 'cash').reduce((sum, sale) => sum + sale.total, 0),
    card: sessionSales.filter((sale) => sale.payment_method === 'card').reduce((sum, sale) => sum + sale.total, 0),
    credit: sessionSales.filter((sale) => sale.payment_method === 'credit').reduce((sum, sale) => sum + sale.total, 0),
  }), [sessionSales])
  const cashExpected = expectedCash ?? ((openCash?.openingAmount ?? 0) + totals.cash)
  const notify = useCallback((message: string) => setNotice(message), [])

  // ----- Sesión de la caja -----------------------------------------------------------
  const loadTerminal = useCallback(async () => {
    const { data: { session } } = await client.auth.getSession()
    if (!session) { setStage('unlinked'); setUserId(null); return }
    const uid = session.user.id
    setUserId(uid)
    const cacheKey = `mister-ventas:${uid}`
    const cached = readJson<{ companyId: string; company: CompanyProfile; label: string }>(cacheKey)
    if (cached) {
      setCompanyId(cached.companyId); setCompany({ ...emptyCompany, ...cached.company }); setTerminalLabel(cached.label)
      setProducts(await getCachedProducts<Product>(cached.companyId))
      setCustomers(readJson<Customer[]>(`mister-ventas-customers:${cached.companyId}`) ?? [])
      setEmployees(readJson<Employee[]>(`mister-ventas-employees:${cached.companyId}`) ?? [])
      setShift(readJson<Shift>(`mister-ventas-shift:${cached.companyId}`))
      setOpenCash(readJson<OpenCash>(`mister-open-cash:${cached.companyId}`))
      setSessionSales(readJson<Sale[]>(`mister-ventas-log:${cached.companyId}`) ?? [])
      setPendingCount((await getPendingSales(cached.companyId)).length)
      setStage('linked')
    }
    if (!navigator.onLine) {
      if (!cached) { setStageError('Sin conexión. La primera vez se necesita internet para cargar el almacén.'); setStage('blocked') }
      return
    }
    const { data: membership, error } = await client.from('company_members').select('company_id,role').eq('user_id', uid).maybeSingle()
    if (error) { if (!cached) { setStageError('No se pudo verificar la caja. Revisa la conexión.'); setStage('blocked') } return }
    if (!membership) {
      writeJson(cacheKey, null)
      setStageError(cached ? 'El dueño desvinculó esta caja. Vuelve a vincularla para seguir vendiendo.' : '')
      setCompanyId(null)
      setStage('unlinked')
      return
    }
    if (membership.role !== 'cashier') {
      setStageError('Esta sesión no es de una caja. La página de ventas solo funciona con cajas vinculadas.')
      setStage('blocked')
      return
    }
    const tenantId = membership.company_id as string
    const [{ data: profile }, { data: terminal }] = await Promise.all([
      client.from('companies').select('*').eq('id', tenantId).maybeSingle(),
      client.from('cash_terminals').select('label').eq('user_id', uid).maybeSingle(),
    ])
    void client.rpc('touch_terminal').then(() => undefined)
    const companyProfile: CompanyProfile = { ...emptyCompany, ...(profile ?? {}), dte_endpoint: '' }
    const label = (terminal?.label as string | undefined) ?? 'Caja'
    writeJson(cacheKey, { companyId: tenantId, company: companyProfile, label })
    setCompanyId(tenantId); setCompany(companyProfile); setTerminalLabel(label)
    if (!cached) {
      setShift(readJson<Shift>(`mister-ventas-shift:${tenantId}`))
      setSessionSales(readJson<Sale[]>(`mister-ventas-log:${tenantId}`) ?? [])
    }

    const [productResult, customerResult, employeeResult, cashResult] = await Promise.all([
      client.from('products').select('id,name,sku,category,price,stock,image_url,supplier_id').eq('company_id', tenantId).order('name'),
      client.from('customers').select('id,name,rut,phone,credit_limit,balance').eq('company_id', tenantId).order('name'),
      client.from('employees').select('id,name,rut,active,pin_set').eq('company_id', tenantId).order('name'),
      client.from('cash_sessions').select('id,opened_at,opening_amount,cashier_name').eq('company_id', tenantId).eq('status', 'open').order('opened_at', { ascending: false }).limit(1).maybeSingle(),
    ])
    if (productResult.data) { setProducts(productResult.data as Product[]); await cacheProducts(productResult.data, tenantId) }
    if (customerResult.data) { setCustomers(customerResult.data as Customer[]); writeJson(`mister-ventas-customers:${tenantId}`, customerResult.data) }
    if (employeeResult.data) { setEmployees(employeeResult.data as Employee[]); writeJson(`mister-ventas-employees:${tenantId}`, employeeResult.data) }
    else if (employeeResult.error) setStageError('Falta ejecutar ventas_migration.sql (columna pin_set).')
    if (cashResult.data) {
      const session: OpenCash = { id: cashResult.data.id, openedAt: cashResult.data.opened_at, openingAmount: cashResult.data.opening_amount, cashier: cashResult.data.cashier_name }
      setOpenCash(session); writeJson(`mister-open-cash:${tenantId}`, session)
      const { data: expected } = await client.rpc('get_cashier_expected_cash', { target_session: session.id })
      if (typeof expected === 'number') setExpectedCash(expected)
    } else if (!cashResult.error) {
      const local = readJson<OpenCash>(`mister-open-cash:${tenantId}`)
      // Si la caja local nunca llegó al servidor (se abrió sin internet), se sube ahora.
      if (local) {
        const { error: insertError } = await client.from('cash_sessions').insert({ id: local.id, company_id: tenantId, opened_at: local.openedAt, opening_amount: local.openingAmount, cashier_name: local.cashier, status: 'open' })
        if (insertError) { setOpenCash(null); writeJson(`mister-open-cash:${tenantId}`, null) }
      }
    }
    setStage('linked')
    void syncPending(tenantId)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const onOnline = () => setOnline(true)
    const onOffline = () => setOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    void loadTerminal()
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      scannerStream.current?.getTracks().forEach((track) => track.stop())
    }
  }, [loadTerminal])

  useEffect(() => { if (online && companyId) void syncPending(companyId) // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, companyId])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 3600)
    return () => window.clearTimeout(timer)
  }, [notice])

  useEffect(() => { if (companyId) writeJson(`mister-ventas-log:${companyId}`, sessionSales) }, [sessionSales, companyId])

  // ----- Escáner -----------------------------------------------------------------------
  useEffect(() => {
    if (modal !== 'scanner') {
      scannerStream.current?.getTracks().forEach((track) => track.stop())
      scannerStream.current = null
      return
    }
    let cancelled = false
    const start = async () => {
      try {
        const Detector = (window as Window & { BarcodeDetector?: BarcodeScanner }).BarcodeDetector
        if (!Detector) throw new Error('Este navegador no lee códigos con la cámara. Escribe el código en el buscador o usa un lector USB.')
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } })
        if (cancelled) return stream.getTracks().forEach((track) => track.stop())
        scannerStream.current = stream
        if (scannerVideo.current) scannerVideo.current.srcObject = stream
        const detector = new Detector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'] })
        const scan = async () => {
          if (cancelled || !scannerVideo.current) return
          try {
            const codes = await detector.detect(scannerVideo.current)
            if (codes[0]?.rawValue) {
              const product = products.find((item) => item.sku === codes[0].rawValue)
              setModal(null)
              if (product) { addToCart(product); setNotice(`${product.name} agregado`) } else { setQuery(codes[0].rawValue); setNotice(`Código ${codes[0].rawValue} no encontrado`) }
              return
            }
          } catch { /* se intenta con el siguiente cuadro */ }
          requestAnimationFrame(scan)
        }
        void scan()
      } catch (error) {
        setScannerError(error instanceof Error ? error.message : 'No se pudo iniciar la cámara.')
      }
    }
    setScannerError('')
    void start()
    return () => { cancelled = true; scannerStream.current?.getTracks().forEach((track) => track.stop()) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modal, products])

  // ----- Sincronización ----------------------------------------------------------------
  async function syncPending(tenantId: string) {
    if (!navigator.onLine || syncingRef.current) return
    syncingRef.current = true; setSyncing(true)
    const pending = await getPendingSales(tenantId)
    let completed = 0
    let failed = 0
    for (const sale of pending) {
      const { error } = await client.rpc('sync_sale', { sale_payload: sale })
      if (error) { failed += 1; if (error.message.includes('fetch')) break; continue }
      await removePendingSale(sale.id, tenantId)
      completed += 1
    }
    const left = await getPendingSales(tenantId)
    setPendingCount(left.length)
    if (completed) setSessionSales((items) => items.map((sale) => left.some((item) => item.id === sale.id) ? sale : { ...sale, synced: true }))
    syncingRef.current = false; setSyncing(false)
    if (completed) setNotice(`${completed} venta${completed === 1 ? '' : 's'} sincronizada${completed === 1 ? '' : 's'}`)
    else if (failed) setNotice(`${failed} venta${failed === 1 ? '' : 's'} no se pudo subir. Puede ser un fiado sobre el límite: avisa al dueño.`)
  }

  // ----- Venta -------------------------------------------------------------------------
  function addToCart(product: Product) {
    const inCart = cart.find((item) => item.product.id === product.id)?.quantity ?? 0
    if (product.stock <= inCart) return setNotice('No queda más stock de este producto')
    setCart((items) => {
      const found = items.find((item) => item.product.id === product.id)
      if (found) return items.map((item) => item.product.id === product.id ? { ...item, quantity: item.quantity + 1 } : item)
      return [...items, { product, quantity: 1 }]
    })
  }

  function updateQuantity(productId: string, amount: number) {
    setCart((items) => items.map((item) => {
      if (item.product.id !== productId) return item
      const quantity = Math.min(item.product.stock, item.quantity + amount)
      return { ...item, quantity }
    }).filter((item) => item.quantity > 0))
  }

  async function completeSale(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!companyId || !shift) return
    if (!openCash) return setNotice('Abre la caja antes de cobrar')
    if (!cart.length) return setNotice('Agrega productos a la venta')
    const customer = customers.find((item) => item.id === selectedCustomer)
    if (paymentMethod === 'credit') {
      if (!customer) return setNotice('Elige el cliente del fiado')
      if (customer.balance + cartTotal > customer.credit_limit) return setNotice(`Supera el límite de ${customer.name}. Disponible: ${money(Math.max(0, customer.credit_limit - customer.balance))}`)
    }
    const sale: Sale = {
      id: makeId(), company_id: companyId, created_at: new Date().toISOString(), total: cartTotal, payment_method: paymentMethod,
      customer_id: paymentMethod === 'credit' ? selectedCustomer : null, cashier_name: shift.name,
      items: cart.map(({ product, quantity }) => ({ product_id: product.id, name: product.name, quantity, unit_price: product.price })), synced: false,
    }
    await savePendingSale(sale as PendingSale)
    setPendingCount((count) => count + 1)
    setSessionSales((items) => [sale, ...items])
    if (paymentMethod === 'cash') setExpectedCash((amount) => amount === null ? null : amount + cartTotal)
    if (paymentMethod === 'credit' && customer) {
      const next = customers.map((item) => item.id === customer.id ? { ...item, balance: item.balance + cartTotal } : item)
      setCustomers(next); writeJson(`mister-ventas-customers:${companyId}`, next)
    }
    const nextProducts = products.map((product) => {
      const sold = cart.find((item) => item.product.id === product.id)?.quantity ?? 0
      return sold ? { ...product, stock: Math.max(0, product.stock - sold) } : product
    })
    setProducts(nextProducts)
    await cacheProducts(nextProducts, companyId)
    setReceipt(sale); setCart([]); setSelectedCustomer(''); setPaymentMethod('cash'); setModal('receipt')
    if (navigator.onLine) void syncPending(companyId)
  }

  // ----- Clientes fiado ----------------------------------------------------------------
  async function saveCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!companyId) return
    if (!navigator.onLine) return setNotice('Conéctate a internet para crear un cliente de fiado')
    const form = new FormData(event.currentTarget)
    const draft = { id: makeId(), company_id: companyId, name: String(form.get('name')).trim(), rut: String(form.get('rut')).trim(), phone: String(form.get('phone')).trim(), credit_limit: company.default_credit_limit, balance: 0 }
    const { data, error } = await client.from('customers').insert(draft).select('id,name,rut,phone,credit_limit,balance').single()
    if (error || !data) return setNotice('No se pudo crear el cliente. Revisa que esté ejecutado ventas_migration.sql.')
    const next = [...customers, data as Customer].sort((a, b) => a.name.localeCompare(b.name))
    setCustomers(next); writeJson(`mister-ventas-customers:${companyId}`, next)
    setNotice(`Cliente creado con límite de ${money((data as Customer).credit_limit)}`)
    if (customerReturnsToPayment) { setSelectedCustomer((data as Customer).id); setPaymentMethod('credit'); setModal('payment') } else setModal(null)
    setCustomerReturnsToPayment(false)
  }

  // ----- Caja --------------------------------------------------------------------------
  async function openRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!companyId || !shift) return
    const amount = Number(new FormData(event.currentTarget).get('opening_amount'))
    const session: OpenCash = { id: makeId(), openedAt: new Date().toISOString(), openingAmount: amount, cashier: shift.name }
    if (navigator.onLine) {
      const { error } = await client.from('cash_sessions').insert({ id: session.id, company_id: companyId, opened_at: session.openedAt, opening_amount: amount, cashier_name: shift.name, status: 'open' })
      if (error) return setNotice('No se pudo abrir la caja en Supabase. Revisa la conexión.')
    }
    setOpenCash(session); setExpectedCash(amount); setSessionSales([])
    writeJson(`mister-open-cash:${companyId}`, session)
    setModal(null); setNotice('Caja abierta. ¡A vender!')
  }

  async function closeRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!openCash || !companyId) return
    if (!navigator.onLine) return setNotice('Conéctate a internet para cerrar la caja y registrar el arqueo')
    await syncPending(companyId)
    const actual = Number(new FormData(event.currentTarget).get('actual_amount'))
    let expected = cashExpected
    const { data } = await client.rpc('get_cashier_expected_cash', { target_session: openCash.id })
    if (typeof data === 'number') expected = data
    const { error } = await client.from('cash_sessions').update({ closed_at: new Date().toISOString(), actual_amount: actual, expected_amount: expected, difference: actual - expected, breakdown: totals, status: 'closed' }).eq('id', openCash.id).eq('company_id', companyId)
    if (error) return setNotice('No se pudo cerrar la caja. Intenta de nuevo.')
    setOpenCash(null); setExpectedCash(null); setSessionSales([])
    writeJson(`mister-open-cash:${companyId}`, null)
    setModal(null); setNotice(`Caja cerrada. Diferencia: ${money(actual - expected)}`)
  }

  function endShift() {
    if (openCash) return setNotice('Cierra la caja antes de cambiar de turno')
    if (cart.length) return setNotice('Termina o vacía la venta actual antes de cambiar de turno')
    setShift(null)
    if (companyId) writeJson(`mister-ventas-shift:${companyId}`, null)
  }

  async function unlinkDevice() {
    if (openCash) return setNotice('Cierra la caja antes de desvincular este equipo')
    if (pendingCount) return setNotice('Hay ventas sin subir. Conéctate y sincroniza antes de desvincular.')
    if (!window.confirm('¿Desvincular este equipo? Para volver a vender aquí, el dueño tendrá que autorizarlo de nuevo.')) return
    if (userId) writeJson(`mister-ventas:${userId}`, null)
    if (companyId) { writeJson(`mister-ventas-shift:${companyId}`, null); writeJson(`mister-ventas-log:${companyId}`, null) }
    await client.auth.signOut({ scope: 'local' })
    setShift(null); setCompanyId(null); setStageError(''); setStage('unlinked')
  }

  function go(next: VScreen) { setScreen(next); setMenuOpen(false); setQuery('') }

  // ----- Render ------------------------------------------------------------------------
  if (stage === 'loading') return <main className="tenant-gate"><div className="tenant-gate-mark"><ShoppingCart size={22}/></div><p className="eyebrow">PUNTO DE VENTA</p><h1>Preparando la caja…</h1></main>
  if (stage === 'unlinked') return <LinkTerminal initialError={stageError} onLinked={() => { setStage('loading'); setStageError(''); void loadTerminal() }}/>
  if (stage === 'blocked' || !companyId) return <main className="tenant-gate"><div className="tenant-gate-mark"><ShoppingCart size={22}/></div><p className="eyebrow">PUNTO DE VENTA</p><h1>No se pudo abrir la caja</h1><p>{stageError || 'Intenta de nuevo en un momento.'}</p><button className="button button-light" onClick={() => { setStage('loading'); void loadTerminal() }}>Reintentar</button></main>
  if (!shift) return <ShiftPicker storeName={company.legal_name || 'Mi almacén'} terminalLabel={terminalLabel} employees={employees} online={online} onStart={(next) => { setShift(next); writeJson(`mister-ventas-shift:${companyId}`, next); setScreen('pos') }}/>

  return (
    <div className="app-shell role-cashier ventas-shell">
      <aside className={`sidebar ${menuOpen ? 'sidebar-open' : ''}`}>
        <a className="brand" href="#vender" onClick={(event) => { event.preventDefault(); go('pos') }}><Brand caption="VENTAS"/></a>
        <div className="store-switch"><span className="store-avatar">{company.legal_name.slice(0, 1).toUpperCase() || 'M'}</span><span><strong>{company.legal_name || 'Mi almacén'}</strong><small>{terminalLabel}</small></span></div>
        <p className="nav-caption">CAJA</p>
        <nav className="main-nav" aria-label="Navegación de ventas">
          {navItems.map(({ id, label, icon: Icon }) => <button key={id} className={`nav-link ${screen === id ? 'active' : ''}`} onClick={() => go(id)}><Icon size={18}/><span>{label}</span></button>)}
        </nav>
        <div className="sidebar-bottom">
          <div className={`connection-card ${online ? '' : 'is-offline'}`}><span className="connection-icon">{online ? <Signal size={17}/> : <SignalZero size={17}/>}</span><div><strong>{online ? 'En línea' : 'Sin conexión'}</strong><small>{pendingCount ? `${pendingCount} venta${pendingCount === 1 ? '' : 's'} por subir` : 'Todo sincronizado'}</small></div></div>
          {pendingCount > 0 && <button className="sync-button" onClick={() => void syncPending(companyId)} disabled={!online || syncing}><ArrowLeftRight size={15}/>{syncing ? 'Sincronizando…' : 'Sincronizar ventas'}</button>}
          <button className="profile-row" onClick={endShift} aria-label="Cambiar turno"><span className="mini-avatar">{initials(shift.name)}</span><span><strong>{shift.name}</strong><small>Cambiar turno</small></span><UserRound size={15}/></button>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <button className="mobile-menu icon-button" aria-label="Abrir menú" onClick={() => setMenuOpen(!menuOpen)}><Menu size={19}/></button>
          <div className="breadcrumb">{company.legal_name || 'Mi almacén'} <span>/</span> <strong>{navItems.find((item) => item.id === screen)?.label}</strong></div>
          <div className="topbar-actions"><span className="date-label"><Clock3 size={15}/>{new Intl.DateTimeFormat('es-CL', { weekday: 'short', day: 'numeric', month: 'long' }).format(new Date())}</span><span className={`cash-status ${openCash ? 'open' : 'closed'}`}><i/>{openCash ? 'Caja abierta' : 'Caja cerrada'}</span></div>
        </header>

        {screen === 'pos' && <section className="workspace pos-workspace">
          <div className="page-heading pos-heading"><div><p className="eyebrow">{shortDate.format(new Date()).toUpperCase()} · {terminalLabel}</p><h1>Hola, {shift.name.split(' ')[0]} <span className="wave">✳</span></h1><p className="muted">{openCash ? '¿Qué vendemos ahora?' : 'Abre la caja para empezar a cobrar.'}</p></div><div className="heading-actions">{openCash ? <button className="button button-light" onClick={() => setModal('cash-close')}><LogOut size={16}/> Cerrar caja</button> : <button className="button button-dark" onClick={() => setModal('cash-open')}><Plus size={16}/> Abrir caja</button>}</div></div>
          <div className="pos-layout">
            <section className="catalog-panel">
              <div className="catalog-toolbar"><div className="search-box"><Search size={17}/><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { const match = products.find((item) => item.sku && item.sku === query.trim()); if (match) { addToCart(match); setQuery('') } } }} placeholder="Buscar producto o pasar el lector" aria-label="Buscar producto" autoFocus/></div><button className="button button-light scan-button" onClick={() => setModal('scanner')}><Camera size={16}/><span>Escanear</span></button></div>
              <div className="category-tabs">{categories.map((category) => <button key={category} onClick={() => setActiveCategory(category)} className={activeCategory === category ? 'selected' : ''}>{category}</button>)}</div>
              <div className="catalog-meta"><span>Catálogo</span><span>{filteredProducts.length} productos <Tags size={14}/></span></div>
              <div className="product-grid">{filteredProducts.map((product, index) => <article key={product.id} className={`product-tile ${product.stock <= 0 ? 'out-of-stock' : ''}`} style={{ animationDelay: `${Math.min(index, 12) * 35}ms` }}><button className="product-tile-main" onClick={() => addToCart(product)} disabled={product.stock <= 0}><span className={`product-visual visual-${index % 4}`}>{product.image_url ? <img src={product.image_url} alt={product.name} loading="lazy"/> : <Package size={24} strokeWidth={1.7}/>}</span><span className="product-name">{product.name}</span><span className="product-detail">{product.category} · {product.stock > 0 ? `${product.stock} disp.` : 'sin stock'}</span><span className="product-price">{money(product.price)}<span className="add-product"><Plus size={15}/></span></span></button></article>)}</div>
              {!filteredProducts.length && <div className="empty-state"><Package size={24}/><strong>No encontramos productos</strong><span>Prueba otra búsqueda o agrégalo en Productos.</span></div>}
            </section>
            <aside className="cart-panel"><div className="cart-header"><div><h2>Venta actual</h2><span>{cart.reduce((sum, item) => sum + item.quantity, 0)} artículos</span></div><button className="icon-button" aria-label="Vaciar venta" onClick={() => setCart([])}><Trash2 size={17}/></button></div><div className="cart-cashier"><span className="mini-avatar">{initials(shift.name)}</span><span><small>Atiende</small><strong>{shift.name}</strong></span></div><div className="cart-items">{cart.map(({ product, quantity }) => <div className="cart-item" key={product.id}><div className="item-info"><strong>{product.name}</strong><small>{money(product.price)} c/u</small></div><div className="item-controls"><button aria-label={`Quitar uno de ${product.name}`} onClick={() => updateQuantity(product.id, -1)}><Minus size={13}/></button><span>{quantity}</span><button aria-label={`Agregar uno de ${product.name}`} onClick={() => updateQuantity(product.id, 1)}><Plus size={13}/></button></div><strong className="item-total">{money(product.price * quantity)}</strong></div>)}{!cart.length && <div className="cart-empty"><ShoppingCart size={25}/><span>La venta comienza aquí</span><small>Toca un producto o pasa el lector</small></div>}</div><div className="cart-footer"><div className="total-row grand-total"><strong>Total</strong><strong>{money(cartTotal)}</strong></div><button className="button button-accent checkout-button" disabled={!cart.length || !openCash} onClick={() => setModal('payment')}><CreditCard size={18}/>{openCash ? 'Cobrar' : 'Abre la caja para cobrar'}<span>{money(cartTotal)}</span></button><p className="secure-note"><ShieldCheck size={13}/> Funciona aunque se corte internet</p></div></aside>
          </div>
        </section>}

        {screen === 'products' && <section className="workspace"><div className="page-heading"><div><p className="eyebrow">CATÁLOGO</p><h1>Productos</h1><p className="muted">Agrega productos y calcula su precio con el margen.</p></div><button className="button button-dark" onClick={() => { setEditingProduct(null); setModal('product') }}><Plus size={16}/> Nuevo producto</button></div><div className="table-panel"><div className="table-toolbar"><div><h2>Inventario</h2><span>{products.length} productos · {products.filter((item) => item.stock < 10).length} con stock bajo</span></div><div className="search-box table-search"><Search size={16}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar producto" aria-label="Buscar producto"/></div></div><div className="table-scroll"><table><thead><tr><th>PRODUCTO</th><th>CÓDIGO</th><th>CATEGORÍA</th><th>PRECIO</th><th>STOCK</th><th></th></tr></thead><tbody>{filteredProducts.map((product) => <tr key={product.id}><td><span className="table-product-icon">{product.image_url ? <img src={product.image_url} alt=""/> : <Package size={17}/>}</span><strong>{product.name}</strong></td><td className="code-cell">{product.sku || '—'}</td><td>{product.category}</td><td>{money(product.price)}</td><td><span className={`stock-pill ${product.stock < 10 ? 'low-stock' : ''}`}>{product.stock} un.</span></td><td><div className="row-actions"><button className="icon-button" aria-label={`Editar ${product.name}`} onClick={() => { setEditingProduct(product); setModal('product') }}><Settings2 size={16}/></button></div></td></tr>)}</tbody></table>{!filteredProducts.length && <div className="table-empty">Aún no hay productos para mostrar.</div>}</div></div></section>}

        {screen === 'customers' && <section className="workspace"><div className="page-heading"><div><p className="eyebrow">FIADOS</p><h1>Clientes fiado</h1><p className="muted">Revisa cuánto le queda a cada cliente antes de fiarle.</p></div><button className="button button-dark" onClick={() => { setCustomerReturnsToPayment(false); setModal('customer') }}><Plus size={16}/> Nuevo cliente</button></div><div className="table-panel"><div className="table-toolbar"><div><h2>Libreta de fiados</h2><span>El límite de crédito lo define el dueño</span></div><div className="search-box table-search"><Search size={16}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por nombre o RUT" aria-label="Buscar cliente"/></div></div><div className="table-scroll"><table><thead><tr><th>CLIENTE</th><th>RUT</th><th>TELÉFONO</th><th>DEBE</th><th>DISPONIBLE</th></tr></thead><tbody>{filteredCustomers.map((customer) => <tr key={customer.id}><td><span className="table-person-avatar">{initials(customer.name)}</span><strong>{customer.name}</strong></td><td>{customer.rut}</td><td>{customer.phone || '—'}</td><td><strong className={customer.balance > 0 ? 'balance-due' : 'balance-clear'}>{money(customer.balance)}</strong></td><td>{money(Math.max(0, customer.credit_limit - customer.balance))}</td></tr>)}</tbody></table>{!filteredCustomers.length && <EmptyTable text="No hay clientes de fiado todavía."/>}</div></div></section>}

        {screen === 'cash' && <section className="workspace"><div className="page-heading"><div><p className="eyebrow">CONTROL DE CAJA</p><h1>Caja</h1><p className="muted">{openCash ? `Abierta por ${openCash.cashier} a las ${new Intl.DateTimeFormat('es-CL', { timeStyle: 'short' }).format(new Date(openCash.openedAt))}` : 'La caja está cerrada.'}</p></div>{openCash ? <button className="button button-accent" onClick={() => setModal('cash-close')}><LogOut size={16}/> Cerrar caja</button> : <button className="button button-dark" onClick={() => setModal('cash-open')}><Plus size={16}/> Abrir caja</button>}</div>
          <div className="metric-strip"><Metric icon={Wallet} label="Efectivo esperado" value={money(openCash ? cashExpected : 0)} detail={`Fondo inicial ${money(openCash?.openingAmount ?? 0)}`}/><Metric icon={CreditCard} label="Tarjeta" value={money(totals.card)} detail="en este turno"/><Metric icon={HeartHandshake} label="Fiado" value={money(totals.credit)} detail="en este turno"/></div>
          <div className="table-panel"><div className="table-toolbar"><div><h2>Ventas de este turno</h2><span>{sessionSales.length} venta{sessionSales.length === 1 ? '' : 's'} en este equipo</span></div></div><div className="table-scroll"><table><thead><tr><th>HORA</th><th>PAGO</th><th>ATENDIÓ</th><th>TOTAL</th><th>ESTADO</th></tr></thead><tbody>{sessionSales.map((sale) => <tr key={sale.id}><td>{new Intl.DateTimeFormat('es-CL', { timeStyle: 'short' }).format(new Date(sale.created_at))}</td><td>{paymentLabel(sale.payment_method)}</td><td>{sale.cashier_name}</td><td><strong>{money(sale.total)}</strong></td><td>{sale.synced ? <span className="status-pill status-active"><i/>Subida</span> : <span className="status-pill status-inactive"><i/>Pendiente</span>}</td></tr>)}</tbody></table>{!sessionSales.length && <EmptyTable text="Todavía no hay ventas en este turno."/>}</div></div>
          <button className="unlink-device" onClick={() => void unlinkDevice()}><Unlink size={14}/> Desvincular este equipo</button>
        </section>}
      </main>

      {screen === 'products' && <ProductPriceCalculator client={client} visible canSaveCost companyId={companyId} products={products} onSaved={(productId, price) => { const next = products.map((item) => item.id === productId ? { ...item, price } : item); setProducts(next); void cacheProducts(next, companyId); setNotice('Precio actualizado') }}/>}
      {menuOpen && <button className="mobile-scrim" aria-label="Cerrar menú" onClick={() => setMenuOpen(false)}/>}
      {notice && <div className="toast" role="status"><Check size={16}/>{notice}<button onClick={() => setNotice('')} aria-label="Cerrar aviso"><X size={15}/></button></div>}

      {modal && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setModal(null) }}><section className={`modal-card ${modal === 'scanner' || modal === 'receipt' ? 'modal-wide' : ''}`} role="dialog" aria-modal="true">
        <button className="modal-close icon-button" aria-label="Cerrar" onClick={() => setModal(null)}><X size={18}/></button>
        {modal === 'cash-open' && <><ModalHeading icon={Wallet} title="Abrir caja" subtitle="Cuenta el sencillo con que partes el turno."/><form onSubmit={(event) => void openRegister(event)}><label className="form-label">Fondo inicial<div className="money-input"><span>$</span><input name="opening_amount" type="number" min="0" step="1" required placeholder="0" autoFocus/></div></label><label className="form-label">Responsable<input value={shift.name} readOnly/></label><button className="button button-dark modal-submit" type="submit"><Plus size={16}/> Abrir caja</button></form></>}
        {modal === 'cash-close' && <><ModalHeading icon={LogOut} title="Cerrar caja" subtitle="Cuenta el efectivo y compáralo con lo esperado."/><div className="close-summary"><div><span>Fondo inicial</span><strong>{money(openCash?.openingAmount ?? 0)}</strong></div><div><span>Ventas en efectivo</span><strong>{money(cashExpected - (openCash?.openingAmount ?? 0))}</strong></div><div><span>Tarjeta · Fiado</span><strong>{money(totals.card + totals.credit)}</strong></div><div className="expected-line"><span>Efectivo esperado</span><strong>{money(cashExpected)}</strong></div></div><form onSubmit={(event) => void closeRegister(event)}><label className="form-label">Efectivo contado<div className="money-input"><span>$</span><input name="actual_amount" type="number" min="0" step="1" required placeholder="0" autoFocus/></div></label><button className="button button-dark modal-submit" type="submit"><Check size={16}/> Cerrar caja</button></form></>}
        {modal === 'product' && <ProductForm client={client} companyId={companyId} product={editingProduct} online={online} onError={notify} onSaved={(saved, message) => { const next = editingProduct ? products.map((item) => item.id === saved.id ? saved : item) : [saved, ...products]; setProducts(next); void cacheProducts(next, companyId); setEditingProduct(null); setModal(null); setNotice(message) }}/>}
        {modal === 'customer' && <><ModalHeading icon={HeartHandshake} title="Nuevo cliente fiado" subtitle={`Parte con un límite de ${money(company.default_credit_limit)}. El dueño puede cambiarlo.`}/><form onSubmit={(event) => void saveCustomer(event)}><label className="form-label">Nombre completo<input name="name" required placeholder="Nombre y apellido" autoFocus/></label><div className="form-grid"><label className="form-label">RUT<input name="rut" required placeholder="12.345.678-9"/></label><label className="form-label">Teléfono<input name="phone" placeholder="+56 9 1234 5678"/></label></div><button className="button button-dark modal-submit" type="submit"><Check size={16}/> Crear cliente</button></form></>}
        {modal === 'payment' && <><ModalHeading icon={CreditCard} title="Cobrar" subtitle="¿Cómo paga el cliente?"/><form onSubmit={(event) => void completeSale(event)}><div className="payment-options"><button type="button" className={paymentMethod === 'cash' ? 'chosen' : ''} onClick={() => setPaymentMethod('cash')}><Wallet size={18}/><strong>Efectivo</strong><span>Pago en caja</span></button><button type="button" className={paymentMethod === 'card' ? 'chosen' : ''} onClick={() => setPaymentMethod('card')}><CreditCard size={18}/><strong>Tarjeta</strong><span>Débito o crédito</span></button><button type="button" className={paymentMethod === 'credit' ? 'chosen' : ''} onClick={() => setPaymentMethod('credit')}><HeartHandshake size={18}/><strong>Fiado</strong><span>Lo anota en su cuenta</span></button></div>
          {paymentMethod === 'credit' && <><label className="form-label">Cliente<select required value={selectedCustomer} onChange={(event) => setSelectedCustomer(event.target.value)}><option value="">Elige un cliente</option>{customers.map((customer) => <option key={customer.id} value={customer.id} disabled={customer.balance + cartTotal > customer.credit_limit}>{customer.name} · disponible {money(Math.max(0, customer.credit_limit - customer.balance))}</option>)}</select></label><button type="button" className="link-button" onClick={() => { setCustomerReturnsToPayment(true); setModal('customer') }}><Plus size={14}/> Cliente nuevo</button></>}
          <div className="payment-total"><span>Total a pagar</span><strong>{money(cartTotal)}</strong></div><button className="button button-accent modal-submit" type="submit"><Check size={17}/> Confirmar venta</button></form></>}
        {modal === 'scanner' && <><ModalHeading icon={Barcode} title="Escanear producto" subtitle="Apunta la cámara al código de barras."/><div className="scanner-view">{scannerError ? <div className="scanner-message"><Camera size={25}/><p>{scannerError}</p></div> : <video ref={scannerVideo} autoPlay playsInline muted/>}<span className="scanner-reticle"/></div><p className="scanner-help">La cámara necesita permiso del navegador y una conexión HTTPS.</p></>}
        {modal === 'receipt' && receipt && <><div className="receipt-confirm"><span><Check size={22}/></span><div><h2>Venta registrada</h2><p>{receipt.synced ? 'Subida a la nube' : online ? 'Subiendo…' : 'Guardada en este equipo; se sube al volver internet'}</p></div></div><div className="ticket"><div className="ticket-brand"><ShoppingBag size={18}/><strong>mister.</strong></div><span className="eyebrow">COMPROBANTE DE VENTA</span><h3>{company.legal_name || 'Mi negocio'}</h3><p>{company.rut || 'RUT no configurado'} · {company.business || 'Giro comercial'}</p><p>{company.address || 'Dirección no configurada'}</p><div className="receipt-rule dotted"/>{receipt.items.map((item) => <div className="ticket-line" key={item.product_id}><span>{item.quantity} × {item.name}</span><strong>{money(item.quantity * item.unit_price)}</strong></div>)}<div className="receipt-rule"/><div className="ticket-total"><span>TOTAL</span><strong>{money(receipt.total)}</strong></div><div className="ticket-meta"><span>{new Intl.DateTimeFormat('es-CL', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(receipt.created_at))}</span><span>{paymentLabel(receipt.payment_method)}{receipt.customer_id ? ` · ${customers.find((item) => item.id === receipt.customer_id)?.name ?? ''}` : ''}</span></div></div><p className="ticket-notice">Comprobante interno. No reemplaza la boleta electrónica del SII.</p><div className="receipt-actions"><button className="button button-light" onClick={() => window.print()}><CircleDollarSign size={16}/> Imprimir</button><button className="button button-dark" onClick={() => setModal(null)}><Check size={16}/> Nueva venta</button></div></>}
      </section></div>}
    </div>
  )
}
