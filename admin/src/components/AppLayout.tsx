import {
  Boxes, Building2, ChevronRight, CircleDollarSign, ClipboardList,
  FileText, Gauge, KeyRound, Layers3, Menu, PackageCheck, PlugZap, Receipt,
  Settings, ShoppingBag, Tags, Users, X,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";

import { authApi } from "../lib/api/resources";
import { useAuth } from "../features/auth/auth-context";
import { useBusiness } from "../features/businesses/business-context";
import { BusinessSwitcher } from "./BusinessSwitcher";
import { Button } from "./ui";

type NavEntry = readonly [path: string, label: string, icon: LucideIcon];
const sections: ReadonlyArray<readonly [heading: string, links: readonly NavEntry[]]> = [
  ["", [["dashboard", "Dashboard", Gauge], ["businesses", "Negocios", Building2]]],
  ["Clientes", [["customers", "Clientes", Users]]],
  ["Catálogo", [["categories", "Categorías", Tags], ["products", "Productos", ShoppingBag], ["pricing", "Precios", CircleDollarSign]]],
  ["Ventas", [["quotes", "Cotizaciones", FileText], ["orders", "Pedidos", ClipboardList], ["payments", "Pagos", Receipt]]],
  ["Operaciones", [["fulfillments", "Fulfillments", PackageCheck]]],
  ["Proveedores", [["provider-services", "Servicios de proveedor", Boxes], ["mappings", "Mapeos", Layers3]]],
  ["", [["integrations", "Integraciones", PlugZap], ["api-credentials", "API Credentials", KeyRound], ["settings", "Configuración", Settings]]],
];

export function AppLayout() {
  const { auth, setAuth } = useAuth();
  const business = useBusiness();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const section = location.pathname.split("/").at(-1) || "dashboard";
  const label = sections.flatMap((entry) => entry[1]).find(([path]) => path === section)?.[1] ?? "Panel";
  async function logout() { try { await authApi.logout(); } finally { setAuth(null); navigate("/login", { replace: true }); } }
  return <div className="app-shell">
    <aside className={`sidebar ${open ? "open" : ""}`}>
      <div className="sidebar-brand"><span className="brand-mark">BW</span><div><strong>BOT WHATSAP</strong><small>Administración</small></div><button className="icon-button mobile-only" onClick={() => setOpen(false)} aria-label="Cerrar menú"><X /></button></div>
      <nav>{sections.map(([heading, links], index) => <section key={`${heading}-${index}`}>{heading && <h2>{heading}</h2>}{links.map(([path, text, Icon]) => {
        const target = path === "businesses" ? "/businesses" : `/businesses/${business.id}/${path}`;
        return <NavLink key={path} to={target} onClick={() => setOpen(false)}><Icon size={17} />{text}</NavLink>;
      })}</section>)}</nav>
      <div className="sidebar-user"><div className="avatar">{auth?.user.name.slice(0, 2).toUpperCase()}</div><div><strong>{auth?.user.name}</strong><small>{business.role}</small></div></div>
    </aside>
    {open && <button className="sidebar-scrim" aria-label="Cerrar menú" onClick={() => setOpen(false)} />}
    <div className="app-main">
      <header className="topbar"><button className="icon-button mobile-only" onClick={() => setOpen(true)} aria-label="Abrir menú"><Menu /></button><BusinessSwitcher businesses={auth?.businesses ?? []} current={business} currentSection={section} /><Button className="secondary" onClick={logout}>Cerrar sesión</Button></header>
      <div className="breadcrumb"><span>{business.name}</span><ChevronRight size={14} /><strong>{label}</strong></div>
      <main className="page"><Outlet /></main>
    </div>
  </div>;
}
