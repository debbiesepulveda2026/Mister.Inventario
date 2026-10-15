import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  Activity, ArrowDownLeft, ArrowLeftRight, Barcode, Bell, Building2, Calculator, Camera, Check,
  ChevronDown, CircleDollarSign, Clock3, CreditCard, Download, FileSpreadsheet, FileText, HeartHandshake, LayoutDashboard,
  LogOut, Menu, MessageCircle, Minus, Package, Plus, Search, Settings2, ShieldCheck, ShoppingBag,
  ShoppingCart, Signal, SignalZero, Sparkles, Tags, Trash2, Truck, UserRound, Users, Wallet, X,
} from 'lucide-react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import * as XLSX from 'xlsx'
import { supabase } from './lib/supabase'
import { cacheProducts, getCachedProducts, getPendingSales, removePendingSale, savePendingSale, type PendingSale } from './lib/offline'
import { Eye, EyeOff, ReceiptText } from 'lucide-react';


type Product = { id: string; name: string; sku: string; category: string; price: number; stock: number; image_url?: string; supplier_id?: string | null }
type Supplier = { id: string; name: string; rut: string; phone: string; whatsapp: string; email: string; address: string; notes: string; active: boolean }
type Customer = { id: string; name: string; rut: string; phone: string; credit_limit: number; balance: number }
type Employee = { 
  id: string; 
  name: string; 
  rut: string; 
  active: boolean; 
  pin_hash?: string | null; 
}
type Sale = PendingSale & { synced?: boolean }
type MemberRole = 'owner' | 'admin' | 'cashier'
type StoreSignupRequest = { id: string; email: string; rut: string; legal_name: string; business: string; address: string; created_at: string }
type Screen = 'pos' | 'owner' | 'products' | 'customers' | 'staff' | 'suppliers' | 'cash' | 'company'
type BarcodeScanner = new (options: { formats: string[] }) => { detect: (source: HTMLVideoElement) => Promise<{ rawValue: string }[]> }
const APPROVER_EMAIL = 'debbie.sepulveda2026@soymas.cl'
const money = (value: number) => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(value)
const shortDate = new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: 'short' })
const makeId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
const newSku = () => `MI${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 90 + 10)}`

function whatsappDigits(value: string) {
  const digits = value.replace(/\D/g, '')
  return digits.length === 9 && digits.startsWith('9') ? `56${digits}` : digits
}

async function hashPin(pin: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits'])
  const result = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 210000, hash: 'SHA-256' }, key, 256)
  const hex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex(salt)}:${hex(new Uint8Array(result))}`
}

function authErrorText(message: string) {
  const normalized = message.toLowerCase()
  if (normalized.includes('invalid api key')) return 'Supabase rechazó la clave API. Copia la clave anon/publicable correcta desde Project Settings → API Keys y actualiza src/lib/supabase.ts.'
  if (normalized.includes('already registered') || normalized.includes('already exists')) return 'Ese correo ya tiene una cuenta. Cambia a “Inicia sesión” o restablece la contraseña.'
  if (normalized.includes('email not confirmed')) return 'Confirma tu correo desde el enlace que envió Supabase y vuelve a iniciar sesión.'
  if (normalized.includes('database error') || normalized.includes('trigger') || normalized.includes('company')) return 'No se pudo crear el almacén. Ejecuta primero schema.sql y luego tenant_migration.sql en el SQL Editor de Supabase.'
  return message
}

async function optimizeProductImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('No se pudo procesar la imagen')
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('No se pudo comprimir la imagen')), 'image/webp', 0.82))
}

function App() {
  const [authReady, setAuthReady] = useState(false)
  const [authenticated, setAuthenticated] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [userEmail, setUserEmail] = useState('')
  const [isApprover, setIsApprover] = useState(false)
  const [signupRequests, setSignupRequests] = useState<StoreSignupRequest[]>([])
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [memberRole, setMemberRole] = useState<MemberRole | null>(null)
  const [expectedCashOverride, setExpectedCashOverride] = useState<number | null>(null)
  const [tenantError, setTenantError] = useState('')
  const [screen, setScreen] = useState<Screen>('pos')
  const [online, setOnline] = useState(navigator.onLine)
  const [products, setProducts] = useState<Product[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [sales, setSales] = useState<Sale[]>([])
  const [pendingCount, setPendingCount] = useState(0)
  const [openCash, setOpenCash] = useState<{ id: string; openedAt: string; openingAmount: number; cashier: string } | null>(null)
  const [cashier, setCashier] = useState('Camila Rojas')
  const [cart, setCart] = useState<{ product: Product; quantity: number }[]>([])
  const [query, setQuery] = useState('')
  const [modal, setModal] = useState<'cash-open' | 'cash-close' | 'product' | 'customer' | 'staff' | 'supplier' | 'payment' | 'scanner' | 'receipt' | null>(null)
  const [notice, setNotice] = useState('')
  const [activeCategory, setActiveCategory] = useState('Todos')
  const [scannerError, setScannerError] = useState('')
  const [receipt, setReceipt] = useState<Sale | null>(null)
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card' | 'credit'>('cash')
  const [selectedCustomer, setSelectedCustomer] = useState('')
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)
  const [productImage, setProductImage] = useState<File | null>(null)
  const [productImagePreview, setProductImagePreview] = useState('')
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null)
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null)
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null)
  const [visiblePins, setVisiblePins] = useState<Record<string, boolean>>({})

  const togglePinVisibility = (id: string) => {
    setVisiblePins((prev) => ({ ...prev, [id]: !prev[id] }))
  }
  const [company, setCompany] = useState({ rut: '', legal_name: '', business: '', address: '', order_whatsapp: '', dte_endpoint: '' })
  const [dteKey, setDteKey] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const scannerVideo = useRef<HTMLVideoElement>(null)
  const scannerStream = useRef<MediaStream | null>(null)

  const cartTotal = cart.reduce((sum, item) => sum + item.product.price * item.quantity, 0)
  const categories = ['Todos', ...Array.from(new Set(products.map((product) => product.category).filter(Boolean)))]
  const filteredProducts = useMemo(() => products.filter((product) =>
    (activeCategory === 'Todos' || product.category === activeCategory) &&
    `${product.name} ${product.sku}`.toLowerCase().includes(query.toLowerCase()),
  ), [products, activeCategory, query])
  const todaySales = sales.filter((sale) => new Date(sale.created_at).toDateString() === new Date().toDateString())
  const sessionSales = openCash ? todaySales.filter((sale) => new Date(sale.created_at) >= new Date(openCash.openedAt)) : todaySales
  const cashExpected = expectedCashOverride ?? ((openCash?.openingAmount ?? 0) + sessionSales.filter((sale) => sale.payment_method === 'cash').reduce((sum, sale) => sum + sale.total, 0))
  const todayTotal = todaySales.reduce((sum, sale) => sum + sale.total, 0)
  const canManageFinancials = memberRole === 'owner' || memberRole === 'admin'

  useEffect(() => {
    const onOnline = () => setOnline(true)
    const onOffline = () => setOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthenticated(Boolean(session))
      setUserId(session?.user.id ?? null)
      setUserEmail(session?.user.email ?? '')
      setIsApprover(session?.user.email?.toLowerCase() === APPROVER_EMAIL)
      if (session?.user.email) setCashier(session.user.email.split('@')[0])
      setAuthReady(true)
      if (!session) {
        setCompanyId(null)
        setMemberRole(null); setExpectedCashOverride(null)
        setIsApprover(false); setSignupRequests([]); setTenantError('')
        setProducts([]); setCustomers([]); setEmployees([]); setSales([]); setOpenCash(null)
      }
    })
    void (async () => {
      const { data: { session } } = await supabase.auth.getSession()
      setAuthenticated(Boolean(session))
      setUserId(session?.user.id ?? null)
      setUserEmail(session?.user.email ?? '')
      setIsApprover(session?.user.email?.toLowerCase() === APPROVER_EMAIL)
      if (session?.user.email) setCashier(session.user.email.split('@')[0])
      setAuthReady(true)
    })()
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      subscription.unsubscribe()
      scannerStream.current?.getTracks().forEach((track) => track.stop())
    }
  }, [])

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    void (async () => {
      const isOwnerApprover = userEmail.toLowerCase() === APPROVER_EMAIL
      setIsApprover(isOwnerApprover)
      if (isOwnerApprover) {
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
        else setTenantError('No hay un rol guardado en este dispositivo. Conéctate para verificar los permisos.')
        if (cachedCompany) setCompany(JSON.parse(cachedCompany) as typeof company)
        const storedCash = localStorage.getItem(`mister-open-cash:${cachedCompanyId}`)
        if (storedCash) setOpenCash(JSON.parse(storedCash) as typeof openCash)
        const cachedProducts = await getCachedProducts<Product>(cachedCompanyId)
        const queued = await getPendingSales(cachedCompanyId)
        if (!cancelled) {
          setProducts(cachedProducts)
          setSales(queued as Sale[])
          setPendingCount(queued.length)
        }
      }

      if (!navigator.onLine) {
        if (!cachedCompanyId && !cancelled) setTenantError('Este usuario aún no tiene un almacén guardado en este dispositivo. Conéctate para cargarlo por primera vez.')
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
        else setTenantError('No encontramos una solicitud ni un almacén vinculado a esta cuenta. Registra el almacén o contacta a soporte.')
        return
      }

      const tenantId = membership.company_id as string
      const role = String(membership.role)
      if (!['owner', 'admin', 'cashier'].includes(role)) {
        setTenantError('El rol de esta cuenta no tiene acceso al almacén.')
        return
      }
      const canReadSales = role === 'owner' || role === 'admin'
setMemberRole(role as MemberRole)
localStorage.setItem(`${tenantCacheKey}:role`, role)

// ✅ Eliminamos 'order_whatsapp'
const { data: profile, error: profileError } = await supabase
  .from('companies')
  .select('id,rut,legal_name,business,address')
  .eq('id', tenantId)
  .single()

if (cancelled) return
if (profileError || !profile) {
  setTenantError('No se pudo cargar el almacén de esta cuenta.')
  return
}
      const dteEndpoint = localStorage.getItem(`mister-dte-endpoint:${tenantId}`) ?? ''
      const companyProfile = { ...profile, order_whatsapp: profile.order_whatsapp ?? '', dte_endpoint: dteEndpoint }
      localStorage.setItem(`${tenantCacheKey}:id`, tenantId)
      localStorage.setItem(`${tenantCacheKey}:profile`, JSON.stringify(companyProfile))
      setCompanyId(tenantId)
      setCompany(companyProfile)
      setTenantError('')
      const [cachedProducts, queued] = await Promise.all([getCachedProducts<Product>(tenantId), getPendingSales(tenantId)])
      if (cancelled) return
      setProducts(cachedProducts)
      setSales(queued as Sale[])
      setPendingCount(queued.length)

      const [productResult, customerResult, employeeResult] = await Promise.all([
        supabase.from('products').select('id,name,sku,category,price,stock,image_url,supplier_id').eq('company_id', tenantId).order('name'),
        supabase.from('customers').select('id,name,rut,phone,credit_limit,balance').eq('company_id', tenantId).order('name'),
      supabase
  .from('employees')
  .select('id, name, rut, active, pin_hash')
  .eq('company_id', tenantId)
  .order('name')
      ])
      if (cancelled) return
      if (productResult.data) {
        setProducts(productResult.data as Product[])
        await cacheProducts(productResult.data, tenantId)
      }
      if (customerResult.data) setCustomers(customerResult.data as Customer[])
      if (employeeResult.data) setEmployees(employeeResult.data as Employee[])
      if (canReadSales) {
        const { data: supplierRows } = await supabase.from('suppliers').select('id,name,rut,phone,whatsapp,email,address,notes,active').eq('company_id', tenantId).order('name')
        if (supplierRows) setSuppliers(supplierRows as Supplier[])
      } else {
        const { data: supplierRows } = await supabase.rpc('list_supplier_contacts')
        const contacts = (supplierRows ?? []) as Pick<Supplier, 'id' | 'name' | 'phone' | 'whatsapp' | 'active'>[]
        setSuppliers(contacts.map((supplier) => ({ ...supplier, rut: '', email: '', address: '', notes: '' })))
      }
      if (canReadSales) {
        const { data: remoteRows } = await supabase.from('sales').select('id,company_id,created_at,total,payment_method,customer_id,cashier_name,synced').eq('company_id', tenantId).order('created_at', { ascending: false }).limit(100)
        if (remoteRows) {
          const { data: saleItems } = await supabase.from('sale_items').select('sale_id,product_id,name,quantity,unit_price').eq('company_id', tenantId).in('sale_id', remoteRows.map((sale) => sale.id))
          const remoteSales = remoteRows.map((sale) => ({ ...sale, items: (saleItems ?? []).filter((item) => item.sale_id === sale.id) })) as Sale[]
          setSales([...queued.filter((sale) => !remoteSales.some((remote) => remote.id === sale.id)) as Sale[], ...remoteSales])
        }
      } else {
        setSales([])
      }
      if (navigator.onLine) void syncPending(queued)
      const { data: openSession } = await supabase.from('cash_sessions').select('id,opened_at,opening_amount,cashier_name').eq('company_id', tenantId).eq('status', 'open').order('opened_at', { ascending: false }).limit(1).maybeSingle()
      if (!cancelled && openSession) {
        const session = { id: openSession.id, openedAt: openSession.opened_at, openingAmount: openSession.opening_amount, cashier: openSession.cashier_name }
        setOpenCash(session)
        localStorage.setItem(`mister-open-cash:${tenantId}`, JSON.stringify(session))
        if (role === 'cashier') {
          const { data: expectedCash } = await supabase.rpc('get_cashier_expected_cash', { target_session: openSession.id })
          if (!cancelled && typeof expectedCash === 'number') setExpectedCashOverride(expectedCash)
        }
      }
    })()
    return () => { cancelled = true }
  }, [userId, userEmail])

  useEffect(() => {
    if (memberRole === 'cashier') setScreen('pos')
    else if (memberRole === 'owner' || memberRole === 'admin') setScreen('owner')
  }, [userId, memberRole])

  useEffect(() => {
    if (online && authenticated && companyId) void getPendingSales(companyId).then(syncPending)
  }, [online, authenticated, companyId])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 3200)
    return () => window.clearTimeout(timer)
  }, [notice])

  useEffect(() => {
    if (modal !== 'scanner') {
      scannerStream.current?.getTracks().forEach((track) => track.stop())
      scannerStream.current = null
      return
    }
    let cancelled = false
    const startScanner = async () => {
      try {
        const Detector = (window as Window & { BarcodeDetector?: BarcodeScanner }).BarcodeDetector
        if (!Detector) throw new Error('Este navegador no admite lectura automática. Ingresa el código en el buscador.')
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
              if (product) {
                addToCart(product)
                setModal(null)
                setNotice(`${product.name} agregado al carrito`)
                return
              }
              setQuery(codes[0].rawValue)
              setModal(null)
              setNotice(`Código ${codes[0].rawValue} no encontrado`)
              return
            }
          } catch { /* The next video frame may still be readable. */ }
          requestAnimationFrame(scan)
        }
        void scan()
      } catch (error) {
        setScannerError(error instanceof Error ? error.message : 'No se pudo iniciar la cámara.')
      }
    }
    setScannerError('')
    void startScanner()
    return () => { cancelled = true; scannerStream.current?.getTracks().forEach((track) => track.stop()) }
  }, [modal, products])

  async function syncPending(queue?: PendingSale[]) {
    if (!navigator.onLine || syncing || !companyId) return
    setSyncing(true)
    const pending = queue ?? await getPendingSales(companyId)
    let completed = 0
    for (const sale of pending) {
      if (sale.company_id !== companyId) continue
      const { error } = await supabase.rpc('sync_sale', { sale_payload: sale })
      if (error) break
      await removePendingSale(sale.id, companyId)
      completed += 1
    }
    const left = await getPendingSales(companyId)
    setPendingCount(left.length)
    if (completed) setSales((current) => [...pending.filter((sale) => !current.some((item) => item.id === sale.id)).map((sale) => ({ ...sale, synced: true })), ...current])
    setSyncing(false)
    if (completed) setNotice(`${completed} venta${completed === 1 ? '' : 's'} sincronizada${completed === 1 ? '' : 's'}`)
  }

  function addToCart(product: Product) {
    if (product.stock <= 0) return setNotice('Producto sin stock disponible')
    setCart((items) => {
      const found = items.find((item) => item.product.id === product.id)
      if (found) return items.map((item) => item.product.id === product.id ? { ...item, quantity: item.quantity + 1 } : item)
      return [...items, { product, quantity: 1 }]
    })
  }

  function updateQuantity(productId: string, amount: number) {
    setCart((items) => items.map((item) => item.product.id === productId ? { ...item, quantity: item.quantity + amount } : item).filter((item) => item.quantity > 0))
  }

  async function completeSale(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!companyId) return setNotice('No se pudo determinar el almacén activo')
    if (!openCash) return setNotice('Abre una caja antes de cobrar')
    if (!cart.length) return setNotice('Agrega productos al carrito')
    if (paymentMethod === 'credit' && !selectedCustomer) return setNotice('Selecciona un cliente para registrar el fiado')
    const customer = customers.find((item) => item.id === selectedCustomer)
    if (paymentMethod === 'credit' && customer && customer.balance + cartTotal > customer.credit_limit) return setNotice('La venta supera el límite de crédito disponible')
    const sale: Sale = {
      id: makeId(), company_id: companyId, created_at: new Date().toISOString(), total: cartTotal, payment_method: paymentMethod,
      customer_id: paymentMethod === 'credit' ? selectedCustomer : null, cashier_name: cashier,
      items: cart.map(({ product, quantity }) => ({ product_id: product.id, name: product.name, quantity, unit_price: product.price })), synced: false,
    }
    await savePendingSale(sale)
    setPendingCount((count) => count + 1)
    setSales((items) => [sale, ...items])
    if (memberRole === 'cashier' && paymentMethod === 'cash') {
      setExpectedCashOverride((amount) => (amount ?? openCash.openingAmount) + cartTotal)
    } else if (memberRole !== 'cashier') {
      setExpectedCashOverride(null)
    }
    if (paymentMethod === 'credit' && customer) {
      const updated = { ...customer, balance: customer.balance + cartTotal }
      setCustomers((items) => items.map((item) => item.id === customer.id ? updated : item))
    }
    const nextProducts = products.map((product) => {
      const sold = cart.find((item) => item.product.id === product.id)?.quantity ?? 0
      return sold ? { ...product, stock: Math.max(0, product.stock - sold) } : product
    })
    setProducts(nextProducts)
    await cacheProducts(nextProducts, companyId)
    setReceipt(sale)
    setCart([])
    setSelectedCustomer('')
    setModal('receipt')
    if (navigator.onLine) void syncPending()
  }

  async function saveProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!companyId) return
    const form = new FormData(event.currentTarget)
    let imageUrl = editingProduct?.image_url ?? ''
    if (productImage) {
      if (!navigator.onLine) return setNotice('Conéctate a internet para guardar una foto del producto')
      try {
        const imageBlob = await optimizeProductImage(productImage)
        const imagePath = `${companyId}/${makeId()}.webp`
        const { error: uploadError } = await supabase.storage.from('product-images').upload(imagePath, imageBlob, { contentType: 'image/webp' })
        if (uploadError) return setNotice('No se pudo subir la foto. Revisa la migración del bucket de imágenes.')
        imageUrl = supabase.storage.from('product-images').getPublicUrl(imagePath).data.publicUrl
      } catch {
        return setNotice('No se pudo procesar la foto seleccionada')
      }
    }
    const product: Product = {
      id: editingProduct?.id ?? makeId(), name: String(form.get('name')).trim(), sku: String(form.get('sku')).trim(),
      category: String(form.get('category')).trim(), price: Number(form.get('price')), stock: Number(form.get('stock')), image_url: imageUrl,
      supplier_id: String(form.get('supplier_id') ?? '') || null,
    }
    const next = editingProduct ? products.map((item) => item.id === product.id ? product : item) : [product, ...products]
    setProducts(next)
    await cacheProducts(next, companyId)
    if (navigator.onLine) {
      const { error } = await supabase.from('products').upsert({ ...product, company_id: companyId })
      if (error) setNotice('Guardado en este dispositivo; revisa la conexión con Supabase')
    }
    setEditingProduct(null); setProductImage(null); setProductImagePreview(''); setModal(null); setNotice('Producto guardado')
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
    const recipient = supplier?.name || 'proveedor'
    const suggestedQuantity = Math.max(1, 10 - product.stock)
    const text = `Hola ${recipient}, necesito reponer ${suggestedQuantity} unidades de ${product.name} (SKU ${product.sku}). ¿Me confirmas disponibilidad y precio?`
    return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`
  }

  async function deleteProduct(product: Product) {
    if (!companyId) return
    if (!window.confirm(`¿Eliminar ${product.name}?`)) return
    const next = products.filter((item) => item.id !== product.id)
    setProducts(next); await cacheProducts(next, companyId)
    if (navigator.onLine) await supabase.from('products').delete().eq('id', product.id).eq('company_id', companyId)
    setNotice('Producto eliminado')
  }

  async function saveCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!companyId) return
    const form = new FormData(event.currentTarget)
    const customer: Customer = {
      id: editingCustomer?.id ?? makeId(), name: String(form.get('name')).trim(), rut: String(form.get('rut')).trim(),
      phone: String(form.get('phone')).trim(), credit_limit: Number(form.get('credit_limit')), balance: editingCustomer?.balance ?? 0,
    }
    if (customer.credit_limit < customer.balance) return setNotice('El límite de crédito no puede quedar bajo el saldo pendiente')
    setCustomers((items) => editingCustomer ? items.map((item) => item.id === customer.id ? customer : item) : [customer, ...items])
    if (navigator.onLine) await supabase.from('customers').upsert({ ...customer, company_id: companyId })
    setEditingCustomer(null); setModal(null); setNotice('Cliente guardado')
  }

  async function deleteCustomer(customer: Customer) {
    if (!companyId) return
    if (customer.balance > 0) return setNotice('No puedes eliminar un cliente con saldo pendiente')
    if (!window.confirm(`¿Eliminar a ${customer.name}?`)) return
    setCustomers((items) => items.filter((item) => item.id !== customer.id))
    if (navigator.onLine) await supabase.from('customers').delete().eq('id', customer.id).eq('company_id', companyId)
    setNotice('Cliente eliminado')
  }

  async function registerPayment(customer: Customer) {
    const answer = window.prompt(`Abono para ${customer.name}. Saldo actual: ${money(customer.balance)}`)
    if (!answer) return
    const amount = Number(answer.replace(/[^0-9]/g, ''))
    if (!amount || amount > customer.balance) return setNotice('Ingresa un abono válido menor o igual al saldo')
    if (!navigator.onLine) return setNotice('Conéctate a internet para registrar un abono con seguridad')
    const { data, error } = await supabase.rpc('record_customer_payment', { payment_customer: customer.id, payment_amount: amount })
    if (error || data === null) return setNotice('No se pudo registrar el abono. Revisa permisos y saldo.')
    const updated = { ...customer, balance: data as number }
    setCustomers((items) => items.map((item) => item.id === customer.id ? updated : item))
    setNotice(`Abono de ${money(amount)} registrado`)
  }

  async function saveEmployee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!companyId) return
    const form = new FormData(event.currentTarget)
    const employee: Employee = {
      id: editingEmployee?.id ?? makeId(), name: String(form.get('name')).trim(), rut: String(form.get('rut')).trim(),
      active: form.get('active') === 'on',
    }
    const pinHash = await hashPin(String(form.get('pin')).trim())
    setEmployees((items) => editingEmployee ? items.map((item) => item.id === employee.id ? employee : item) : [employee, ...items])
    if (navigator.onLine) {
      const { error } = await supabase.from('employees').upsert({ ...employee, company_id: companyId, pin_hash: pinHash })
      if (error) setNotice('No se pudo guardar en Supabase; revisa las políticas RLS')
    }
    setEditingEmployee(null); setModal(null); setNotice('Personal guardado')
  }

  async function deleteEmployee(employee: Employee) {
    if (!companyId) return
    if (!window.confirm(`¿Eliminar a ${employee.name}?`)) return
    setEmployees((items) => items.filter((item) => item.id !== employee.id))
    if (navigator.onLine) await supabase.from('employees').delete().eq('id', employee.id).eq('company_id', companyId)
    setNotice('Personal eliminado')
  }

  async function saveCompany(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!companyId) return
    const form = new FormData(event.currentTarget)
    const config = {
      rut: String(form.get('rut')).trim(), legal_name: String(form.get('legal_name')).trim(),
      business: String(form.get('business')).trim(), address: String(form.get('address')).trim(),
      order_whatsapp: String(form.get('order_whatsapp')).trim(),
    }
    setCompany({ ...config, dte_endpoint: company.dte_endpoint })
    localStorage.setItem(`mister-dte-endpoint:${companyId}`, company.dte_endpoint)
    localStorage.setItem(`mister-company:${userId}:profile`, JSON.stringify({ ...config, dte_endpoint: company.dte_endpoint }))
    if (navigator.onLine) await supabase.from('companies').update(config).eq('id', companyId)
    if (dteKey) {
      if (!company.dte_endpoint) return setNotice('Configura una URL segura del servidor DTE para enviar el certificado')
      const response = await fetch(company.dte_endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...config, credential: dteKey }),
      })
      if (!response.ok) return setNotice('El servidor DTE rechazó la configuración')
      setDteKey('')
    }
    setModal(null); setNotice('Datos de empresa guardados')
  }

  async function openRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!companyId) return
    const amount = Number(new FormData(event.currentTarget).get('opening_amount'))
    const session = { id: makeId(), openedAt: new Date().toISOString(), openingAmount: amount, cashier }
    setOpenCash(session)
    setExpectedCashOverride(amount)
    localStorage.setItem(`mister-open-cash:${companyId}`, JSON.stringify(session))
    if (navigator.onLine) await supabase.from('cash_sessions').insert({ id: session.id, company_id: companyId, opened_at: session.openedAt, opening_amount: amount, cashier_name: cashier, status: 'open' })
    setModal(null); setNotice('Caja abierta y lista para vender')
  }

  async function closeRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!openCash || !companyId) return
    const actual = Number(new FormData(event.currentTarget).get('actual_amount'))
    let expectedAmount = cashExpected
    if (navigator.onLine && memberRole === 'cashier') {
      const { data } = await supabase.rpc('get_cashier_expected_cash', { target_session: openCash.id })
      if (typeof data === 'number') expectedAmount = data
    }
    const breakdown = memberRole === 'cashier'
      ? { cash: Math.max(0, expectedAmount - openCash.openingAmount) }
      : { cash: sessionSales.filter((sale) => sale.payment_method === 'cash').reduce((sum, sale) => sum + sale.total, 0), card: sessionSales.filter((sale) => sale.payment_method === 'card').reduce((sum, sale) => sum + sale.total, 0), credit: sessionSales.filter((sale) => sale.payment_method === 'credit').reduce((sum, sale) => sum + sale.total, 0) }
    if (navigator.onLine) await supabase.from('cash_sessions').update({ closed_at: new Date().toISOString(), actual_amount: actual, expected_amount: expectedAmount, difference: actual - expectedAmount, breakdown, status: 'closed' }).eq('id', openCash.id).eq('company_id', companyId)
    setOpenCash(null); setModal(null); setNotice(`Caja cerrada. Diferencia: ${money(actual - expectedAmount)}`)
    setExpectedCashOverride(null)
    localStorage.removeItem(`mister-open-cash:${companyId}`)
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

  function openProductForm(product: Product | null) {
    setEditingProduct(product)
    setProductImage(null)
    setProductImagePreview(product?.image_url ?? '')
    setModal('product')
  }

  if (!authReady || !authenticated) return <SelfServiceAuth ready={authReady} />
  if (isApprover) return <ApprovalInbox email={userEmail} requests={signupRequests} error={tenantError} onReview={reviewSignup} onRefresh={refreshSignupRequests} onSignOut={() => void supabase.auth.signOut()} />
  const navItems: { id: Screen; label: string; icon: typeof LayoutDashboard }[] = [
    { id: 'pos', label: 'Ventas POS', icon: ShoppingCart }, { id: 'owner', label: 'Panel dueño', icon: LayoutDashboard }, { id: 'products', label: 'Productos', icon: Package },
    { id: 'customers', label: 'Clientes fiados', icon: HeartHandshake }, { id: 'staff', label: 'Personal', icon: Users },
    { id: 'suppliers', label: 'Proveedores', icon: Truck },
    { id: 'cash', label: 'Centro de cajas', icon: Wallet }, { id: 'company', label: 'Empresa y SII', icon: Building2 },
    { id: 'accounting', label: 'Contabilidad SII', icon: ReceiptText },
];
 const visibleNavItems = memberRole === 'cashier'
    ? navItems.filter((item) => ['pos', 'products', 'cash'].includes(item.id))
    : memberRole === 'owner' || memberRole === 'admin'
      ? navItems
      : navItems.filter((item) => item.id === 'pos')
  const ownerPanelItems = navItems.filter((item) => ['products', 'customers', 'staff', 'suppliers', 'cash', 'company'].includes(item.id))
  const inOwnerPanel = (memberRole === 'owner' || memberRole === 'admin') && screen !== 'pos'
  if (!companyId || !memberRole) return <main className="tenant-gate"><div className="tenant-gate-mark"><Building2 size={22}/></div><p className="eyebrow">ESPACIO DE TRABAJO</p><h1>{tenantError ? 'No se pudo verificar tu acceso' : 'Cargando tu almacén…'}</h1><p>{tenantError || 'Estamos preparando tus datos privados.'}</p>{tenantError && <button className="button button-light" onClick={() => void supabase.auth.signOut()}>Cerrar sesión</button>}</main>
  return (
    <div className={`app-shell ${memberRole === 'cashier' ? 'role-cashier' : ''}`}>
      <ProductPriceCalculator visible={screen === 'products' && memberRole !== null} canSaveCost={canManageFinancials} companyId={companyId ?? ''} products={products} onSaved={(productId, price) => { setProducts((items) => items.map((item) => item.id === productId ? { ...item, price } : item)); setNotice('Precio de venta actualizado') }} />
      <aside className={`sidebar ${menuOpen ? 'sidebar-open' : ''}`}>
        <a className="brand" href="#inicio" onClick={(event) => { event.preventDefault(); setPage('pos') }}>
          <span className="brand-mark"><ShoppingBag size={21} strokeWidth={2.5} /></span>
          <span className="brand-copy"><strong>mister<span>.</span></strong><small>INVENTARIO</small></span>
        </a>
        <div className="store-switch"><span className="store-avatar">{company.legal_name.slice(0, 1).toUpperCase() || 'M'}</span><span><strong>{company.legal_name || 'Mi almacén'}</strong><small>{company.rut || 'Local principal'}</small></span><ChevronDown size={15} /></div>
        <p className="nav-caption">OPERACIÓN</p>
        <nav className="main-nav" aria-label="Navegación principal">
          {visibleNavItems.map(({ id, label, icon: Icon }) => <button key={id} className={`nav-link ${screen === id || (id === 'owner' && inOwnerPanel) ? 'active' : ''}`} onClick={() => setPage(id)}><Icon size={18} /><span>{label}</span>{id === 'owner' && signupRequests.length > 0 && <i className="nav-dot" />}</button>)}
        </nav>
        <div className="sidebar-bottom">
          <div className={`connection-card ${online ? '' : 'is-offline'}`}><span className="connection-icon">{online ? <Signal size={17} /> : <SignalZero size={17} />}</span><div><strong>{online ? 'En línea' : 'Modo sin conexión'}</strong><small>{pendingCount ? `${pendingCount} venta${pendingCount > 1 ? 's' : ''} por sincronizar` : 'Datos al día'}</small></div></div>
          {pendingCount > 0 && <button className="sync-button" onClick={() => void syncPending()} disabled={!online || syncing}><ArrowLeftRight size={15} />{syncing ? 'Sincronizando…' : 'Sincronizar ventas'}</button>}
          <button className="profile-row" onClick={() => memberRole === 'cashier' && openCash ? setNotice('Cierra tu caja antes de cambiar de turno') : void supabase.auth.signOut()} aria-label={memberRole === 'cashier' ? 'Cambiar turno' : 'Cerrar sesión'}><span className="profile-avatar">{cashier.slice(0, 2).toUpperCase()}</span><span><strong>{cashier}</strong><small>{memberRole === 'cashier' ? 'Cambiar turno' : 'Cerrar sesión'}</small></span><LogOut size={15} /></button>
        </div>
      </aside>

     <main className="main-area">
        <header className="topbar">
          <button className="mobile-menu icon-button" aria-label="Abrir menú" onClick={() => setMenuOpen(!menuOpen)}><Menu size={19} /></button>
          <div className="breadcrumb">{company.legal_name || 'Mi almacén'} <span>/</span> <strong>{navItems.find((item) => item.id === screen)?.label}</strong></div>
          <div className="topbar-actions"><span className="date-label"><Clock3 size={15} />{new Intl.DateTimeFormat('es-CL', { weekday: 'short', day: 'numeric', month: 'long' }).format(new Date())}</span><button className="icon-button notification-button" aria-label="Notificaciones"><Bell size={18} /><i /></button><span className="top-avatar">CR</span></div>
        </header>

      {screen === 'suppliers' && canManageFinancials && <SupplierManagement suppliers={suppliers} onCreate={() => { setEditingSupplier(null); setModal('supplier') }} onEdit={(supplier) => { setEditingSupplier(supplier); setModal('supplier') }} onDelete={(supplier) => void deleteSupplier(supplier)} />}

       {screen === 'cash' && (
          <section className="workspace cash-workspace">
            <div className="page-heading">
              <div>
                <p className="eyebrow">CONTROL DE CAJA</p>
                <h1>Centro de cajas</h1>
                <p className="muted">Resumen de aperturas, cierres y movimientos de efectivo.</p>
              </div>
              <button 
                className="button button-accent" 
                onClick={() => setModal(openCash ? 'cash-close' : 'cash-open')}
              >
                {openCash ? 'Cerrar caja actual' : 'Abrir nueva caja'}
              </button>
            </div>

            <div className="metric-strip">
              <Metric 
                icon={CircleDollarSign} 
                label="Estado actual" 
                value={openCash ? 'Caja Abierta' : 'Caja Cerrada'} 
                detail={openCash ? `Atendida por ${cashier || 'Cajero'}` : 'Sin turno activo'}
              />
              <Metric 
                icon={Package} 
                label="Monto de hoy" 
                value={money(todayTotal || 0)} 
                detail={`${(todaySales || []).length} ventas registradas`}
              />
              <Metric 
                icon={HeartHandshake} 
                label="Clientes con fiado" 
                value={money(
                  (customers || []).reduce((sum, c) => sum + Number(c.balance || c.debt || c.monto_fiado || c.credit || c.pending_amount || 0), 0)
                )} 
               detail={`${(customers || []).filter(c => Number((c as any).balance || (c as any).debt || (c as any).monto_fiado || (c as any).credit || (c as any).pending_amount || 0) > 0).length} cuentas pendientes`}
              />
            </div>
          </section>
        )}
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
                <h2>${(todayTotal || 0).toLocaleString('es-CL')}</h2>
                <small>{(todaySales || []).length} ventas registradas</small>
              </div>

              <div className="card" style={{ padding: '16px' }}>
                <p className="muted">Saldo Fiado</p>
                <h2>
                  ${(
                    (customers || []).reduce((sum, c) => sum + Number(c.balance || c.debt || c.monto_fiado || c.credit || c.pending_amount || 0), 0)
                  ).toLocaleString('es-CL')}
                </h2>
                <small>
                  {(customers || []).filter(c => Number(c.balance || c.debt || c.monto_fiado || c.credit || c.pending_amount || 0) > 0).length} cuentas por cobrar
                </small>
              </div>

              <div className="card" style={{ padding: '16px' }}>
                <p className="muted">Caja estimada</p>
                <h2>
                  ${(
                    (todayTotal || 0) - 
                    (customers || []).reduce((sum, c) => sum + Number(c.balance || c.debt || c.monto_fiado || c.credit || c.pending_amount || 0), 0)
                  ).toLocaleString('es-CL')}
                </h2>
                <small>Disponible</small>
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
                        <td>{sale.created_at ? new Date(sale.created_at).toLocaleTimeString() : 'Hoy'}</td>
                        <td style={{ textTransform: 'capitalize' }}>{sale.payment_method || 'Efectivo'}</td>
                        <td>{sale.cashier_name || cashier || 'Cajero'}</td>
                        <td>${(sale.total || 0).toLocaleString('es-CL')}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}
        {screen === 'owner' && (
          <section className="workspace owner-dashboard">
            <div className="page-heading">
              <div>
                <p className="eyebrow">PANEL DE ADMINISTRACIÓN</p>
                <h1>Panel dueño</h1>
                <p className="muted">Resumen de {company.legal_name || 'tu almacén'}.</p>
              </div>
              <button className="button button-accent" onClick={() => setPage('pos')}>
                <ShoppingCart size={16}/> Abrir Ventas POS
              </button>
            </div>

            <div className="owner-hero">
              <div>
                <span className="owner-live"><i/> VISTA DEL NEGOCIO</span>
                <h2>Tu operación,<br/>en una sola vista.</h2>
                <p>Ventas e información financiera solo están disponibles para owner y admin.</p>
              </div>
              <div className="owner-hero-mark"><LayoutDashboard size={42}/></div>
            </div>

            <div className="metric-strip owner-metrics">
              <Metric icon={CircleDollarSign} label="Ventas de hoy" value={money(todayTotal)} detail={`${todaySales.length} ventas registradas`}/>
              <Metric icon={Package} label="Productos activos" value={String(products.length)} detail={`${products.filter((product) => product.stock < 10).length} con stock bajo`}/>
              <Metric icon={HeartHandshake} label="Saldo fiado" value={money(customers.reduce((sum, customer) => sum + customer.balance, 0))} detail={`${customers.filter((customer) => customer.balance > 0).length} cuentas pendientes`}/>
            </div>

            {canManageFinancials && <OwnerSalesReport companyId={companyId} />}
          </section>
        )}

        {screen === 'pos' && <section className="workspace pos-workspace">
          <div className="page-heading pos-heading"><div><p className="eyebrow">{shortDate.format(new Date()).toUpperCase()} · {company.legal_name}</p><h1>Hola, {cashier} <span className="wave">✳</span></h1><p className="muted">Tu caja está lista. ¿Qué vendemos hoy?</p></div><div className="heading-actions"><span className={`cash-status ${openCash ? 'open' : 'closed'}`}><i />{openCash ? 'Caja abierta' : 'Caja cerrada'}</span>{openCash ? <button className="button button-light" onClick={() => setModal('cash-close')}><LogOut size={16} /> Cerrar caja</button> : <button className="button button-dark" onClick={() => setModal('cash-open')}><Plus size={16} /> Abrir caja</button>}{memberRole === 'cashier' && <button className="button button-light" onClick={() => openCash ? setNotice('Cierra tu caja antes de cambiar de turno') : void supabase.auth.signOut()}><UserRound size={15}/> Cambiar turno</button>}</div></div>
          <div className="pos-layout">
            <section className="catalog-panel">
              <div className="catalog-toolbar"><div className="search-box"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar producto o escanear código" aria-label="Buscar producto"/><kbd>⌘ K</kbd></div><button className="button button-light scan-button" onClick={() => setModal('scanner')}><Camera size={16} /><span>Escanear</span></button></div>
              <div className="category-tabs">{categories.map((category) => <button key={category} onClick={() => setActiveCategory(category)} className={activeCategory === category ? 'selected' : ''}>{category}</button>)}</div>
              <div className="catalog-meta"><span>Catálogo</span><span>{filteredProducts.length} productos <Tags size={14} /></span></div>
              <div className="product-grid">{filteredProducts.map((product, index) => <article key={product.id} className="product-tile" style={{ animationDelay: `${index * 35}ms` }}><button className="product-tile-main" onClick={() => addToCart(product)}><span className={`product-visual visual-${index % 4}`}>{product.image_url ? <img src={product.image_url} alt={product.name} loading="lazy"/> : <Package size={24} strokeWidth={1.7} />}</span><span className="product-name">{product.name}</span><span className="product-detail">{product.category} · {product.stock} disp.</span><span className="product-price">{money(product.price)}<span className="add-product"><Plus size={15} /></span></span></button>{product.stock <= 5 && supplierOrderUrl(product) && <a className="product-reorder-link" href={supplierOrderUrl(product)} target="_blank" rel="noreferrer"><MessageCircle size={13}/> Pedir reposición</a>}</article>)}</div>
              {!filteredProducts.length && <div className="empty-state"><Package size={24} /><strong>No encontramos productos</strong><span>Prueba otra búsqueda o agrega un producto al catálogo.</span></div>}
            </section>
            <aside className="cart-panel"><div className="cart-header"><div><h2>Venta actual</h2><span>{cart.reduce((sum, item) => sum + item.quantity, 0)} artículos</span></div><button className="icon-button" aria-label="Vaciar carrito" onClick={() => setCart([])}><Trash2 size={17} /></button></div><div className="cart-cashier"><span className="mini-avatar">CR</span><span><small>Atiende</small><strong>{cashier}</strong></span><ChevronDown size={15} /></div><div className="cart-items">{cart.map(({ product, quantity }) => <div className="cart-item" key={product.id}><div className="item-info"><strong>{product.name}</strong><small>{money(product.price)} c/u</small></div><div className="item-controls"><button aria-label={`Quitar uno de ${product.name}`} onClick={() => updateQuantity(product.id, -1)}><Minus size={13} /></button><span>{quantity}</span><button aria-label={`Agregar uno de ${product.name}`} onClick={() => updateQuantity(product.id, 1)}><Plus size={13} /></button></div><strong className="item-total">{money(product.price * quantity)}</strong></div>)}{!cart.length && <div className="cart-empty"><ShoppingCart size={25} /><span>Tu venta comienza aquí</span><small>Agrega productos desde el catálogo</small></div>}</div><div className="cart-footer"><div className="total-row"><span>Subtotal</span><span>{money(cartTotal)}</span></div><div className="total-row grand-total"><strong>Total</strong><strong>{money(cartTotal)}</strong></div><button className="button button-accent checkout-button" disabled={!cart.length || !openCash} onClick={() => setModal('payment')}><CreditCard size={18} />{openCash ? 'Cobrar venta' : 'Abre caja para cobrar'}<span>{money(cartTotal)}</span></button><p className="secure-note"><ShieldCheck size={13} /> Boleta electrónica disponible al cobrar</p></div></aside>
          </div>
        </section>}

        {screen === 'suppliers' && canManageFinancials && <SupplierManagement suppliers={suppliers} onCreate={() => { setEditingSupplier(null); setModal('supplier') }} onEdit={(supplier) => { setEditingSupplier(supplier); setModal('supplier') }} onDelete={(supplier) => void deleteSupplier(supplier)} />}

        {screen === 'products' && <section className="workspace"><div className="page-heading"><div><p className="eyebrow">CATÁLOGO</p><h1>Productos</h1><p className="muted">Controla precios, códigos y disponibilidad.</p></div><button className="button button-dark" onClick={() => openProductForm(null)}><Plus size={16} /> Nuevo producto</button></div><div className="metric-strip"><Metric icon={Package} label="Productos activos" value={String(products.length)} detail="en tu catálogo"/><Metric icon={Activity} label="Stock bajo" value={String(products.filter((item) => item.stock < 10).length)} detail="requieren reposición"/><Metric icon={Barcode} label="Con código SKU" value={String(products.filter((item) => item.sku).length)} detail="listos para escanear"/></div><div className="table-panel"><div className="table-toolbar"><div><h2>Inventario</h2><span>Catálogo de productos y existencias</span></div><div className="search-box table-search"><Search size={16}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar producto" aria-label="Buscar producto"/></div></div><div className="table-scroll"><table><thead><tr><th>PRODUCTO</th><th>CÓDIGO SKU</th><th>CATEGORÍA</th><th>PRECIO</th><th>STOCK</th><th></th></tr></thead><tbody>{filteredProducts.map((product) => <tr key={product.id}><td><span className="table-product-icon">{product.image_url ? <img src={product.image_url} alt=""/> : <Package size={17}/>}</span><strong>{product.name}</strong></td><td className="code-cell">{product.sku || '—'}</td><td>{product.category}</td><td>{money(product.price)}</td><td><span className={`stock-pill ${product.stock < 10 ? 'low-stock' : ''}`}>{product.stock} un.</span></td><td><div className="row-actions"><button className="icon-button" aria-label={`Editar ${product.name}`} onClick={() => openProductForm(product)}><Settings2 size={16}/></button><button className="icon-button danger-hover" aria-label={`Eliminar ${product.name}`} onClick={() => void deleteProduct(product)}><Trash2 size={16}/></button></div></td></tr>)}</tbody></table>{!filteredProducts.length && <div className="table-empty">Aún no hay productos para mostrar.</div>}</div></div></section>}

        {screen === 'customers' && <section className="workspace">
          <div className="page-heading"><div><p className="eyebrow">CUENTAS POR COBRAR</p><h1>Clientes fiados</h1><p className="muted">Saldos, límites de crédito y abonos de tus clientes.</p></div><button className="button button-dark" onClick={() => { setEditingCustomer(null); setModal('customer') }}><Plus size={16}/> Nuevo cliente</button></div>
          <div className="metric-strip"><Metric icon={HeartHandshake} label="Clientes con saldo" value={String(customers.filter((item) => item.balance > 0).length)} detail="cuentas abiertas"/><Metric icon={CircleDollarSign} label="Por cobrar" value={money(customers.reduce((sum, item) => sum + item.balance, 0))} detail="saldo total pendiente"/><Metric icon={ArrowDownLeft} label="Límite disponible" value={money(customers.reduce((sum, item) => sum + Math.max(0, item.credit_limit - item.balance), 0))} detail="crédito habilitado"/></div>
          <div className="table-panel"><div className="table-toolbar"><div><h2>Libreta de fiados</h2><span>Abonos actualizan el saldo pendiente</span></div></div><div className="table-scroll"><table><thead><tr><th>CLIENTE</th><th>RUT</th><th>TELÉFONO</th><th>LÍMITE</th><th>SALDO PENDIENTE</th><th></th></tr></thead><tbody>
            {customers.map((customer) => <tr key={customer.id}><td><span className="table-person-avatar">{customer.name.split(' ').map((part) => part[0]).slice(0,2).join('')}</span><strong>{customer.name}</strong></td><td>{customer.rut}</td><td>{customer.phone || '—'}</td><td>{money(customer.credit_limit)}</td><td><strong className={customer.balance > 0 ? 'balance-due' : 'balance-clear'}>{money(customer.balance)}</strong></td><td><div className="row-actions"><button className="icon-button" aria-label={`Editar ${customer.name}`} onClick={() => { setEditingCustomer(customer); setModal('customer') }}><Settings2 size={16}/></button><button className="button button-small button-light" disabled={customer.balance <= 0} onClick={() => void registerPayment(customer)}><ArrowDownLeft size={14}/> Registrar abono</button><button className="icon-button danger-hover" aria-label={`Eliminar ${customer.name}`} disabled={customer.balance > 0} onClick={() => void deleteCustomer(customer)}><Trash2 size={16}/></button></div></td></tr>)}
          </tbody></table>{!customers.length && <EmptyTable text="Todavía no hay clientes. Agrégalos para registrar ventas a crédito."/>}</div></div>
        </section>}

      {screen === 'staff' && (
  <section className="workspace">
    <div className="page-heading">
      <div>
        <p className="eyebrow">EQUIPO</p>
        <h1>Vendedoras y cajeras</h1>
        <p className="muted">Administra accesos y estado del personal.</p>
      </div>
      <button className="button button-dark" onClick={() => { setEditingEmployee(null); setModal('staff') }}>
        <Plus size={16}/> Agregar persona
      </button>
    </div>
    <div className="metric-strip">
      <Metric icon={Users} label="Personas registradas" value={String(employees.length)} detail="en el equipo"/>
      <Metric icon={Check} label="Activas" value={String(employees.filter((item) => item.active).length)} detail="con acceso habilitado"/>
      <Metric icon={ShieldCheck} label="PIN de acceso" value="••••" detail="guardado por persona"/>
    </div>
    <div className="table-panel">
      <div className="table-toolbar">
        <div>
          <h2>Equipo de ventas</h2>
          <span>PIN visible solo para administración</span>
        </div>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>NOMBRE</th>
              <th>RUT</th>
              <th>PIN</th>
              <th>ESTADO</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {employees.map((employee) => (
              <tr key={employee.id}>
                <td>
                  <span className="table-person-avatar">
                    {employee.name.split(' ').map((part) => part[0]).slice(0, 2).join('')}
                  </span>
                  <strong>{employee.name}</strong>
                </td>
                <td>{employee.rut}</td>
                <td className="code-cell">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span>
                      {visiblePins[employee.id]
                        ? (employee.pin_hash ? `${employee.pin_hash.slice(0, 8)}...` : 'Sin PIN')
                        : '••••'}
                    </span>
                    <button
                      type="button"
                      className="icon-button"
                      style={{ padding: '2px', background: 'transparent', border: 'none', cursor: 'pointer' }}
                      title={visiblePins[employee.id] ? "Ocultar PIN" : "Mostrar PIN"}
                      onClick={() => {
                        console.log('Empleado completo:', employee);
                        console.log('Valor de pin_hash:', employee.pin_hash);
                        togglePinVisibility(employee.id);
                      }}
                    >
                      {visiblePins[employee.id] ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </td>
                <td>
                  <span className={`status-pill ${employee.active ? 'status-active' : 'status-inactive'}`}>
                    <i/>{employee.active ? 'Activo' : 'Inactivo'}
                  </span>
                </td>
                <td>
                  <div className="row-actions">
                    <button className="icon-button" aria-label={`Editar ${employee.name}`} onClick={() => { setEditingEmployee(employee); setModal('staff') }}>
                      <Settings2 size={16}/>
                    </button>
                    <button className="icon-button danger-hover" aria-label={`Eliminar ${employee.name}`} onClick={() => void deleteEmployee(employee)}>
                      <Trash2 size={16}/>
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!employees.length && <EmptyTable text="Agrega a tu primera cajera o vendedora."/>}
      </div>
    </div>
  </section>
)}

        {screen === 'company' && <section className="workspace"><div className="page-heading"><div><p className="eyebrow">DATOS TRIBUTARIOS</p><h1>Empresa y SII</h1><p className="muted">Identificación comercial y conexión con tu proveedor DTE.</p></div><span className="dte-badge"><FileText size={15}/> Boleta electrónica</span></div><div className="company-layout"><form className="form-panel company-form" onSubmit={(event) => void saveCompany(event)}><div className="panel-title"><span className="section-icon"><Building2 size={18}/></span><div><h2>Datos de la empresa</h2><p>Se mostrarán en el encabezado de los comprobantes.</p></div></div><div className="form-grid"><label>RUT empresa<input name="rut" placeholder="76.123.456-7" value={company.rut} onChange={(event) => setCompany({...company, rut:event.target.value})}/></label><label>Razón social<input name="legal_name" placeholder="Comercial Mi Negocio SpA" value={company.legal_name} onChange={(event) => setCompany({...company, legal_name:event.target.value})}/></label><label>Giro comercial<input name="business" placeholder="Venta al por menor" value={company.business} onChange={(event) => setCompany({...company, business:event.target.value})}/></label><label>Dirección comercial<input name="address" placeholder="Av. Ejemplo 123, Santiago" value={company.address} onChange={(event) => setCompany({...company, address:event.target.value})}/></label></div><div className="panel-divider"/><div className="panel-title"><span className="section-icon accent-icon"><FileText size={18}/></span><div><h2>Integración DTE / SII</h2><p>Conecta un servicio autorizado para emitir documentos tributarios.</p></div></div><label className="full-label">Endpoint seguro del servidor DTE<input value={company.dte_endpoint} onChange={(event) => setCompany({...company, dte_endpoint:event.target.value})} placeholder="https://tu-servidor.cl/api/dte/configuracion" type="url"/><small>El certificado o API key nunca se guarda en este dispositivo. Debe procesarlo un backend seguro.</small></label><label className="full-label">Certificado / API key<input value={dteKey} onChange={(event) => setDteKey(event.target.value)} placeholder="Se enviará solo al endpoint seguro al guardar" type="password" autoComplete="new-password"/><small>La emisión requiere credenciales, certificación y un proveedor DTE compatible con el SII.</small></label><div className="form-submit"><span><ShieldCheck size={15}/> Credenciales no persistidas en el navegador</span><button className="button button-dark" type="submit"><Check size={16}/> Guardar configuración</button></div></form><aside className="receipt-preview"><div className="receipt-top"><span className="receipt-icon"><FileText size={19}/></span><span className="dte-badge">VISTA PREVIA</span></div><span className="eyebrow">BOLETA ELECTRÓNICA</span><h2>{company.legal_name || 'Razón social'}</h2><p>{company.business || 'Giro comercial'}</p><div className="receipt-rule"/><div className="receipt-detail"><span>RUT emisor</span><strong>{company.rut || '—'}</strong></div><div className="receipt-detail"><span>Dirección</span><strong>{company.address || '—'}</strong></div><div className="receipt-rule dotted"/><div className="receipt-total"><span>Total</span><strong>{money(receipt?.total ?? todayTotal)}</strong></div><p className="receipt-foot">Representación gráfica de documento tributario electrónico. La emisión real depende de la integración DTE configurada.</p></aside></div></section>}
      </main>

      {menuOpen && <button className="mobile-scrim" aria-label="Cerrar menú" onClick={() => setMenuOpen(false)}/>}
      {notice && <div className="toast" role="status"><Check size={16}/>{notice}<button onClick={() => setNotice('')} aria-label="Cerrar aviso"><X size={15}/></button></div>}

      {modal && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setModal(null) }}><section className={`modal-card ${modal === 'scanner' || modal === 'receipt' ? 'modal-wide' : ''}`} role="dialog" aria-modal="true">
        <button className="modal-close icon-button" aria-label="Cerrar" onClick={() => setModal(null)}><X size={18}/></button>
        {modal === 'supplier' && <><ModalHeading icon={Truck} title={editingSupplier ? 'Editar proveedor' : 'Nuevo proveedor'} subtitle="Guarda sus datos de contacto para pedidos y reposición."/><form onSubmit={(event) => void saveSupplier(event)}><label className="form-label">Nombre del proveedor<input name="name" required defaultValue={editingSupplier?.name} placeholder="Distribuidora Ejemplo"/></label><div className="form-grid"><label className="form-label">RUT<input name="rut" defaultValue={editingSupplier?.rut} placeholder="76.123.456-7"/></label><label className="form-label">Teléfono<input name="phone" defaultValue={editingSupplier?.phone} placeholder="+56 9 1234 5678"/></label><label className="form-label">WhatsApp para pedidos<input name="whatsapp" defaultValue={editingSupplier?.whatsapp} placeholder="+56 9 1234 5678"/></label><label className="form-label">Correo<input name="email" type="email" defaultValue={editingSupplier?.email} placeholder="ventas@proveedor.cl"/></label><label className="form-label">Dirección<input name="address" defaultValue={editingSupplier?.address} placeholder="Dirección comercial"/></label></div><label className="form-label">Notas<textarea name="notes" rows={3} defaultValue={editingSupplier?.notes} placeholder="Productos, horarios o condiciones de entrega"/></label><label className="toggle-label"><input name="active" type="checkbox" defaultChecked={editingSupplier?.active ?? true}/><span>Proveedor activo</span></label><button className="button button-dark modal-submit" type="submit"><Check size={16}/> Guardar proveedor</button></form></>}
        {modal === 'cash-open' && <><ModalHeading icon={Wallet} title="Abrir caja" subtitle="Registra el fondo inicial antes de comenzar a vender."/><form onSubmit={(event) => void openRegister(event)}><label className="form-label">Monto inicial / fondo de caja<div className="money-input"><span>$</span><input name="opening_amount" type="number" min="0" step="1" required placeholder="0" autoFocus/></div></label>{memberRole === 'cashier' ? <label className="form-label">Cajera responsable<input value={cashier} readOnly/></label> : <label className="form-label">Cajera responsable<select value={cashier} onChange={(event) => setCashier(event.target.value)}>{employees.filter((item) => item.active).map((employee) => <option key={employee.id} value={employee.name}>{employee.name}</option>)}{!employees.length && <option>Camila Rojas</option>}</select></label>}<button className="button button-dark modal-submit" type="submit"><Plus size={16}/> Abrir turno</button></form></>}
        {modal === 'cash-close' && <><ModalHeading icon={LogOut} title="Cerrar caja" subtitle="Compara el efectivo esperado con el arqueo real."/><div className="close-summary"><div><span>Fondo inicial</span><strong>{money(openCash?.openingAmount ?? 0)}</strong></div><div><span>Ventas en efectivo</span><strong>{money(cashExpected - (openCash?.openingAmount ?? 0))}</strong></div><div><span>Tarjeta · Fiado</span><strong>{money(todaySales.filter((sale) => sale.payment_method !== 'cash').reduce((sum, sale) => sum + sale.total, 0))}</strong></div><div className="expected-line"><span>Efectivo esperado</span><strong>{money(cashExpected)}</strong></div></div><form onSubmit={(event) => void closeRegister(event)}><label className="form-label">Efectivo real contado<div className="money-input"><span>$</span><input name="actual_amount" type="number" min="0" step="1" required placeholder="0"/></div></label><button className="button button-dark modal-submit" type="submit"><Check size={16}/> Cerrar caja y registrar arqueo</button></form></>}
        {modal === 'product' && <><ModalHeading icon={Package} title={editingProduct ? 'Editar producto' : 'Nuevo producto'} subtitle="Mantén al día el catálogo y el inventario."/><form onSubmit={(event) => void saveProduct(event)}><label className="form-label">Nombre del producto<input name="name" required defaultValue={editingProduct?.name} placeholder="Ej. Café molido 250 g"/></label><div className="product-photo-control"><span className="product-photo-preview">{productImagePreview ? <img src={productImagePreview} alt="Vista previa del producto"/> : <Package size={25}/>}</span><label className="button button-light product-photo-button"><Camera size={15}/>{productImagePreview ? 'Cambiar foto' : 'Tomar o elegir foto'}<input className="product-photo-input" type="file" accept="image/*" capture="environment" disabled={!online} onChange={(event) => { const file = event.currentTarget.files?.[0]; if (!file) return; if (file.size > 12 * 1024 * 1024) { setNotice('La foto debe pesar menos de 12 MB'); return }; if (productImagePreview.startsWith('blob:')) URL.revokeObjectURL(productImagePreview); setProductImage(file); setProductImagePreview(URL.createObjectURL(file)) }}/></label><small>La imagen se optimiza al subirla. Cámara móvil o galería.</small></div><div className="form-grid"><label className="form-label">Código SKU / EAN<div className="input-with-action"><input name="sku" defaultValue={editingProduct?.sku} placeholder="Código de barras"/><button type="button" className="generate-button" onClick={(event) => { const input = event.currentTarget.parentElement?.querySelector('input'); if (input) input.value = newSku() }}><Sparkles size={14}/> Generar</button></div></label><label className="form-label">Categoría<input name="category" required defaultValue={editingProduct?.category} placeholder="Despensa"/></label><label className="form-label">Precio (CLP)<input name="price" type="number" min="0" required defaultValue={editingProduct?.price} placeholder="0"/></label><label className="form-label">Stock inicial<input name="stock" type="number" min="0" required defaultValue={editingProduct?.stock} placeholder="0"/></label></div><button className="button button-dark modal-submit" type="submit"><Check size={16}/> Guardar producto</button></form></>}
        {modal === 'customer' && <><ModalHeading icon={HeartHandshake} title={editingCustomer ? 'Editar cliente' : 'Nuevo cliente fiado'} subtitle="Asigna un límite de crédito para controlar sus compras."/><form onSubmit={(event) => void saveCustomer(event)}><label className="form-label">Nombre completo<input name="name" required defaultValue={editingCustomer?.name} placeholder="Nombre y apellidos"/></label><div className="form-grid"><label className="form-label">RUT<input name="rut" required defaultValue={editingCustomer?.rut} placeholder="12.345.678-9"/></label><label className="form-label">Teléfono<input name="phone" defaultValue={editingCustomer?.phone} placeholder="+56 9 1234 5678"/></label><label className="form-label">Límite de crédito (CLP)<input name="credit_limit" type="number" min="0" required defaultValue={editingCustomer?.credit_limit ?? 0} placeholder="0"/></label></div><button className="button button-dark modal-submit" type="submit"><Check size={16}/> Guardar cliente</button></form></>}
        {modal === 'staff' && <><ModalHeading icon={UserRound} title={editingEmployee ? 'Editar persona' : 'Agregar al equipo'} subtitle="El PIN se guarda como hash con sal; vuelve a definirlo al editar."/><form onSubmit={(event) => void saveEmployee(event)}><label className="form-label">Nombre completo<input name="name" required defaultValue={editingEmployee?.name} placeholder="Nombre y apellidos"/></label><div className="form-grid"><label className="form-label">RUT<input name="rut" required defaultValue={editingEmployee?.rut} placeholder="12.345.678-9"/></label><label className="form-label">PIN de acceso<input name="pin" inputMode="numeric" pattern="[0-9]{4,8}" minLength={4} maxLength={8} required placeholder="4 a 8 dígitos"/></label></div><label className="toggle-label"><input name="active" type="checkbox" defaultChecked={editingEmployee?.active ?? true}/><span>Acceso activo</span></label><button className="button button-dark modal-submit" type="submit"><Check size={16}/> Guardar persona</button></form></>}
        {modal === 'payment' && <><ModalHeading icon={CreditCard} title="Cobrar venta" subtitle="Elige cómo se pagará esta compra."/><form onSubmit={(event) => void completeSale(event)}><div className="payment-options"><button type="button" className={paymentMethod === 'cash' ? 'chosen' : ''} onClick={() => setPaymentMethod('cash')}><Wallet size={18}/><strong>Efectivo</strong><span>Pago en caja</span></button><button type="button" className={paymentMethod === 'card' ? 'chosen' : ''} onClick={() => setPaymentMethod('card')}><CreditCard size={18}/><strong>Tarjeta</strong><span>Débito o crédito</span></button><button type="button" className={paymentMethod === 'credit' ? 'chosen' : ''} onClick={() => setPaymentMethod('credit')}><HeartHandshake size={18}/><strong>Fiado</strong><span>Cuenta corriente</span></button></div>{paymentMethod === 'credit' && <label className="form-label">Cliente<select required value={selectedCustomer} onChange={(event) => setSelectedCustomer(event.target.value)}><option value="">Selecciona un cliente</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name} · saldo {money(customer.balance)}</option>)}</select></label>}<div className="payment-total"><span>Total a pagar</span><strong>{money(cartTotal)}</strong></div><button className="button button-accent modal-submit" type="submit"><Check size={17}/> Confirmar venta</button></form></>}
        {modal === 'scanner' && <><ModalHeading icon={Barcode} title="Escanear producto" subtitle="Apunta la cámara al código de barras para agregarlo a la venta."/><div className="scanner-view">{scannerError ? <div className="scanner-message"><Camera size={25}/><p>{scannerError}</p></div> : <video ref={scannerVideo} autoPlay playsInline muted/>}<span className="scanner-reticle"/></div><p className="scanner-help">La cámara requiere permiso del navegador y una conexión HTTPS.</p></>}
        {modal === 'receipt' && receipt && <><div className="receipt-confirm"><span><Check size={22}/></span><div><h2>Venta registrada</h2><p>{receipt.synced ? 'Sincronizada con la nube' : 'Guardada en este dispositivo'}</p></div></div><div className="ticket"><div className="ticket-brand"><ShoppingBag size={18}/><strong>mister.</strong></div><span className="eyebrow">BOLETA ELECTRÓNICA</span><h3>{company.legal_name || 'Mi negocio'}</h3><p>{company.rut || 'RUT no configurado'} · {company.business || 'Giro comercial'}</p><p>{company.address || 'Dirección no configurada'}</p><div className="receipt-rule dotted"/>{receipt.items.map((item) => <div className="ticket-line" key={item.product_id}><span>{item.quantity} × {item.name}</span><strong>{money(item.quantity * item.unit_price)}</strong></div>)}<div className="receipt-rule"/><div className="ticket-total"><span>TOTAL</span><strong>{money(receipt.total)}</strong></div><div className="ticket-meta"><span>{new Intl.DateTimeFormat('es-CL',{dateStyle:'short',timeStyle:'short'}).format(new Date(receipt.created_at))}</span><span>{receipt.payment_method === 'cash' ? 'Efectivo' : receipt.payment_method === 'card' ? 'Tarjeta' : 'Fiado'}</span></div></div><p className="ticket-notice">Representación de comprobante. La emisión tributaria requiere integración activa con un proveedor DTE autorizado por el SII.</p><button className="button button-dark modal-submit" onClick={() => setModal(null)}><Check size={16}/> Listo</button></>}
      </section></div>}
    </div>
  )
}

function Metric({ icon: Icon, label, value, detail }: { icon: typeof Package; label: string; value: string; detail: string }) {
  return <div className="metric-card"><span className="metric-icon"><Icon size={17}/></span><div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div></div>
}

function ProductPriceCalculator({ visible, canSaveCost, companyId, products, onSaved }: {
  visible: boolean
  canSaveCost: boolean
  companyId: string
  products: Product[]
  onSaved: (productId: string, price: number) => void
}) {
  const [open, setOpen] = useState(false)
  const [productId, setProductId] = useState('')
  const [costPrice, setCostPrice] = useState('')
  const [targetMargin, setTargetMargin] = useState('30')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const selectedProduct = products.find((product) => product.id === productId)
  const cost = Number(costPrice)
  const margin = Number(targetMargin)
  const finalPrice = cost >= 0 && margin >= 0 && margin < 100 ? Math.round(cost / (1 - margin / 100)) : 0

  useEffect(() => {
    if (!products.length) return
    if (!products.some((product) => product.id === productId)) setProductId(products[0].id)
  }, [products, productId])

  useEffect(() => {
    if (!open || !productId || !companyId || !canSaveCost) return
    let cancelled = false
    setCostPrice('')
    setError('')
    void supabase.from('product_financials').select('cost_price').eq('company_id', companyId).eq('product_id', productId).maybeSingle()
      .then(({ data, error: queryError }) => {
        if (cancelled) return
        if (queryError) setError('No se pudo cargar el costo. Verifica que esté instalada la migración de costos.')
        else if (data) setCostPrice(String(data.cost_price))
      })
    return () => { cancelled = true }
  }, [open, productId, companyId, canSaveCost])

  async function savePrice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedProduct || !Number.isFinite(cost) || cost < 0 || !Number.isFinite(margin) || margin < 0 || margin >= 100) {
      setError('Ingresa un costo válido y un margen entre 0% y 99,9%.')
      return
    }
    if (!navigator.onLine) {
      setError('Conéctate a internet para guardar costos privados.')
      return
    }
    setBusy(true)
    setError('')
    const result = canSaveCost
      ? await supabase.rpc('save_product_price', { target_product: selectedProduct.id, new_cost: Math.round(cost), target_margin: margin })
      : await supabase.from('products').update({ price: finalPrice }).eq('id', selectedProduct.id).eq('company_id', companyId).select('price').single()
    setBusy(false)
    if (result.error) {
      setError(canSaveCost ? 'No se pudo guardar el costo y precio. Verifica la migración y tu rol owner/admin.' : 'No se pudo actualizar el precio. Verifica tu conexión y el permiso de catálogo.')
      return
    }
    const savedPrice = canSaveCost ? Number(result.data) : Number((result.data as { price: number }).price)
    onSaved(selectedProduct.id, savedPrice)
    setOpen(false)
  }

  if (!visible) return null
  return <>
    <button className="price-calculator-launcher" onClick={() => setOpen(true)}><Calculator size={16}/> Calcular precio</button>
    {open && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false) }}><section className="modal-card price-calculator" role="dialog" aria-modal="true" aria-labelledby="price-calculator-title"><button className="modal-close icon-button" aria-label="Cerrar calculadora" onClick={() => setOpen(false)}><X size={18}/></button><div className="modal-heading"><span className="modal-icon calculator-icon"><Calculator size={20}/></span><div><h2 id="price-calculator-title">Precio y margen</h2><p>{canSaveCost ? 'El costo se guardará de forma privada para este almacén.' : 'Calcula el precio sugerido; el costo solo se usa temporalmente en esta sesión.'}</p></div></div><form onSubmit={(event) => void savePrice(event)}><label className="form-label">Producto<select required value={productId} onChange={(event) => setProductId(event.target.value)}><option value="" disabled>Selecciona un producto</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label><div className="calculator-input-grid"><label className="form-label">Costo unitario<input type="number" required min="0" step="1" value={costPrice} onChange={(event) => setCostPrice(event.target.value)} placeholder="0"/></label><label className="form-label">Margen objetivo (%)<input type="number" required min="0" max="99.9" step="0.1" value={targetMargin} onChange={(event) => setTargetMargin(event.target.value)}/></label></div><div className="price-calculator-result"><span>Precio final sugerido</span><strong>{money(finalPrice)}</strong>{canSaveCost && <small>Utilidad unitaria estimada: {money(Math.max(0, finalPrice - cost))}</small>}</div>{error && <p className="auth-error" role="alert">{error}</p>}<button className="button button-dark modal-submit" type="submit" disabled={busy || !selectedProduct}>{busy ? 'Guardando…' : canSaveCost ? 'Guardar costo y precio' : 'Aplicar precio al catálogo'}</button></form></section></div>}
  </>
}

type ReportSale = { id: string; created_at: string; total: number; payment_method: string; cashier_name: string; customer_id: string | null }

function SupplierManagement({ suppliers, onCreate, onEdit, onDelete, ownerPhone }: {
  suppliers: Supplier[]
  onCreate: () => void
  onEdit: (supplier: Supplier) => void
  onDelete: (supplier: Supplier) => void
  ownerPhone?: string
}) {
  const activeSuppliers = suppliers.filter((supplier) => supplier.active).length

  function sendWhatsAppToOwner(supplierName?: string) {
    const rawNumber = ownerPhone || ''
    const cleanNumber = rawNumber.replace(/\D/g, '')
    if (!cleanNumber) {
      alert('El teléfono del dueño no está configurado en los ajustes de la tienda.')
      return
    }
    const formatted = cleanNumber.startsWith('56') ? cleanNumber : `56${cleanNumber}`
    const text = encodeURIComponent(
      supplierName 
        ? `Hola! Necesitamos reposición de productos del proveedor: ${supplierName}.` 
        : `Hola! Se necesita reposición de stock en caja.`
    )
    window.open(`https://wa.me/${formatted}?text=${text}`, '_blank')
  }

  return (
    <section className="workspace">
      <div className="page-heading">
        <div>
          <p className="eyebrow">COMPRAS Y REPOSICIÓN</p>
          <h1>Proveedores y Reposición</h1>
          <p className="muted">Gestión de contactos y solicitudes de stock al dueño por WhatsApp.</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="button button-light" onClick={() => sendWhatsAppToOwner()}>
            <MessageCircle size={16} /> Pedir reposición al dueño
          </button>
          <button className="button button-dark" onClick={onCreate}>
            <Plus size={16} /> Nuevo proveedor
          </button>
        </div>
      </div>

      <div className="metric-strip">
        <Metric icon={Truck} label="Proveedores activos" value={String(activeSuppliers)} detail="disponibles para pedidos" />
        <Metric icon={MessageCircle} label="Aviso al Dueño" value={ownerPhone ? 'Configurado' : 'Sin número'} detail={ownerPhone || 'agrega número en ajustes'} />
        <Metric icon={Package} label="Productos vinculados" value="En catálogo" detail="asigna proveedor en edición" />
      </div>

      <div className="table-panel">
        <div className="table-toolbar">
          <div>
            <h2>Directorio de proveedores</h2>
            <span>Solicita reposición de un proveedor específico directamente al dueño</span>
          </div>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>PROVEEDOR</th>
                <th>RUT</th>
                <th>PEDIR REPOSICIÓN</th>
                <th>CORREO</th>
                <th>ESTADO</th>
                <th>ACCIONES</th>
              </tr>
            </thead>
            <tbody>
              {suppliers.map((supplier) => (
                <tr key={supplier.id}>
                  <td>
                    <span className="table-person-avatar supplier-avatar"><Truck size={14} /></span>
                    <strong>{supplier.name}</strong>
                  </td>
                  <td>{supplier.rut || '—'}</td>
                  <td>
                    <button className="button button-light button-xs" onClick={() => sendWhatsAppToOwner(supplier.name)} title="Avisar al dueño para reposición de este proveedor">
                      <MessageCircle size={14} /> Pedir al dueño
                    </button>
                  </td>
                  <td>{supplier.email || '—'}</td>
                  <td>
                    <span className={`status-pill ${supplier.active ? 'status-active' : 'status-inactive'}`}>
                      <i />{supplier.active ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td>
                    <div className="row-actions">
                      <button className="icon-button" aria-label={`Editar ${supplier.name}`} onClick={() => onEdit(supplier)}><Settings2 size={16} /></button>
                      <button className="icon-button danger-hover" aria-label={`Eliminar ${supplier.name}`} onClick={() => onDelete(supplier)}><Trash2 size={16} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!suppliers.length && <EmptyTable text="Agrega proveedores para organizar las marcas y pedir reposición al dueño." />}
        </div>
      </div>
    </section>
  )
}

function dateInputValue(date: Date) {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return localDate.toISOString().slice(0, 10)
}

function OwnerSalesReport({ companyId }: { companyId: string }) {
  const today = new Date()
  const initialStart = new Date(today)
  initialStart.setDate(initialStart.getDate() - 29)
  const [fromDate, setFromDate] = useState(dateInputValue(initialStart))
  const [toDate, setToDate] = useState(dateInputValue(today))
  const [period, setPeriod] = useState('30')
  const [rows, setRows] = useState<ReportSale[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!companyId || !fromDate || !toDate || fromDate > toDate) return
    let cancelled = false
    setLoading(true)
    setError('')
    void (async () => {
      const start = new Date(`${fromDate}T00:00:00`).toISOString()
      const end = new Date(`${toDate}T23:59:59.999`).toISOString()
      const allRows: ReportSale[] = []
      for (let offset = 0; ; offset += 1000) {
        const { data, error: queryError } = await supabase.from('sales')
          .select('id,created_at,total,payment_method,cashier_name,customer_id')
          .eq('company_id', companyId).gte('created_at', start).lte('created_at', end)
          .order('created_at', { ascending: true }).range(offset, offset + 999)
        if (queryError) {
          if (!cancelled) { setRows([]); setError('No se pudieron cargar las ventas del rango. Verifica la conexión y permisos.') }
          break
        }
        const page = (data ?? []) as ReportSale[]
        allRows.push(...page)
        if (page.length < 1000) break
      }
      if (!cancelled) setRows(allRows)
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [companyId, fromDate, toDate])

  const dailyRows = useMemo(() => {
    const byDay = new Map<string, { date: string; total: number; count: number }>()
    for (const sale of rows) {
      const key = dateInputValue(new Date(sale.created_at))
      const day = byDay.get(key) ?? { date: key, total: 0, count: 0 }
      day.total += sale.total
      day.count += 1
      byDay.set(key, day)
    }
    return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)).map((day) => ({
      ...day,
      label: new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: 'short' }).format(new Date(`${day.date}T12:00:00`)),
    }))
  }, [rows])
  const salesTotal = rows.reduce((sum, sale) => sum + sale.total, 0)
  const averageSale = rows.length ? Math.round(salesTotal / rows.length) : 0

  function chooseRange(days: number) {
    const end = new Date()
    const start = new Date(end)
    start.setDate(start.getDate() - (days - 1))
    setPeriod(String(days))
    setFromDate(dateInputValue(start))
    setToDate(dateInputValue(end))
  }

  function exportExcel() {
    if (!rows.length) return setError('No hay ventas para exportar en este rango.')
    const summaryRows = dailyRows.map((day) => ({
      Fecha: new Intl.DateTimeFormat('es-CL', { dateStyle: 'medium' }).format(new Date(`${day.date}T12:00:00`)),
      'Ventas Realizadas': day.count,
      'Total Día ($)': day.total,
    }))
    const detailRows = rows.map((sale) => ({
      'ID Venta': sale.id,
      Fecha: new Intl.DateTimeFormat('es-CL', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(sale.created_at)),
      'Medio de Pago': sale.payment_method === 'cash' ? 'Efectivo' : sale.payment_method === 'card' ? 'Tarjeta' : 'Fiado',
      Cajera: sale.cashier_name || 'Sistema',
      'Total ($)': sale.total,
      'ID Cliente': sale.customer_id ?? 'N/A',
    }))
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(summaryRows), 'Resumen Diario')
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(detailRows), 'Detalle de Ventas')
    XLSX.writeFile(workbook, `ventas-${fromDate}-al-${toDate}.xlsx`)
  }

  return (
    <section className="space-y-6 p-6 max-w-7xl mx-auto">
      {/* Encabezado Principal */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-gray-200">
        <div>
          <span className="text-xs font-semibold tracking-wider text-emerald-700 uppercase">Rendimiento</span>
          <h2 className="text-2xl font-bold text-gray-900 mt-1">Ventas Diarias</h2>
          <p className="text-sm text-gray-500">Seguimiento e historial de ingresos del negocio</p>
        </div>
        <button
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-800 hover:bg-emerald-900 text-white font-medium text-sm rounded-lg shadow-sm transition-all disabled:opacity-50 cursor-pointer"
          onClick={exportExcel}
          disabled={loading || !rows.length}
        >
          <Download size={16} />
          <FileSpreadsheet size={16} />
          Exportar Excel
        </button>
      </div>

      {/* Barra de Filtros y Controles de Fecha */}
      <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        {/* Pestañas de Períodos Predefinidos */}
        <div className="inline-flex p-1 bg-gray-100 rounded-lg text-sm font-medium text-gray-600">
          {[7, 30, 90].map((days) => (
            <button
              key={days}
              className={`px-3 py-1.5 rounded-md transition-all cursor-pointer ${
                period === String(days)
                  ? 'bg-white text-gray-900 shadow-sm font-semibold'
                  : 'hover:text-gray-900'
              }`}
              onClick={() => chooseRange(days)}
            >
              {days} días
            </button>
          ))}
          <button
            className={`px-3 py-1.5 rounded-md transition-all cursor-pointer ${
              period === 'custom'
                ? 'bg-white text-gray-900 shadow-sm font-semibold'
                : 'hover:text-gray-900'
            }`}
            onClick={() => setPeriod('custom')}
          >
            Personalizado
          </button>
        </div>

        {/* Inputs de Fechas */}
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs font-medium text-gray-600">
            Desde
            <input
              type="date"
              value={fromDate}
              max={toDate}
              className="px-3 py-1.5 bg-gray-50 border border-gray-300 rounded-lg text-sm text-gray-800 focus:ring-2 focus:ring-emerald-500 outline-none"
              onChange={(e) => {
                setPeriod('custom')
                setFromDate(e.target.value)
              }}
            />
          </label>
          <label className="flex items-center gap-2 text-xs font-medium text-gray-600">
            Hasta
            <input
              type="date"
              value={toDate}
              min={fromDate}
              max={dateInputValue(new Date())}
              className="px-3 py-1.5 bg-gray-50 border border-gray-300 rounded-lg text-sm text-gray-800 focus:ring-2 focus:ring-emerald-500 outline-none"
              onChange={(e) => {
                setPeriod('custom')
                setToDate(e.target.value)
              }}
            />
          </label>
        </div>
      </div>

      {/* Métricas e Indicadores Clave */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Total del período</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{money(salesTotal)}</p>
        </div>
        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Transacciones</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{rows.length}</p>
        </div>
        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Venta promedio</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{money(averageSale)}</p>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600" role="alert">
          {error}
        </div>
      )}

      {/* Contenedor del Gráfico */}
      <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
        <div className="w-full h-80">
          {loading ? (
            <div className="h-full flex items-center justify-center text-sm text-gray-500">
              Cargando datos de ventas…
            </div>
          ) : dailyRows.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dailyRows} margin={{ top: 12, right: 10, left: 10, bottom: 3 }}>
                <CartesianGrid stroke="#f1f5f9" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fill: '#64748b', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tickFormatter={(val: number) => (val >= 1000 ? `$${Math.round(val / 1000)}k` : `$${val}`)}
                  tick={{ fill: '#64748b', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  width={55}
                />
                <Tooltip
                  formatter={(val) => money(Number(val))}
                  labelStyle={{ color: '#0f172a', fontWeight: 'bold' }}
                  contentStyle={{
                    backgroundColor: '#ffffff',
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                    boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)',
                    fontSize: '12px',
                  }}
                />
                <Bar dataKey="total" name="Ventas" fill="#047857" radius={[6, 6, 0, 0]} maxBarSize={38} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex flex-col items-center justify-center gap-2 text-gray-400">
              <Activity size={24} />
              <span className="text-sm font-medium">No hay ventas registradas en este rango.</span>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

function SelfServiceAuth({ ready }: { ready: boolean }) {
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [rut, setRut] = useState('')
  const [legalName, setLegalName] = useState('')
  const [business, setBusiness] = useState('')
  const [address, setAddress] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  async function registerStore(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setMessage('')
    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { rut: rut.trim(), legal_name: legalName.trim(), business: business.trim(), address: address.trim() } },
    })
    if (signUpError) {
      setBusy(false)
      setError(authErrorText(signUpError.message))
      return
    }
    if (data.user?.identities?.length === 0) {
      setBusy(false)
      setMode('login')
      setMessage('Ese correo ya tiene una cuenta. Inicia sesión con ella para revisar su estado de aprobación.')
      return
    }
    let emailSent = false
    if (data.user?.id) {
      const { data: notification, error: notificationError } = await supabase.functions.invoke('notify-store-signup', {
        body: { user_id: data.user.id },
      })
      emailSent = !notificationError && notification?.email_sent === true
    }
    setBusy(false)
    setMode('login')
    setMessage(emailSent
      ? 'Solicitud enviada. Confirma tu correo; la administradora recibió tu solicitud y debe aprobarla antes del acceso.'
      : 'Solicitud recibida. Confirma tu correo; la notificación a la administradora no pudo enviarse y debe configurarse el servicio de correo.')
  }

  if (mode === 'login') return <div className="access-login"><AuthGate ready={ready}/>{message && <p className="auth-message auth-login-message" role="status">{message}</p>}<button className="auth-mode-overlay" onClick={() => { setMode('signup'); setError(''); setMessage('') }}>¿Primera vez? Crear almacén</button></div>

  return <main className="auth-shell"><section className="auth-art"><div className="auth-brand"><span className="brand-mark"><ShoppingBag size={21}/></span><span className="brand-copy"><strong>mister<span>.</span></strong><small>INVENTARIO</small></span></div><div className="auth-art-copy"><p className="eyebrow">UN ESPACIO SOLO TUYO</p><h1>Tu almacén.<br/>Tus números.</h1><p>Productos, clientes y ventas quedan separados de los demás negocios.</p><div className="auth-art-stats"><span><strong>01</strong><small>Una cuenta</small></span><span><strong>02</strong><small>Un almacén</small></span><span><strong>03</strong><small>Datos privados</small></span></div></div><span className="auth-art-foot">MISTER INVENTARIO · GESTIÓN DE NEGOCIOS</span></section><section className="auth-form-side"><form className="auth-form signup-form" onSubmit={(event) => void registerStore(event)}><span className="auth-mobile-brand"><ShoppingBag size={18}/> mister.</span><p className="eyebrow">REGISTRO DE NEGOCIO</p><h2>Crea tu almacén</h2><p className="auth-subtitle">Tu catálogo y tus ventas partirán vacíos y privados.</p><label>RUT comercial<input required value={rut} onChange={(event) => setRut(event.target.value)} placeholder="76.123.456-7" autoComplete="organization"/></label><label>Razón social<input required value={legalName} onChange={(event) => setLegalName(event.target.value)} placeholder="Almacén Ejemplo SpA" autoComplete="organization-title"/></label><label>Giro comercial<input required value={business} onChange={(event) => setBusiness(event.target.value)} placeholder="Venta al por menor"/></label><label>Dirección<input required value={address} onChange={(event) => setAddress(event.target.value)} placeholder="Comuna y dirección" autoComplete="street-address"/></label><label>Correo de acceso<input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="nombre@negocio.cl" autoComplete="email"/></label><label>Contraseña<input type="password" required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Mínimo 8 caracteres" autoComplete="new-password"/></label>{error && <p className="auth-error" role="alert">{error}</p>}{message && <p className="auth-message" role="status">{message}</p>}<button className="button button-dark auth-submit" type="submit" disabled={!ready || busy}>{busy ? 'Creando almacén…' : 'Crear cuenta y almacén'}<span>→</span></button><button className="auth-mode-toggle" type="button" onClick={() => { setMode('login'); setError(''); setMessage('') }}>¿Ya tienes cuenta? Inicia sesión</button><p className="auth-security"><ShieldCheck size={14}/> Tus datos se guardan en un espacio separado</p></form><span className="auth-legal">Cada cuenta crea un espacio privado con su propio inventario y ventas.</span></section></main>
}

function ApprovalInbox({ email, requests, error, onReview, onRefresh, onSignOut }: {
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

  return <main className="approval-shell"><header className="approval-topbar"><a className="brand" href="#aprobaciones"><span className="brand-mark"><ShoppingBag size={21}/></span><span className="brand-copy"><strong>mister<span>.</span></strong><small>ADMINISTRACIÓN</small></span></a><div className="approval-user"><span>{email}</span><button className="button button-light" onClick={onSignOut}><LogOut size={15}/> Cerrar sesión</button></div></header><section className="approval-content"><p className="eyebrow">ALTAS DE COMERCIOS</p><div className="approval-title"><div><h1>Solicitudes de almacén</h1><p>Revisa los datos comerciales y aprueba quién puede ingresar.</p></div><div className="approval-title-actions"><span className="approval-count">{requests.length} pendientes</span><button className="icon-button approval-refresh" aria-label="Actualizar solicitudes" title="Actualizar solicitudes" disabled={refreshing} onClick={() => void refresh()}><ArrowLeftRight size={16}/></button></div></div>{error && <p className="approval-error" role="alert">{error}</p>}{message && <p className="approval-feedback" role="status">{message}</p>}{requests.length ? <div className="approval-list">{requests.map((request) => <article className="approval-request" key={request.id}><div className="request-main"><span className="request-avatar"><Building2 size={19}/></span><div className="request-heading"><h2>{request.legal_name}</h2><span>{request.email}</span></div><time>{new Intl.DateTimeFormat('es-CL',{dateStyle:'medium',timeStyle:'short'}).format(new Date(request.created_at))}</time></div><dl className="request-details"><div><dt>RUT comercial</dt><dd>{request.rut}</dd></div><div><dt>Giro</dt><dd>{request.business}</dd></div><div><dt>Dirección</dt><dd>{request.address}</dd></div></dl><div className="request-actions"><button className="button button-light reject-button" disabled={busyId === request.id} onClick={() => void decide(request.id, 'reject')}><X size={15}/> Rechazar</button><button className="button button-dark" disabled={busyId === request.id} onClick={() => void decide(request.id, 'approve')}><Check size={15}/>{busyId === request.id ? 'Procesando…' : 'Aprobar almacén'}</button></div></article>)}</div> : <div className="approval-empty"><span><Check size={21}/></span><h2>No hay solicitudes pendientes</h2><p>Cuando alguien registre un almacén, aparecerá aquí y recibirás un correo.</p></div>}</section></main>
}

function AuthGate({ ready }: { ready: boolean }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
    setBusy(false)
    if (signInError) setError(authErrorText(signInError.message))
  }

  return <main className="auth-shell"><section className="auth-art"><div className="auth-brand"><span className="brand-mark"><ShoppingBag size={21}/></span><span className="brand-copy"><strong>mister<span>.</span></strong><small>INVENTARIO</small></span></div><div className="auth-art-copy"><span className="auth-orbit orbit-one"/><span className="auth-orbit orbit-two"/><p className="eyebrow">TU NEGOCIO, EN ORDEN</p><h1>Vender bien<br/>se siente bien.</h1><p>Inventario, caja y cuentas claras. Todo en el mismo lugar.</p><div className="auth-art-stats"><span><strong>01</strong><small>Inventario vivo</small></span><span><strong>02</strong><small>Ventas al día</small></span><span><strong>03</strong><small>Caja en control</small></span></div></div><span className="auth-art-foot">MISTER INVENTARIO · GESTIÓN DE NEGOCIOS</span></section><section className="auth-form-side"><form className="auth-form" onSubmit={(event) => void signIn(event)}><span className="auth-mobile-brand"><ShoppingBag size={18}/> mister.</span><p className="eyebrow">BIENVENIDA DE VUELTA</p><h2>Inicia sesión</h2><p className="auth-subtitle">Accede a tu espacio de trabajo.</p>{!ready && <div className="auth-loading">Conectando con Supabase…</div>}<label>Correo electrónico<input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="nombre@negocio.cl"/></label><label>Contraseña<input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="••••••••••"/></label>{error && <p className="auth-error" role="alert">{error}</p>}<button className="button button-dark auth-submit" type="submit" disabled={!ready || busy}>{busy ? 'Ingresando…' : 'Entrar al negocio'}<span>→</span></button><p className="auth-security"><ShieldCheck size={14}/> Acceso protegido por Supabase Auth</p></form><span className="auth-legal">Tus datos se almacenan de forma segura en tu proyecto Supabase.</span></section></main>
}

function ModalHeading({ icon: Icon, title, subtitle }: { icon: typeof Package; title: string; subtitle: string }) {
  return <div className="modal-heading"><span className="modal-icon"><Icon size={20}/></span><div><h2>{title}</h2><p>{subtitle}</p></div></div>
}

function EmptyTable({ text }: { text: string }) {
  return <div className="table-empty"><Users size={22}/><span>{text}</span></div>
}

export default App