import { useEffect, useMemo, useState } from 'react'
import { Activity, Download, FileSpreadsheet, MessageCircle, Package, Plus, Settings2, Trash2, Truck } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabase'
import { money, type Supplier } from '../lib/shared'
import { EmptyTable, Metric } from './common'

type ReportSale = { id: string; created_at: string; total: number; payment_method: string; cashier_name: string; customer_id: string | null }

export function SupplierManagement({ suppliers, onCreate, onEdit, onDelete, ownerPhone }: {
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

export function OwnerSalesReport({ companyId }: { companyId: string }) {
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
