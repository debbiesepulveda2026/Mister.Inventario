import type { PendingSale } from './offline'

export type Product = { id: string; name: string; sku: string; category: string; price: number; stock: number; image_url?: string; supplier_id?: string | null }
export type Supplier = { id: string; name: string; rut: string; phone: string; whatsapp: string; email: string; address: string; notes: string; active: boolean }
export type Customer = { id: string; name: string; rut: string; phone: string; credit_limit: number; balance: number }
export type Employee = { id: string; name: string; rut: string; active: boolean; pin_set?: boolean }
export type Sale = PendingSale & { synced?: boolean }
export type MemberRole = 'owner' | 'admin' | 'cashier'
export type OpenCash = { id: string; openedAt: string; openingAmount: number; cashier: string }
export type CompanyProfile = { rut: string; legal_name: string; business: string; address: string; order_whatsapp: string; dte_endpoint: string; default_credit_limit: number }
export type BarcodeScanner = new (options: { formats: string[] }) => { detect: (source: HTMLVideoElement) => Promise<{ rawValue: string }[]> }

export const emptyCompany: CompanyProfile = { rut: '', legal_name: '', business: '', address: '', order_whatsapp: '', dte_endpoint: '', default_credit_limit: 30000 }
export const money = (value: number) => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(value)
export const shortDate = new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: 'short' })
export const makeId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
export const newSku = () => `MI${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 90 + 10)}`
export const paymentLabel = (method: string) => method === 'cash' ? 'Efectivo' : method === 'card' ? 'Tarjeta' : method === 'credit' ? 'Fiado' : method
export const priceFromMargin = (cost: number, margin: number) => cost >= 0 && margin >= 0 && margin < 100 ? Math.round(cost / (1 - margin / 100)) : 0
export const initials = (name: string) => name.split(' ').map((part) => part[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()

export function whatsappDigits(value: string) {
  const digits = value.replace(/\D/g, '')
  return digits.length === 9 && digits.startsWith('9') ? `56${digits}` : digits
}

export function authErrorText(message: string) {
  const normalized = message.toLowerCase()
  if (normalized.includes('invalid api key')) return 'Supabase rechazó la clave API. Copia la clave anon/publicable correcta desde Project Settings → API Keys y actualiza src/lib/config.ts.'
  if (normalized.includes('invalid login credentials')) return 'Correo o clave incorrectos. Si no recuerdas tu clave, usa “¿Olvidaste tu clave?”.'
  if (normalized.includes('already registered') || normalized.includes('already exists')) return 'Ese correo ya tiene una cuenta. Inicia sesión o recupera tu clave.'
  if (normalized.includes('email not confirmed')) return 'Confirma tu correo desde el enlace que envió Supabase y vuelve a iniciar sesión.'
  if (normalized.includes('anonymous sign-ins are disabled')) return 'Falta activar “Allow anonymous sign-ins” en Supabase → Authentication → Sign In / Providers.'
  if (normalized.includes('rate limit') || normalized.includes('security purposes')) return 'Demasiados intentos seguidos. Espera un minuto y vuelve a probar.'
  if (normalized.includes('same as the old') || normalized.includes('different from the old')) return 'La clave nueva debe ser distinta de la anterior.'
  if (normalized.includes('database error') || normalized.includes('trigger') || normalized.includes('company')) return 'No se pudo crear el almacén. Revisa que estén ejecutados los SQL de la carpeta supabase/.'
  return message
}

export async function optimizeProductImage(file: File): Promise<Blob> {
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

// Agrega el motivo técnico que entrega Supabase, para poder diagnosticar.
export const errorDetail = (error?: { message?: string; code?: string } | null) =>
  error?.message ? ` Detalle: ${error.message}${error.code ? ` (${error.code})` : ''}` : ''
