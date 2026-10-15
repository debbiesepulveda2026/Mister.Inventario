import { useEffect, useState, type FormEvent } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Calculator, Camera, Check, Package, Sparkles } from 'lucide-react'
import { ModalHeading } from './common'
import { makeId, money, newSku, optimizeProductImage, priceFromMargin, type Product, type Supplier } from '../lib/shared'

type Props = {
  client: SupabaseClient
  companyId: string
  product: Product | null
  online: boolean
  suppliers?: Supplier[]
  onSaved: (product: Product, message: string) => void
  onError: (message: string) => void
}

// Formulario de producto con calculadora de margen integrada.
// Lo usan el panel del dueño y la página de ventas.
export function ProductForm({ client, companyId, product, online, suppliers, onSaved, onError }: Props) {
  const [name, setName] = useState(product?.name ?? '')
  const [sku, setSku] = useState(product?.sku ?? '')
  const [category, setCategory] = useState(product?.category ?? '')
  const [price, setPrice] = useState(product ? String(product.price) : '')
  const [stock, setStock] = useState(product ? String(product.stock) : '')
  const [supplierId, setSupplierId] = useState(product?.supplier_id ?? '')
  const [cost, setCost] = useState('')
  const [margin, setMargin] = useState('30')
  const [image, setImage] = useState<File | null>(null)
  const [preview, setPreview] = useState(product?.image_url ?? '')
  const [busy, setBusy] = useState(false)

  const costNumber = Number(cost)
  const marginNumber = Number(margin)
  const hasCost = cost !== '' && Number.isFinite(costNumber) && costNumber >= 0
  const suggested = hasCost ? priceFromMargin(costNumber, marginNumber) : 0
  const priceNumber = Number(price)
  const realMargin = hasCost && priceNumber > 0 ? ((priceNumber - costNumber) / priceNumber) * 100 : null

  useEffect(() => {
    if (!product || !online) return
    let cancelled = false
    void client.from('product_financials').select('cost_price').eq('company_id', companyId).eq('product_id', product.id).maybeSingle()
      .then(({ data }) => {
        if (cancelled || !data) return
        setCost(String(data.cost_price))
        if (product.price > 0) setMargin(String(Math.round(((product.price - data.cost_price) / product.price) * 1000) / 10))
      })
    return () => { cancelled = true }
  }, [client, companyId, product, online])

  useEffect(() => () => { if (preview.startsWith('blob:')) URL.revokeObjectURL(preview) }, [preview])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (hasCost && (marginNumber < 0 || marginNumber >= 100)) return onError('El margen debe estar entre 0% y 99,9%')
    if (!Number.isFinite(priceNumber) || priceNumber < 0) return onError('Ingresa un precio válido')
    setBusy(true)
    let imageUrl = product?.image_url ?? ''
    if (image) {
      if (!online) { setBusy(false); return onError('Conéctate a internet para guardar una foto del producto') }
      try {
        const blob = await optimizeProductImage(image)
        const path = `${companyId}/${makeId()}.webp`
        const { error } = await client.storage.from('product-images').upload(path, blob, { contentType: 'image/webp' })
        if (error) { setBusy(false); return onError('No se pudo subir la foto. Revisa la migración del bucket de imágenes.') }
        imageUrl = client.storage.from('product-images').getPublicUrl(path).data.publicUrl
      } catch {
        setBusy(false)
        return onError('No se pudo procesar la foto seleccionada')
      }
    }
    const saved: Product = {
      id: product?.id ?? makeId(), name: name.trim(), sku: sku.trim(), category: category.trim(),
      price: Math.round(priceNumber), stock: Math.max(0, Math.round(Number(stock) || 0)), image_url: imageUrl,
      supplier_id: suppliers ? (supplierId || null) : (product?.supplier_id ?? null),
    }
    if (!online) {
      setBusy(false)
      return onSaved(saved, hasCost ? 'Guardado en este dispositivo. El costo se guardará cuando vuelva la conexión y lo edites de nuevo.' : 'Guardado en este dispositivo')
    }
    const { error } = await client.from('products').upsert({ ...saved, company_id: companyId })
    if (error) {
      setBusy(false)
      return onError(error.message.includes('products_company_sku_key') ? 'Ese código SKU ya existe en otro producto' : 'No se pudo guardar el producto. Revisa la conexión y los permisos.')
    }
    if (hasCost) {
      const { error: costError } = await client.from('product_financials').upsert({ company_id: companyId, product_id: saved.id, cost_price: Math.round(costNumber), updated_at: new Date().toISOString() })
      setBusy(false)
      if (costError) return onSaved(saved, 'Producto guardado, pero no se pudo guardar el costo. Ejecuta ventas_migration.sql.')
      return onSaved(saved, 'Producto, costo y precio guardados')
    }
    setBusy(false)
    onSaved(saved, 'Producto guardado')
  }

  return <>
    <ModalHeading icon={Package} title={product ? 'Editar producto' : 'Nuevo producto'} subtitle="Precio, costo y margen en un solo paso."/>
    <form onSubmit={(event) => void submit(event)}>
      <label className="form-label">Nombre del producto<input required value={name} onChange={(event) => setName(event.target.value)} placeholder="Ej. Café molido 250 g"/></label>
      <div className="product-photo-control"><span className="product-photo-preview">{preview ? <img src={preview} alt="Vista previa del producto"/> : <Package size={25}/>}</span><label className="button button-light product-photo-button"><Camera size={15}/>{preview ? 'Cambiar foto' : 'Tomar o elegir foto'}<input className="product-photo-input" type="file" accept="image/*" capture="environment" disabled={!online} onChange={(event) => { const file = event.currentTarget.files?.[0]; if (!file) return; if (file.size > 12 * 1024 * 1024) { onError('La foto debe pesar menos de 12 MB'); return } setImage(file); setPreview(URL.createObjectURL(file)) }}/></label><small>La imagen se optimiza al subirla.</small></div>
      <div className="form-grid">
        <label className="form-label">Código SKU / EAN<div className="input-with-action"><input value={sku} onChange={(event) => setSku(event.target.value)} placeholder="Código de barras"/><button type="button" className="generate-button" onClick={() => setSku(newSku())}><Sparkles size={14}/> Generar</button></div></label>
        <label className="form-label">Categoría<input required value={category} onChange={(event) => setCategory(event.target.value)} placeholder="Despensa"/></label>
        <label className="form-label">Stock<input type="number" min="0" required value={stock} onChange={(event) => setStock(event.target.value)} placeholder="0"/></label>
        {suppliers && <label className="form-label">Proveedor<select value={supplierId} onChange={(event) => setSupplierId(event.target.value)}><option value="">Sin proveedor</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>}
      </div>
      <div className="margin-box">
        <p className="margin-title"><Calculator size={15}/> Calculadora de margen</p>
        <div className="form-grid">
          <label className="form-label">Costo unitario (CLP)<input type="number" min="0" step="1" value={cost} onChange={(event) => setCost(event.target.value)} placeholder="Opcional"/></label>
          <label className="form-label">Margen deseado (%)<input type="number" min="0" max="99.9" step="0.1" value={margin} onChange={(event) => setMargin(event.target.value)}/></label>
        </div>
        {hasCost && <div className="margin-suggest"><span>Precio sugerido <strong>{money(suggested)}</strong> · ganancia {money(Math.max(0, suggested - costNumber))} por unidad</span><button type="button" className="button button-small button-light" onClick={() => setPrice(String(suggested))}>Usar este precio</button></div>}
      </div>
      <label className="form-label">Precio de venta (CLP)<input type="number" min="0" required value={price} onChange={(event) => setPrice(event.target.value)} placeholder="0"/></label>
      {realMargin !== null && <p className={`margin-real ${realMargin < 0 ? 'margin-negative' : ''}`}>Con este precio el margen real es {realMargin.toFixed(1).replace('.', ',')}% {realMargin < 0 ? '· estás vendiendo bajo el costo' : ''}</p>}
      <button className="button button-dark modal-submit" type="submit" disabled={busy}><Check size={16}/> {busy ? 'Guardando…' : 'Guardar producto'}</button>
    </form>
  </>
}
