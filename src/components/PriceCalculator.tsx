import { useEffect, useState, type FormEvent } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Calculator, X } from 'lucide-react'
import { money, type Product } from '../lib/shared'

export function ProductPriceCalculator({ client, visible, canSaveCost, companyId, products, onSaved }: {
  client: SupabaseClient
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
    void client.from('product_financials').select('cost_price').eq('company_id', companyId).eq('product_id', productId).maybeSingle()
      .then(({ data, error: queryError }) => {
        if (cancelled) return
        if (queryError) setError('No se pudo cargar el costo. Verifica que esté instalada la migración de costos.')
        else if (data) setCostPrice(String(data.cost_price))
      })
    return () => { cancelled = true }
  }, [client, open, productId, companyId, canSaveCost])

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
      ? await client.rpc('save_product_price', { target_product: selectedProduct.id, new_cost: Math.round(cost), target_margin: margin })
      : await client.from('products').update({ price: finalPrice }).eq('id', selectedProduct.id).eq('company_id', companyId).select('price').single()
    setBusy(false)
    if (result.error) {
      setError(canSaveCost ? 'No se pudo guardar el costo y precio. Revisa la conexión y que esté ejecutado ventas_migration.sql.' : 'No se pudo actualizar el precio. Verifica tu conexión y el permiso de catálogo.')
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
