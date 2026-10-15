import { Package, ShoppingBag, Users } from 'lucide-react'

export function Metric({ icon: Icon, label, value, detail }: { icon: typeof Package; label: string; value: string; detail: string }) {
  return <div className="metric-card"><span className="metric-icon"><Icon size={17}/></span><div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div></div>
}

export function ModalHeading({ icon: Icon, title, subtitle }: { icon: typeof Package; title: string; subtitle: string }) {
  return <div className="modal-heading"><span className="modal-icon"><Icon size={20}/></span><div><h2>{title}</h2><p>{subtitle}</p></div></div>
}

export function EmptyTable({ text }: { text: string }) {
  return <div className="table-empty"><Users size={22}/><span>{text}</span></div>
}

export function Brand({ caption = 'INVENTARIO' }: { caption?: string }) {
  return <><span className="brand-mark"><ShoppingBag size={21} strokeWidth={2.5}/></span><span className="brand-copy"><strong>mister<span>.</span></strong><small>{caption}</small></span></>
}

export function AuthArt({ eyebrow, title, text, stats }: { eyebrow: string; title: [string, string]; text: string; stats: [string, string, string] }) {
  return <section className="auth-art"><div className="auth-brand"><Brand/></div><div className="auth-art-copy"><span className="auth-orbit orbit-one"/><span className="auth-orbit orbit-two"/><p className="eyebrow">{eyebrow}</p><h1>{title[0]}<br/>{title[1]}</h1><p>{text}</p><div className="auth-art-stats">{stats.map((stat, index) => <span key={stat}><strong>0{index + 1}</strong><small>{stat}</small></span>)}</div></div><span className="auth-art-foot">MISTER INVENTARIO · GESTIÓN DE NEGOCIOS</span></section>
}
