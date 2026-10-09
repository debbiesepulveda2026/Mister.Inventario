export interface PendingSale {
  id: string
  company_id: string
  created_at: string
  total: number
  payment_method: 'cash' | 'card' | 'credit'
  customer_id: string | null
  cashier_name: string
  items: { product_id: string; name: string; quantity: number; unit_price: number }[]
}

const databaseName = 'mister-inventario'
const databaseVersion = 1
const pendingStore = 'pending-sales'
const cacheStore = 'cache'

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('IndexedDB no está disponible'))
    const request = indexedDB.open(databaseName, databaseVersion)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(pendingStore)) database.createObjectStore(pendingStore, { keyPath: 'id' })
      if (!database.objectStoreNames.contains(cacheStore)) database.createObjectStore(cacheStore)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function localFallback<T>(key: string, fallback: T): T {
  try {
    const stored = localStorage.getItem(key)
    return stored ? JSON.parse(stored) as T : fallback
  } catch {
    return fallback
  }
}

export async function savePendingSale(sale: PendingSale): Promise<void> {
  try {
    const database = await openDatabase()
    await new Promise<void>((resolve, reject) => {
      const request = database.transaction(pendingStore, 'readwrite').objectStore(pendingStore).put(sale)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
    database.close()
  } catch {
    const key = `mister-pending-sales:${sale.company_id}`
    const sales = localFallback<PendingSale[]>(key, [])
    localStorage.setItem(key, JSON.stringify([...sales.filter((item) => item.id !== sale.id), sale]))
  }
}

export async function getPendingSales(companyId: string): Promise<PendingSale[]> {
  try {
    const database = await openDatabase()
    const sales = await new Promise<PendingSale[]>((resolve, reject) => {
      const request = database.transaction(pendingStore, 'readonly').objectStore(pendingStore).getAll()
      request.onsuccess = () => resolve(request.result as PendingSale[])
      request.onerror = () => reject(request.error)
    })
    database.close()
    return sales.filter((sale) => sale.company_id === companyId)
  } catch {
    return localFallback<PendingSale[]>(`mister-pending-sales:${companyId}`, [])
  }
}

export async function removePendingSale(id: string, companyId: string): Promise<void> {
  try {
    const database = await openDatabase()
    await new Promise<void>((resolve, reject) => {
      const request = database.transaction(pendingStore, 'readwrite').objectStore(pendingStore).delete(id)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
    database.close()
  } catch {
    const key = `mister-pending-sales:${companyId}`
    const sales = localFallback<PendingSale[]>(key, [])
    localStorage.setItem(key, JSON.stringify(sales.filter((sale) => sale.id !== id)))
  }
}

export async function cacheProducts(products: unknown[], companyId: string): Promise<void> {
  try {
    const database = await openDatabase()
    await new Promise<void>((resolve, reject) => {
      const request = database.transaction(cacheStore, 'readwrite').objectStore(cacheStore).put(products, `${companyId}:products`)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
    database.close()
  } catch {
    localStorage.setItem(`mister-products-cache:${companyId}`, JSON.stringify(products))
  }
}

export async function getCachedProducts<T>(companyId: string): Promise<T[]> {
  try {
    const database = await openDatabase()
    const products = await new Promise<T[]>((resolve, reject) => {
      const request = database.transaction(cacheStore, 'readonly').objectStore(cacheStore).get(`${companyId}:products`)
      request.onsuccess = () => resolve((request.result as T[] | undefined) ?? [])
      request.onerror = () => reject(request.error)
    })
    database.close()
    return products
  } catch {
    return localFallback<T[]>(`mister-products-cache:${companyId}`, [])
  }
}