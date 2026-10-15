import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  ArrowDownLeft, ArrowLeftRight, Building2, Check, CircleDollarSign, Clock3, ExternalLink, FileText, HeartHandshake,
  KeyRound, LayoutDashboard, Link2, LogOut, Menu, Monitor, Package, Plus, ReceiptText, Search, Settings2,
  ShieldCheck, ShoppingCart, Signal, SignalZero, Trash2, Truck, Unlink, UserRound, Users, Wallet, X,
  Activity, Barcode,
} from 'lucide-react'
import { supabase } from './lib/supabase'
import { APPROVER_EMAIL } from './lib/config'
import { cacheProducts, getCachedProducts, getPendingSales, removePendingSale, type PendingSale } from './lib/offline'
import {
  emptyCompany, errorDetail, initials, makeId, money, paymentLabel, whatsappDigits,
  type CompanyProfile, type Customer, type Employee, type MemberRole, type Product, type Sale, type Supplier,
} from './lib/shared'
import { EmptyTable, Brand, Metric, ModalHeading } from './components/common'
import { ProductForm } from './components/ProductForm'
import { ProductPriceCalculator } from './components/PriceCalculator'
import { OwnerSalesReport, SupplierManagement } from './components/OwnerReports'
import { ApprovalInbox, OwnerAuth, ResetPassword, type StoreSignupRequest } from './components/OwnerAuth'

// Página del dueño (index.html). La venta vive en ventas.html.
type Screen = 'owner' | 'products' | 'customers' | 'staff' | 'suppliers' | 'cash' | 'company' | 'accounting'
type Modal = 'product' | 'customer' | 'staff' | 'supplier' | 'terminal-code' | null
type CashSessionRow = { id: string; opened_at: string; closed_at: string | null; opening_amount: number; expected_amount: number | null; actual_amount: number | null; difference: number | null; cashier_name: string; status: string }
type Terminal = { user_id: string; label: string; created_at: string; last_seen_at: string | null }

const VENTAS_URL = './ventas.html'
const isRecoveryLink = () => /type=recovery/.test(window.location.hash) || /type=recovery/.test(window.location.search)

function App() {
  const [authReady, setAuthReady] = useState(false)
  const [authenticated, setAuthenticated] = useState(false)
  const [recovering, setRecovering] = useState(isRecoveryLink())
  const [userId, setUserId] = useState<string | null>(null)
  const [userEmail, setUserEmail] = useState('')
  const [isApprover, setIsApprover] = useState(false)
  const [signupRequests, setSignupRequests] = useState<StoreSignupRequest[]>([])
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [memberRole, setMemberRole] = useState<MemberRole | null>(null)
  const [tenantError, setTenantError] = useState('')
  const [screen, setScreen] = useState<Screen>('owner')
  const [online, setOnline] = useState(navigator.onLine)
  const [products, setProducts] = useState<Product[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [sales, setSales] = useState<Sale[]>([])
  const [cashSessions, setCashSessions] = useState<CashSessionRow[]>([])
  const [terminals, setTerminals] = useState<Terminal[]>([])
  const [terminalError, setTerminalError] = useState('')
  const [terminalCode, setTerminalCode] = useState<{ code: string; label: string; expiresAt: number } | null>(null)
  const [pendingCount, setPendingCount] = useState(0)
  const [query, setQuery] = useState('')
  const [modal, setModal] = useState<Modal>(null)
  const [notice, setNotice] = useState('')
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null)
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null)
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null)
  const [company, setCompany] = useState<CompanyProfile>(emptyCompany)
  const [dteKey, setDteKey] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  const filteredProducts = useMemo(() => products.filter((product) => `${product.name} ${product.sku} ${product.category}`.toLowerCase().includes(query.toLowerCase())), [products, query])
  const todaySales = sales.filter((sale) => new Date(sale.created_at).toDateString() === new Date().toDateString())
  const todayTotal = todaySales.reduce((sum, sale) => sum + sale.total, 0)
  const todayCash = todaySales.filter((sale) => sale.payment_method === 'cash').reduce((sum, sale) => sum + sale.total, 0)
  const totalCredit = customers.reduce((sum, customer) => sum + customer.balance, 0)
  const openSession = cashSessions.find((session) => session.status === 'open') ?? null
  const canManageFinancials = memberRole === 'owner' || memberRole === 'admin'

  useEffect(() => {
    const onOnline = () => setOnline(true)
    const onOffline = () => setOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    const applySession = (session: Awaited<ReturnType<typeof supabase.auth.getSession>>['data']['session']) => {
      setAuthenticated(Boolean(session))
      setUserId(session?.user.id ?? null)
      setUserEmail(session?.user.email ?? '')
      setIsApprover(session?.user.email?.toLowerCase() === APPROVER_EMAIL)
      setAuthReady(true)
      if (!session) {
        setCompanyId(null); setMemberRole(null)
        setIsApprover(false); setSignupRequests([]); setTenantError('')
        setProducts([]); setCustomers([]); setEmployees([]); setSales([]); setCashSessions([]); setTerminals([])
      }
    }
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') setRecovering(true)
      applySession(session)
    })
    void supabase.auth.getSession().then(({ data: { session } }) => applySession(session))
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    void (async () => {
      if (userEmail.toLowerCase() === APPROVER_EMAIL) {
        setTenantError('')
        const { data, error } = await supabase.from('company_signup_requests')
          .select('id,email,rut,legal_name,business,address,created_at')
          .eq('status', 'pending').order('created_at', { ascending: true })
        if (!cancelled) {
          setSignupRequests((data ?? []) as StoreSignupRequest[])
          if (error) setTenantError('No se pudo cargar la bandeja. Revisa la migración de aprobación y RLS.')
        }
        return
      }

      const tenantCacheKey = `mister-company:${userId}`
      const cachedCompanyId = localStorage.getItem(`${tenantCacheKey}:id`)
      const cachedCompany = localStorage.getItem(`${tenantCacheKey}:profile`)
      const cachedRole = localStorage.getItem(`${tenantCacheKey}:role`)
      if (cachedCompanyId) {
        setCompanyId(cachedCompanyId)
        if (cachedRole === 'owner' || cachedRole === 'admin' || cachedRole === 'cashier') setMemberRole(cachedRole)
        if (cachedCompany) setCompany({ ...emptyCompany, ...(JSON.parse(cachedCompany) as Partial<CompanyProfile>) })
        const cachedProducts = await getCachedProducts<Product>(cachedCompanyId)
        const queued = await getPendingSales(cachedCompanyId)
        if (!cancelled) { setProducts(cachedProducts); setPendingCount(queued.length) }
      }

      if (!navigator.onLine) {
        if (!cachedCompanyId && !cancelled) setTenantError('Conéctate a internet para cargar tu almacén por primera vez en este equipo.')
        return
      }

      const { data: membership, error: membershipError } = await supabase.from('company_members').select('company_id,role').eq('user_id', userId).maybeSingle()
      if (cancelled) return
      if (membershipError || !membership) {
        const { data: signupState } = await supabase.rpc('get_my_signup_status').maybeSingle()
        if (cancelled) return
        const signupStatus = (signupState as unknown as { status?: string } | null)?.status
        if (signupStatus === 'pending') setTenantError('Tu solicitud está pendiente de aprobación. Te avisaremos por correo cuando el almacén esté habilitado.')
        else if (signupStatus === 'rejected') setTenantError('La solicitud de este almacén no fue aprobada. Contacta a la administradora si necesitas más información.')
        else setTenantError('No encontramos un almacén vinculado a esta cuenta. Inscribe tu almacén o contacta a soporte.')
        return
      }

      const tenantId = membership.company_id as string
      const role = String(membership.role) as MemberRole
      if (!['owner', 'admin', 'cashier'].includes(role)) { setTenantError('El rol de esta cuenta no tiene acceso al almacén.'); return }
      setMemberRole(role)
      localStorage.setItem(`${tenantCacheKey}:role`, role)
      if (role === 'cashier') return

      const { data: profile, error: profileError } = await supabase.from('companies').select('*').eq('id', tenantId).single()
      if (cancelled) return
      if (profileError || !profile) { setTenantError('No se pudo cargar el almacén de esta cuenta.'); return }
      const companyProfile: CompanyProfile = { ...emptyCompany, ...profile, order_whatsapp: profile.order_whatsapp ?? '', default_credit_limit: profile.default_credit_limit ?? emptyCompany.default_credit_limit, dte_endpoint: localStorage.getItem(`mister-dte-endpoint:${tenantId}`) ?? '' }
      localStorage.setItem(`${tenantCacheKey}:id`, tenantId)
      localStorage.setItem(`${tenantCacheKey}:profile`, JSON.stringify(companyProfile))
      setCompanyId(tenantId)
      setCompany(companyProfile)
      setTenantError('')

      const [productResult, customerResult, employeeResult, supplierResult, salesResult] = await Promise.all([
        supabase.from('products').select('id,name,sku,category,price,stock,image_url,supplier_id').eq('company_id', tenantId).order('name'),
        supabase.from('customers').select('id,name,rut,phone,credit_limit,balance').eq('company_id', tenantId).order('name'),
        supabase.from('employees').select('id,name,rut,active,pin_set').eq('company_id', tenantId).order('name'),
        supabase.from('suppliers').select('id,name,rut,phone,whatsapp,email,address,notes,active').eq('company_id', tenantId).order('name'),
        supabase.from('sales').select('id,company_id,created_at,total,payment_method,customer_id,cashier_name,synced').eq('company_id', tenantId).order('created_at', { ascending: false }).limit(200),
      ])
      if (cancelled) return
      if (productResult.data) { setProducts(productResult.data as Product[]); await cacheProducts(productResult.data, tenantId) }
      if (customerResult.data) setCustomers(customerResult.data as Customer[])
      if (employeeResult.data) setEmployees(employeeResult.data as Employee[])
      else if (employeeResult.error) setNotice('No se pudo cargar al personal.' + errorDetail(employeeResult.error))
      if (supplierResult.data) setSuppliers(supplierResult.data as Supplier[])
      if (salesResult.data) setSales(salesResult.data.map((sale) => ({ ...sale, items: [] })) as Sale[])
      await Promise.all([loadCashSessions(tenantId), loadTerminals(tenantId)])
      const queued = await getPendingSales(tenantId)
      if (queued.length) void syncPending(tenantId, queued)
    })()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, userEmail])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 3600)
    return () => window.clearTimeout(timer)
  }, [notice])

  async function loadCashSessions(tenantId: string) {
    const { data } = await supabase.from('cash_sessions').select('id,opened_at,closed_at,opening_amount,expected_amount,actual_amount,difference,cashier_name,status').eq('company_id', tenantId).order('opened_at', { ascending: false }).limit(30)
    if (data) setCashSessions(data as CashSessionRow[])
  }

  async function loadTerminals(tenantId: string) {
    const { data } = await supabase.from('cash_terminals').select('user_id,label,created_at,last_seen_at').eq('company_id', tenantId).order('created_at')
    if (data) setTerminals(data as Terminal[])
  }

  // Ventas antiguas que quedaron guardadas en este equipo (versión anterior con POS integrado).
  async function syncPending(tenantId: string, queue: PendingSale[]) {
    if (!navigator.onLine || syncing) return
    setSyncing(true)
    let completed = 0
    for (const sale of queue) {
      const { error } = await supabase.rpc('sync_sale', { sale_payload: sale })
      if (error) continue
      await removePendingSale(sale.id, tenantId)
      completed += 1
    }
    setPendingCount((await getPendingSales(tenantId)).length)
    setSyncing(false)
    if (completed) setNotice(`${completed} venta${completed === 1 ? '' : 's'} pendiente${completed === 1 ? '' : 's'} sincronizada${completed === 1 ? '' : 's'}`)
  }

  async function saveSupplier(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!companyId || !canManageFinancials) return
    const form = new FormData(event.currentTarget)
    const supplier: Supplier = {
      id: editingSupplier?.id ?? makeId(), name: String(form.get('name')).trim(), rut: String(form.get('rut')).trim(),
      phone: String(form.get('phone')).trim(), whatsapp: String(form.get('whatsapp')).trim(), email: String(form.get('email')).trim(),
      address: String(form.get('address')).trim(), notes: String(form.get('notes')).trim(), active: form.get('active') === 'on',
    }
    if (!navigator.onLine) return setNotice('Conéctate a internet para guardar proveedores')
    const { error } = await supabase.from('suppliers').upsert({ ...supplier, company_id: companyId })
    if (error) return setNotice('No se pudo guardar el proveedor. Revisa la migración y tus permisos.')
    setSuppliers((items) => editingSupplier ? items.map((item) => item.id === supplier.id ? supplier : item) : [...items, supplier])
    setEditingSupplier(null); setModal(null); setNotice('Proveedor guardado')
  }

  async function deleteSupplier(supplier: Supplier) {
    if (!companyId || !canManageFinancials) return
    if (!window.confirm(`¿Eliminar el proveedor ${supplier.name}? Los productos vinculados quedarán sin proveedor.`)) return
    if (!navigator.onLine) return setNotice('Conéctate a internet para eliminar proveedores')
    const { error: unlinkError } = await supabase.from('products').update({ supplier_id: null }).eq('company_id', companyId).eq('supplier_id', supplier.id)
    if (unlinkError) return setNotice('No se pudieron desvincular sus productos')
    const { error } = await supabase.from('suppliers').delete().eq('company_id', companyId).eq('id', supplier.id)
    if (error) return setNotice('No se pudo eliminar el proveedor')
    setProducts((items) => items.map((product) => product.supplier_id === supplier.id ? { ...product, supplier_id: null } : product))
    setSuppliers((items) => items.filter((item) => item.id !== supplier.id))
    setNotice('Proveedor eliminado')
  }

  function supplierOrderUrl(product: Product) {
    const supplier = suppliers.find((item) => item.id === product.supplier_id)
    const phone = whatsappDigits(supplier?.whatsapp || supplier?.phone || company.order_whatsapp)
    if (!phone) return ''
    const suggestedQuantity = Math.max(1, 10 - product.stock)
    const text = `Hola ${supplier?.name || 'proveedor'}, necesito reponer ${suggestedQuantity} unidades de ${product.name} (SKU ${product.sku}). ¿Me confirmas disponibilidad y precio?`
    return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`
  }

  async function deleteProduct(product: Product) {
    if (!companyId) return
    if (!window.confirm(`¿Eliminar ${product.name}? Esta acción no se puede deshacer.`)) return
    if (!navigator.onLine) return setNotice('Conéctate a internet para eliminar productos')
    const { error } = await supabase.from('products').delete().eq('id', product.id).eq('company_id', companyId)
    if (error) return setNotice('No se pudo eliminar. Si tiene ventas asociadas, mejor deja el stock en 0.')
    const next = products.filter((item) => item.id !== product.id)
    setProducts(next); await cacheProducts(next, companyId)
    setNotice('Producto eliminado')
  }

  async function saveCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!companyId) return
    if (!navigator.onLine) return setNotice('Conéctate a internet para guardar clientes')
    const form = new FormData(event.currentTarget)
    const customer: Customer = {
      id: editingCustomer?.id ?? makeId(), name: String(form.get('name')).trim(), rut: String(form.get('rut')).trim(),
      phone: String(form.get('phone')).trim(), credit_limit: Number(form.get('credit_limit')), balance: editingCustomer?.balance ?? 0,
    }
    if (customer.credit_limit < customer.balance) return setNotice('El límite de crédito no puede quedar bajo el saldo pendiente')
    const { id, name, rut, phone, credit_limit } = customer
    const { error } = editingCustomer
      ? await supabase.from('customers').update({ name, rut, phone, credit_limit }).eq('id', id).eq('company_id', companyId)
      : await supabase.from('customers').insert({ ...customer, company_id: companyId })
    if (error) return setNotice('No se pudo guardar el cliente')
    setCustomers((items) => editingCustomer ? items.map((item) => item.id === customer.id ? customer : item) : [customer, ...items])
    setEditingCustomer(null); setModal(null); setNotice('Cliente guardado')
  }

  async function deleteCustomer(customer: Customer) {
    if (!companyId) return
    if (customer.balance > 0) return setNotice('No puedes eliminar un cliente con saldo pendiente')
    if (!window.confirm(`¿Eliminar a ${customer.name}?`)) return
    const { error } = await supabase.from('customers').delete().eq('id', customer.id).eq('company_id', companyId)
    if (error) return setNotice('No se pudo eliminar. Si tiene ventas asociadas, déjalo con límite 0.')
    setCustomers((items) => items.filter((item) => item.id !== customer.id))
    setNotice('Cliente eliminado')
  }

  async function registerPayment(customer: Customer) {
    const answer = window.prompt(`Abono para ${customer.name}. Saldo actual: ${money(customer.balance)}`)
    if (!answer) return
    const amount = Number(answer.replace(/[^0-9]/g, ''))
    if (!amount || amount > customer.balance) return setNotice('Ingresa un abono válido menor o igual al saldo')
    if (!navigator.onLine) return setNotice('Conéctate a internet para registrar un abono')
    const { data, error } = await supabase.rpc('record_customer_payment', { payment_customer: customer.id, payment_amount: amount })
    if (error || data === null) return setNotice('No se pudo registrar el abono. Revisa permisos y saldo.')
    setCustomers((items) => items.map((item) => item.id === customer.id ? { ...customer, balance: data as number } : item))
    setNotice(`Abono de ${money(amount)} registrado`)
  }

  async function saveEmployee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!companyId) return
    if (!navigator.onLine) return setNotice('Conéctate a internet para guardar al personal')
    const form = new FormData(event.currentTarget)
    const pin = String(form.get('pin') ?? '').trim()
    if (!editingEmployee && !pin) return setNotice('Asigna un PIN a la persona nueva')
    if (pin && !/^[0-9]{4,8}$/.test(pin)) return setNotice('El PIN debe tener entre 4 y 8 dígitos')
    const employee: Employee = {
      id: editingEmployee?.id ?? makeId(), name: String(form.get('name')).trim(), rut: String(form.get('rut')).trim(),
      active: form.get('active') === 'on', pin_set: Boolean(pin) || Boolean(editingEmployee?.pin_set),
    }
    const { error } = await supabase.from('employees').upsert({ id: employee.id, name: employee.name, rut: employee.rut, active: employee.active, company_id: companyId })
    if (error) return setNotice('No se pudo guardar.' + errorDetail(error))
    if (pin) {
      const { error: pinError } = await supabase.rpc('set_employee_pin', { target_employee: employee.id, new_pin: pin })
      if (pinError) { setNotice('Persona guardada, pero no se pudo asignar el PIN.' + errorDetail(pinError)); employee.pin_set = Boolean(editingEmployee?.pin_set) }
    }
    setEmployees((items) => editingEmployee ? items.map((item) => item.id === employee.id ? employee : item) : [employee, ...items])
    setEditingEmployee(null); setModal(null)
    if (!pin || employee.pin_set) setNotice('Personal guardado')
  }

  async function deleteEmployee(employee: Employee) {
    if (!companyId) return
    if (!window.confirm(`¿Eliminar a ${employee.name}? Ya no podrá iniciar turno.`)) return
    const { error } = await supabase.from('employees').delete().eq('id', employee.id).eq('company_id', companyId)
    if (error) return setNotice('No se pudo eliminar. Puedes dejarla inactiva.')
    setEmployees((items) => items.filter((item) => item.id !== employee.id))
    setNotice('Personal eliminado')
  }

  async function saveCompany(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!companyId) return
    const form = new FormData(event.currentTarget)
    const config = {
      rut: String(form.get('rut')).trim(), legal_name: String(form.get('legal_name')).trim(),
      business: String(form.get('business')).trim(), address: String(form.get('address')).trim(),
      order_whatsapp: String(form.get('order_whatsapp') ?? '').trim(),
      default_credit_limit: Math.max(0, Math.round(Number(form.get('default_credit_limit')) || 0)),
    }
    const nextCompany = { ...config, dte_endpoint: company.dte_endpoint }
    setCompany(nextCompany)
    localStorage.setItem(`mister-dte-endpoint:${companyId}`, company.dte_endpoint)
    localStorage.setItem(`mister-company:${userId}:profile`, JSON.stringify(nextCompany))
    if (!navigator.onLine) return setNotice('Guardado en este equipo; conéctate para subirlo')
    const { error } = await supabase.from('companies').update(config).eq('id', companyId)
    if (error) return setNotice('No se pudo guardar.' + errorDetail(error))
    if (dteKey) {
      if (!company.dte_endpoint) return setNotice('Configura una URL segura del servidor DTE para enviar el certificado')
      const response = await fetch(company.dte_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...config, credential: dteKey }) })
      if (!response.ok) return setNotice('El servidor DTE rechazó la configuración')
      setDteKey('')
    }
    setNotice('Datos de empresa guardados')
  }

  async function createTerminalCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const label = String(new FormData(event.currentTarget).get('label') ?? 'Caja').trim() || 'Caja'
    setTerminalError('')
    const { data, error } = await supabase.rpc('create_terminal_code', { terminal_label: label })
    if (error || typeof data !== 'string') return setTerminalError('No se pudo generar el código.' + (errorDetail(error) || ' Supabase no devolvió un código.'))
    setTerminalCode({ code: data, label, expiresAt: Date.now() + 15 * 60 * 1000 })
  }

  async function revokeTerminal(terminal: Terminal) {
    if (!companyId) return
    if (!window.confirm(`¿Desvincular "${terminal.label}"? Ese equipo dejará de poder vender hasta que lo vuelvas a autorizar.`)) return
    const { error } = await supabase.rpc('revoke_terminal', { target_user: terminal.user_id })
    if (error) return setNotice('No se pudo desvincular la caja')
    setTerminals((items) => items.filter((item) => item.user_id !== terminal.user_id))
    setNotice(`${terminal.label} desvinculada`)
  }

  async function reviewSignup(requestId: string, decision: 'approve' | 'reject'): Promise<string | null> {
    const { error } = decision === 'approve'
      ? await supabase.rpc('approve_store_signup', { request_id: requestId })
      : await supabase.rpc('reject_store_signup', { request_id: requestId })
    if (error) return `No se pudo ${decision === 'approve' ? 'aprobar' : 'rechazar'} la solicitud. Revisa la migración y la cuenta aprobadora.`
    setSignupRequests((requests) => requests.filter((request) => request.id !== requestId))
    return null
  }

  async function refreshSignupRequests(): Promise<string | null> {
    const { data, error } = await supabase.from('company_signup_requests')
      .select('id,email,rut,legal_name,business,address,created_at')
      .eq('status', 'pending').order('created_at', { ascending: true })
    if (error) return 'No se pudieron actualizar las solicitudes. Revisa conexión y permisos.'
    setSignupRequests((data ?? []) as StoreSignupRequest[])
    return null
  }

  function setPage(page: Screen) { setScreen(page); setMenuOpen(false); setQuery('') }
  function openVentas() { window.open(VENTAS_URL, '_blank', 'noopener') }

  if (recovering && authenticated) return <ResetPassword onDone={() => { setRecovering(false); window.history.replaceState(null, '', window.location.pathname) }}/>
  if (!authReady || !authenticated) return <OwnerAuth ready={authReady}/>
  if (isApprover) return <ApprovalInbox email={userEmail} requests={signupRequests} error={tenantError} onReview={reviewSignup} onRefresh={refreshSignupRequests} onSignOut={() => void supabase.auth.signOut()}/>
  if (memberRole === 'cashier') return <main className="tenant-gate"><div className="tenant-gate-mark"><ShoppingCart size={22}/></div><p className="eyebrow">CUENTA DE CAJA</p><h1>Esta cuenta es para vender</h1><p>El panel del dueño es solo para owner y admin. Usa la página de ventas en el equipo de caja.</p><div className="gate-actions"><a className="button button-dark" href={VENTAS_URL}>Ir a ventas</a><button className="button button-light" onClick={() => void supabase.auth.signOut()}>Cerrar sesión</button></div></main>
  if (!companyId || !memberRole) return <main className="tenant-gate"><div className="tenant-gate-mark"><Building2 size={22}/></div><p className="eyebrow">ESPACIO DE TRABAJO</p><h1>{tenantError ? 'Aún no puedes entrar' : 'Cargando tu almacén…'}</h1><p>{tenantError || 'Estamos preparando tus datos.'}</p>{tenantError && <button className="button button-light" onClick={() => void supabase.auth.signOut()}>Cerrar sesión</button>}</main>

  const navItems: { id: Screen; label: string; icon: typeof LayoutDashboard }[] = [
    { id: 'owner', label: 'Panel dueño', icon: LayoutDashboard }, { id: 'products', label: 'Productos', icon: Package },
    { id: 'customers', label: 'Clientes fiados', icon: HeartHandshake }, { id: 'staff', label: 'Personal', icon: Users },
    { id: 'suppliers', label: 'Proveedores', icon: Truck }, { id: 'cash', label: 'Centro de cajas', icon: Wallet },
    { id: 'accounting', label: 'Contabilidad', icon: ReceiptText }, { id: 'company', label: 'Empresa y SII', icon: Building2 },
  ]

  return (
    <div className="app-shell">
      <ProductPriceCalculator client={supabase} visible={screen === 'products'} canSaveCost companyId={companyId} products={products} onSaved={(productId, price) => { const next = products.map((item) => item.id === productId ? { ...item, price } : item); setProducts(next); void cacheProducts(next, companyId); setNotice('Precio actualizado') }}/>
      <aside className={`sidebar ${menuOpen ? 'sidebar-open' : ''}`}>
        <a className="brand" href="#inicio" onClick={(event) => { event.preventDefault(); setPage('owner') }}><Brand/></a>
        <div className="store-switch"><span className="store-avatar">{company.legal_name.slice(0, 1).toUpperCase() || 'M'}</span><span><strong>{company.legal_name || 'Mi almacén'}</strong><small>{company.rut || 'RUT pendiente'}</small></span></div>
        <p className="nav-caption">ADMINISTRACIÓN</p>
        <nav className="main-nav" aria-label="Navegación principal">
          {navItems.map(({ id, label, icon: Icon }) => <button key={id} className={`nav-link ${screen === id ? 'active' : ''}`} onClick={() => setPage(id)}><Icon size={18}/><span>{label}</span></button>)}
          <button className="nav-link nav-link-external" onClick={openVentas}><ShoppingCart size={18}/><span>Abrir ventas</span><ExternalLink size={13}/></button>
        </nav>
        <div className="sidebar-bottom">
          <div className={`connection-card ${online ? '' : 'is-offline'}`}><span className="connection-icon">{online ? <Signal size={17}/> : <SignalZero size={17}/>}</span><div><strong>{online ? 'En línea' : 'Sin conexión'}</strong><small>{pendingCount ? `${pendingCount} venta${pendingCount > 1 ? 's' : ''} antiguas por subir` : 'Datos al día'}</small></div></div>
          {pendingCount > 0 && <button className="sync-button" onClick={() => void getPendingSales(companyId).then((queue) => syncPending(companyId, queue))} disabled={!online || syncing}><ArrowLeftRight size={15}/>{syncing ? 'Sincronizando…' : 'Sincronizar ventas'}</button>}
          <button className="profile-row" onClick={() => void supabase.auth.signOut()} aria-label="Cerrar sesión"><span className="profile-avatar">{userEmail.slice(0, 2).toUpperCase()}</span><span><strong>{userEmail.split('@')[0]}</strong><small>Cerrar sesión</small></span><LogOut size={15}/></button>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <button className="mobile-menu icon-button" aria-label="Abrir menú" onClick={() => setMenuOpen(!menuOpen)}><Menu size={19}/></button>
          <div className="breadcrumb">{company.legal_name || 'Mi almacén'} <span>/</span> <strong>{navItems.find((item) => item.id === screen)?.label}</strong></div>
          <div className="topbar-actions"><span className="date-label"><Clock3 size={15}/>{new Intl.DateTimeFormat('es-CL', { weekday: 'short', day: 'numeric', month: 'long' }).format(new Date())}</span></div>
        </header>

        {screen === 'owner' && <section className="workspace owner-dashboard">
          <div className="page-heading"><div><p className="eyebrow">PANEL DE ADMINISTRACIÓN</p><h1>Panel dueño</h1><p className="muted">Resumen de {company.legal_name || 'tu almacén'}.</p></div><button className="button button-accent" onClick={openVentas}><ShoppingCart size={16}/> Abrir página de ventas</button></div>
          <div className="owner-hero"><div><span className="owner-live"><i/> VISTA DEL NEGOCIO</span><h2>Tu operación,<br/>en una sola vista.</h2><p>Las cajeras venden en otra página y no ven este panel.</p></div><div className="owner-hero-mark"><LayoutDashboard size={42}/></div></div>
          <div className="metric-strip owner-metrics">
            <Metric icon={CircleDollarSign} label="Ventas de hoy" value={money(todayTotal)} detail={`${todaySales.length} ventas registradas`}/>
            <Metric icon={Package} label="Productos activos" value={String(products.length)} detail={`${products.filter((product) => product.stock < 10).length} con stock bajo`}/>
            <Metric icon={HeartHandshake} label="Saldo fiado" value={money(totalCredit)} detail={`${customers.filter((customer) => customer.balance > 0).length} cuentas pendientes`}/>
          </div>
          <OwnerSalesReport companyId={companyId}/>
        </section>}

        {screen === 'products' && <section className="workspace"><div className="page-heading"><div><p className="eyebrow">CATÁLOGO</p><h1>Productos</h1><p className="muted">Precios, costos, códigos y stock.</p></div><button className="button button-dark" onClick={() => { setEditingProduct(null); setModal('product') }}><Plus size={16}/> Nuevo producto</button></div><div className="metric-strip"><Metric icon={Package} label="Productos activos" value={String(products.length)} detail="en tu catálogo"/><Metric icon={Activity} label="Stock bajo" value={String(products.filter((item) => item.stock < 10).length)} detail="requieren reposición"/><Metric icon={Barcode} label="Con código SKU" value={String(products.filter((item) => item.sku).length)} detail="listos para escanear"/></div><div className="table-panel"><div className="table-toolbar"><div><h2>Inventario</h2><span>Catálogo de productos y existencias</span></div><div className="search-box table-search"><Search size={16}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar producto" aria-label="Buscar producto"/></div></div><div className="table-scroll"><table><thead><tr><th>PRODUCTO</th><th>CÓDIGO SKU</th><th>CATEGORÍA</th><th>PRECIO</th><th>STOCK</th><th></th></tr></thead><tbody>{filteredProducts.map((product) => <tr key={product.id}><td><span className="table-product-icon">{product.image_url ? <img src={product.image_url} alt=""/> : <Package size={17}/>}</span><strong>{product.name}</strong></td><td className="code-cell">{product.sku || '—'}</td><td>{product.category}</td><td>{money(product.price)}</td><td><span className={`stock-pill ${product.stock < 10 ? 'low-stock' : ''}`}>{product.stock} un.</span>{product.stock <= 5 && supplierOrderUrl(product) && <a className="reorder-inline" href={supplierOrderUrl(product)} target="_blank" rel="noreferrer">Pedir</a>}</td><td><div className="row-actions"><button className="icon-button" aria-label={`Editar ${product.name}`} onClick={() => { setEditingProduct(product); setModal('product') }}><Settings2 size={16}/></button><button className="icon-button danger-hover" aria-label={`Eliminar ${product.name}`} onClick={() => void deleteProduct(product)}><Trash2 size={16}/></button></div></td></tr>)}</tbody></table>{!filteredProducts.length && <div className="table-empty">Aún no hay productos para mostrar.</div>}</div></div></section>}

        {screen === 'customers' && <section className="workspace">
          <div className="page-heading"><div><p className="eyebrow">CUENTAS POR COBRAR</p><h1>Clientes fiados</h1><p className="muted">Saldos, límites de crédito y abonos de tus clientes.</p></div><button className="button button-dark" onClick={() => { setEditingCustomer(null); setModal('customer') }}><Plus size={16}/> Nuevo cliente</button></div>
          <div className="metric-strip"><Metric icon={HeartHandshake} label="Clientes con saldo" value={String(customers.filter((item) => item.balance > 0).length)} detail="cuentas abiertas"/><Metric icon={CircleDollarSign} label="Por cobrar" value={money(customers.reduce((sum, item) => sum + item.balance, 0))} detail="saldo total pendiente"/><Metric icon={ArrowDownLeft} label="Límite disponible" value={money(customers.reduce((sum, item) => sum + Math.max(0, item.credit_limit - item.balance), 0))} detail="crédito habilitado"/></div>
          <div className="table-panel"><div className="table-toolbar"><div><h2>Libreta de fiados</h2><span>Abonos actualizan el saldo pendiente</span></div></div><div className="table-scroll"><table><thead><tr><th>CLIENTE</th><th>RUT</th><th>TELÉFONO</th><th>LÍMITE</th><th>SALDO PENDIENTE</th><th></th></tr></thead><tbody>
            {customers.map((customer) => <tr key={customer.id}><td><span className="table-person-avatar">{customer.name.split(' ').map((part) => part[0]).slice(0,2).join('')}</span><strong>{customer.name}</strong></td><td>{customer.rut}</td><td>{customer.phone || '—'}</td><td>{money(customer.credit_limit)}</td><td><strong className={customer.balance > 0 ? 'balance-due' : 'balance-clear'}>{money(customer.balance)}</strong></td><td><div className="row-actions"><button className="icon-button" aria-label={`Editar ${customer.name}`} onClick={() => { setEditingCustomer(customer); setModal('customer') }}><Settings2 size={16}/></button><button className="button button-small button-light" disabled={customer.balance <= 0} onClick={() => void registerPayment(customer)}><ArrowDownLeft size={14}/> Registrar abono</button><button className="icon-button danger-hover" aria-label={`Eliminar ${customer.name}`} disabled={customer.balance > 0} onClick={() => void deleteCustomer(customer)}><Trash2 size={16}/></button></div></td></tr>)}
          </tbody></table>{!customers.length && <EmptyTable text="Todavía no hay clientes. Agrégalos para registrar ventas a crédito."/>}</div></div>
        </section>}
        {screen === 'staff' && <section className="workspace">
          <div className="page-heading"><div><p className="eyebrow">EQUIPO</p><h1>Vendedoras y cajeras</h1><p className="muted">Cada persona inicia su turno en la página de ventas con su nombre y PIN.</p></div><button className="button button-dark" onClick={() => { setEditingEmployee(null); setModal('staff') }}><Plus size={16}/> Agregar persona</button></div>
          <div className="metric-strip"><Metric icon={Users} label="Personas registradas" value={String(employees.length)} detail="en el equipo"/><Metric icon={Check} label="Activas" value={String(employees.filter((item) => item.active).length)} detail="pueden iniciar turno"/><Metric icon={KeyRound} label="Sin PIN" value={String(employees.filter((item) => !item.pin_set).length)} detail="no pueden iniciar turno"/></div>
          <div className="table-panel"><div className="table-toolbar"><div><h2>Equipo de ventas</h2><span>El PIN se guarda cifrado; nadie puede leerlo, solo cambiarlo</span></div></div><div className="table-scroll"><table><thead><tr><th>NOMBRE</th><th>RUT</th><th>PIN</th><th>ESTADO</th><th></th></tr></thead><tbody>
            {employees.map((employee) => <tr key={employee.id}><td><span className="table-person-avatar">{initials(employee.name)}</span><strong>{employee.name}</strong></td><td>{employee.rut}</td><td>{employee.pin_set ? <span className="status-pill status-active"><i/>Asignado</span> : <span className="status-pill status-inactive"><i/>Falta PIN</span>}</td><td><span className={`status-pill ${employee.active ? 'status-active' : 'status-inactive'}`}><i/>{employee.active ? 'Activa' : 'Inactiva'}</span></td><td><div className="row-actions"><button className="icon-button" aria-label={`Editar ${employee.name}`} onClick={() => { setEditingEmployee(employee); setModal('staff') }}><Settings2 size={16}/></button><button className="icon-button danger-hover" aria-label={`Eliminar ${employee.name}`} onClick={() => void deleteEmployee(employee)}><Trash2 size={16}/></button></div></td></tr>)}
          </tbody></table>{!employees.length && <EmptyTable text="Agrega a tu primera cajera o vendedora."/>}</div></div>
        </section>}

        {screen === 'suppliers' && <SupplierManagement suppliers={suppliers} ownerPhone={company.order_whatsapp} onCreate={() => { setEditingSupplier(null); setModal('supplier') }} onEdit={(supplier) => { setEditingSupplier(supplier); setModal('supplier') }} onDelete={(supplier) => void deleteSupplier(supplier)}/>}

        {screen === 'cash' && <section className="workspace cash-workspace">
          <div className="page-heading"><div><p className="eyebrow">CONTROL DE CAJA</p><h1>Centro de cajas</h1><p className="muted">Equipos autorizados para vender y arqueos de cada turno.</p></div><button className="button button-accent" onClick={() => { setTerminalCode(null); setTerminalError(''); setModal('terminal-code') }}><Link2 size={16}/> Vincular caja</button></div>
          <div className="metric-strip"><Metric icon={Wallet} label="Estado actual" value={openSession ? 'Caja abierta' : 'Caja cerrada'} detail={openSession ? `Atiende ${openSession.cashier_name}` : 'Sin turno activo'}/><Metric icon={CircleDollarSign} label="Efectivo de hoy" value={money(todayCash)} detail={`${todaySales.length} ventas en total`}/><Metric icon={Monitor} label="Cajas vinculadas" value={String(terminals.length)} detail="equipos que pueden vender"/></div>
          <div className="table-panel"><div className="table-toolbar"><div><h2>Cajas vinculadas</h2><span>Si pierdes un equipo, desvincúlalo aquí</span></div></div><div className="table-scroll"><table><thead><tr><th>CAJA</th><th>VINCULADA</th><th>ÚLTIMO USO</th><th></th></tr></thead><tbody>{terminals.map((terminal) => <tr key={terminal.user_id}><td><strong>{terminal.label}</strong></td><td>{new Intl.DateTimeFormat('es-CL', { dateStyle: 'medium' }).format(new Date(terminal.created_at))}</td><td>{terminal.last_seen_at ? new Intl.DateTimeFormat('es-CL', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(terminal.last_seen_at)) : '—'}</td><td><div className="row-actions"><button className="button button-small button-light" onClick={() => void revokeTerminal(terminal)}><Unlink size={14}/> Desvincular</button></div></td></tr>)}</tbody></table>{!terminals.length && <EmptyTable text="Aún no hay cajas. Usa “Vincular caja” y abre la página de ventas en el equipo de venta."/>}</div></div>
          <div className="table-panel"><div className="table-toolbar"><div><h2>Arqueos</h2><span>Últimos 30 turnos</span></div><button className="button button-small button-light" onClick={() => void loadCashSessions(companyId)}><ArrowLeftRight size={14}/> Actualizar</button></div><div className="table-scroll"><table><thead><tr><th>APERTURA</th><th>CIERRE</th><th>CAJERA</th><th>FONDO</th><th>ESPERADO</th><th>CONTADO</th><th>DIFERENCIA</th></tr></thead><tbody>{cashSessions.map((session) => <tr key={session.id}><td>{new Intl.DateTimeFormat('es-CL', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(session.opened_at))}</td><td>{session.closed_at ? new Intl.DateTimeFormat('es-CL', { timeStyle: 'short' }).format(new Date(session.closed_at)) : <span className="status-pill status-active"><i/>Abierta</span>}</td><td>{session.cashier_name}</td><td>{money(session.opening_amount)}</td><td>{session.expected_amount === null ? '—' : money(session.expected_amount)}</td><td>{session.actual_amount === null ? '—' : money(session.actual_amount)}</td><td>{session.difference === null ? '—' : <strong className={session.difference < 0 ? 'balance-due' : 'balance-clear'}>{money(session.difference)}</strong>}</td></tr>)}</tbody></table>{!cashSessions.length && <EmptyTable text="Todavía no hay turnos registrados."/>}</div></div>
        </section>}

        {screen === 'accounting' && (
          <section className="workspace accounting-workspace">
            <div className="page-heading">
              <div>
                <p className="eyebrow">CONTABILIDAD Y SII</p>
                <h1>Ingresos y Egresos</h1>
                <p className="muted">Registro contable y resumen operativo.</p>
              </div>
            </div>

            <div className="metric-strip">
              <div className="card" style={{ padding: '16px' }}>
                <p className="muted">Ingresos del día</p>
                <h2>{money(todayTotal)}</h2>
                <small>{(todaySales || []).length} ventas registradas</small>
              </div>

              <div className="card" style={{ padding: '16px' }}>
                <p className="muted">Saldo Fiado</p>
                <h2>
                  {money(totalCredit)}
                </h2>
                <small>
                  {(customers || []).filter(c => c.balance > 0).length} cuentas por cobrar
                </small>
              </div>

              <div className="card" style={{ padding: '16px' }}>
                <p className="muted">Efectivo del día</p>
                <h2>{money(todayCash)}</h2>
                <small>Ventas pagadas en efectivo</small>
              </div>
            </div>

            <div className="card" style={{ marginTop: '20px', padding: '20px' }}>
              <h3>Libro de Ventas del Día</h3>
              <table className="data-table" style={{ width: '100%', marginTop: '16px' }}>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Método</th>
                    <th>Cajero</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {(todaySales || []).length === 0 ? (
                    <tr>
                      <td colSpan={4} style={{ textAlign: 'center', padding: '20px' }} className="muted">
                        No hay ventas registradas hoy.
                      </td>
                    </tr>
                  ) : (
                    (todaySales || []).map((sale, idx) => (
                      <tr key={sale.id || idx}>
                        <td>{sale.created_at ? new Intl.DateTimeFormat('es-CL', { timeStyle: 'short' }).format(new Date(sale.created_at)) : 'Hoy'}</td>
                        <td>{paymentLabel(sale.payment_method)}</td>
                        <td>{sale.cashier_name || '—'}</td>
                        <td>{money(sale.total || 0)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}
        {screen === 'company' && <section className="workspace"><div className="page-heading"><div><p className="eyebrow">DATOS TRIBUTARIOS</p><h1>Empresa y SII</h1><p className="muted">Identificación comercial y conexión con tu proveedor DTE.</p></div><span className="dte-badge"><FileText size={15}/> Boleta electrónica</span></div><div className="company-layout"><form className="form-panel company-form" onSubmit={(event) => void saveCompany(event)}><div className="panel-title"><span className="section-icon"><Building2 size={18}/></span><div><h2>Datos de la empresa</h2><p>Se mostrarán en el encabezado de los comprobantes.</p></div></div><div className="form-grid"><label>RUT empresa<input name="rut" placeholder="76.123.456-7" value={company.rut} onChange={(event) => setCompany({...company, rut:event.target.value})}/></label><label>Razón social<input name="legal_name" placeholder="Comercial Mi Negocio SpA" value={company.legal_name} onChange={(event) => setCompany({...company, legal_name:event.target.value})}/></label><label>Giro comercial<input name="business" placeholder="Venta al por menor" value={company.business} onChange={(event) => setCompany({...company, business:event.target.value})}/></label><label>Dirección comercial<input name="address" placeholder="Av. Ejemplo 123, Santiago" value={company.address} onChange={(event) => setCompany({...company, address:event.target.value})}/></label><label>WhatsApp para pedidos<input name="order_whatsapp" placeholder="+56 9 1234 5678" value={company.order_whatsapp} onChange={(event) => setCompany({...company, order_whatsapp:event.target.value})}/></label><label>Límite de fiado para clientes nuevos (CLP)<input name="default_credit_limit" type="number" min="0" step="1000" value={company.default_credit_limit} onChange={(event) => setCompany({...company, default_credit_limit:Number(event.target.value)})}/><small>Se aplica a los clientes que crean las cajeras.</small></label></div><div className="panel-divider"/><div className="panel-title"><span className="section-icon accent-icon"><FileText size={18}/></span><div><h2>Integración DTE / SII</h2><p>Conecta un servicio autorizado para emitir documentos tributarios.</p></div></div><label className="full-label">Endpoint seguro del servidor DTE<input value={company.dte_endpoint} onChange={(event) => setCompany({...company, dte_endpoint:event.target.value})} placeholder="https://tu-servidor.cl/api/dte/configuracion" type="url"/><small>El certificado o API key nunca se guarda en este dispositivo. Debe procesarlo un backend seguro.</small></label><label className="full-label">Certificado / API key<input value={dteKey} onChange={(event) => setDteKey(event.target.value)} placeholder="Se enviará solo al endpoint seguro al guardar" type="password" autoComplete="new-password"/><small>La emisión requiere credenciales, certificación y un proveedor DTE compatible con el SII.</small></label><div className="form-submit"><span><ShieldCheck size={15}/> Credenciales no persistidas en el navegador</span><button className="button button-dark" type="submit"><Check size={16}/> Guardar configuración</button></div></form><aside className="receipt-preview"><div className="receipt-top"><span className="receipt-icon"><FileText size={19}/></span><span className="dte-badge">VISTA PREVIA</span></div><span className="eyebrow">BOLETA ELECTRÓNICA</span><h2>{company.legal_name || 'Razón social'}</h2><p>{company.business || 'Giro comercial'}</p><div className="receipt-rule"/><div className="receipt-detail"><span>RUT emisor</span><strong>{company.rut || '—'}</strong></div><div className="receipt-detail"><span>Dirección</span><strong>{company.address || '—'}</strong></div><div className="receipt-rule dotted"/><div className="receipt-total"><span>Total</span><strong>{money(todayTotal)}</strong></div><p className="receipt-foot">Representación gráfica de documento tributario electrónico. La emisión real depende de la integración DTE configurada.</p></aside></div></section>}
      </main>

      {menuOpen && <button className="mobile-scrim" aria-label="Cerrar menú" onClick={() => setMenuOpen(false)}/>}
      {notice && <div className="toast" role="status"><Check size={16}/>{notice}<button onClick={() => setNotice('')} aria-label="Cerrar aviso"><X size={15}/></button></div>}

      {modal && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setModal(null) }}><section className="modal-card" role="dialog" aria-modal="true">
        <button className="modal-close icon-button" aria-label="Cerrar" onClick={() => setModal(null)}><X size={18}/></button>
        {modal === 'supplier' && <><ModalHeading icon={Truck} title={editingSupplier ? 'Editar proveedor' : 'Nuevo proveedor'} subtitle="Guarda sus datos de contacto para pedidos y reposición."/><form onSubmit={(event) => void saveSupplier(event)}><label className="form-label">Nombre del proveedor<input name="name" required defaultValue={editingSupplier?.name} placeholder="Distribuidora Ejemplo"/></label><div className="form-grid"><label className="form-label">RUT<input name="rut" defaultValue={editingSupplier?.rut} placeholder="76.123.456-7"/></label><label className="form-label">Teléfono<input name="phone" defaultValue={editingSupplier?.phone} placeholder="+56 9 1234 5678"/></label><label className="form-label">WhatsApp para pedidos<input name="whatsapp" defaultValue={editingSupplier?.whatsapp} placeholder="+56 9 1234 5678"/></label><label className="form-label">Correo<input name="email" type="email" defaultValue={editingSupplier?.email} placeholder="ventas@proveedor.cl"/></label><label className="form-label">Dirección<input name="address" defaultValue={editingSupplier?.address} placeholder="Dirección comercial"/></label></div><label className="form-label">Notas<textarea name="notes" rows={3} defaultValue={editingSupplier?.notes} placeholder="Productos, horarios o condiciones de entrega"/></label><label className="toggle-label"><input name="active" type="checkbox" defaultChecked={editingSupplier?.active ?? true}/><span>Proveedor activo</span></label><button className="button button-dark modal-submit" type="submit"><Check size={16}/> Guardar proveedor</button></form></>}
        {modal === 'product' && <ProductForm client={supabase} companyId={companyId} product={editingProduct} online={online} suppliers={suppliers} onError={setNotice} onSaved={(saved, message) => { const next = editingProduct ? products.map((item) => item.id === saved.id ? saved : item) : [saved, ...products]; setProducts(next); void cacheProducts(next, companyId); setEditingProduct(null); setModal(null); setNotice(message) }}/>}
        {modal === 'customer' && <><ModalHeading icon={HeartHandshake} title={editingCustomer ? 'Editar cliente' : 'Nuevo cliente fiado'} subtitle="Asigna un límite de crédito para controlar sus compras."/><form onSubmit={(event) => void saveCustomer(event)}><label className="form-label">Nombre completo<input name="name" required defaultValue={editingCustomer?.name} placeholder="Nombre y apellidos"/></label><div className="form-grid"><label className="form-label">RUT<input name="rut" required defaultValue={editingCustomer?.rut} placeholder="12.345.678-9"/></label><label className="form-label">Teléfono<input name="phone" defaultValue={editingCustomer?.phone} placeholder="+56 9 1234 5678"/></label><label className="form-label">Límite de crédito (CLP)<input name="credit_limit" type="number" min="0" required defaultValue={editingCustomer?.credit_limit ?? 0} placeholder="0"/></label></div><button className="button button-dark modal-submit" type="submit"><Check size={16}/> Guardar cliente</button></form></>}
        {modal === 'staff' && <><ModalHeading icon={UserRound} title={editingEmployee ? 'Editar persona' : 'Agregar al equipo'} subtitle={editingEmployee ? 'Deja el PIN vacío para mantener el actual.' : 'Con su nombre y PIN inicia turno en la página de ventas.'}/><form onSubmit={(event) => void saveEmployee(event)}><label className="form-label">Nombre completo<input name="name" required defaultValue={editingEmployee?.name} placeholder="Nombre y apellido"/></label><div className="form-grid"><label className="form-label">RUT<input name="rut" required defaultValue={editingEmployee?.rut} placeholder="12.345.678-9"/></label><label className="form-label">{editingEmployee ? 'PIN nuevo (opcional)' : 'PIN de acceso'}<input name="pin" type="password" inputMode="numeric" pattern="[0-9]{4,8}" minLength={4} maxLength={8} required={!editingEmployee} placeholder="4 a 8 dígitos" autoComplete="new-password"/></label></div><label className="toggle-label"><input name="active" type="checkbox" defaultChecked={editingEmployee?.active ?? true}/><span>Puede iniciar turno</span></label><button className="button button-dark modal-submit" type="submit"><Check size={16}/> Guardar persona</button></form></>}
        {modal === 'terminal-code' && <><ModalHeading icon={Link2} title="Vincular una caja" subtitle="Hazlo una vez en cada computador o tablet donde se venda."/>{terminalCode ? <div className="terminal-code-box"><p>En el equipo de venta abre la página de ventas, elige <strong>Código de caja</strong> y escribe:</p><strong className="terminal-code">{terminalCode.code}</strong><p className="muted">Para “{terminalCode.label}”. Vence a las {new Intl.DateTimeFormat('es-CL', { timeStyle: 'short' }).format(new Date(terminalCode.expiresAt))} y sirve una sola vez.</p><div className="receipt-actions"><button className="button button-light" onClick={() => void navigator.clipboard?.writeText(terminalCode.code).then(() => setNotice('Código copiado'))}>Copiar código</button><button className="button button-dark" onClick={() => { setModal(null); void loadTerminals(companyId) }}><Check size={16}/> Listo</button></div></div> : <form onSubmit={(event) => void createTerminalCode(event)}><label className="form-label">Nombre de la caja<input name="label" required maxLength={40} defaultValue={`Caja ${terminals.length + 1}`}/></label><p className="muted small-note">También puedes vincularla directamente en el equipo de venta con tu correo y clave; tu sesión no queda guardada ahí.</p>{terminalError && <p className="auth-error" role="alert">{terminalError}</p>}<button className="button button-dark modal-submit" type="submit"><ShieldCheck size={16}/> Generar código</button></form>}</>}
      </section></div>}
    </div>
  )
}

export default App
