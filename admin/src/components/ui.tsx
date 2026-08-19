import { X } from "lucide-react";
import {
  createContext, useContext, useEffect, useRef, useState,
  type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode,
} from "react";

export function Button({ className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={`button ${className}`} {...props} />;
}
export function Field({ label, hint, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return <label className="field"><span>{label}</span><input {...props} />{hint && <small>{hint}</small>}</label>;
}
export function SelectField({ label, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & { label: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span><select {...props}>{children}</select></label>;
}
export function TextAreaField({ label, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string }) {
  return <label className="field"><span>{label}</span><textarea {...props} /></label>;
}
export function Spinner({ label = "Cargando" }: { label?: string }) { return <div className="spinner" role="status"><i />{label}</div>; }
export function StatusBadge({ value }: { value: string }) { return <span className={`status status-${value}`}>{value.replaceAll("_", " ")}</span>; }
export function EmptyState({ title, action }: { title: string; action?: ReactNode }) { return <div className="empty"><p>{title}</p>{action}</div>; }
export function PageHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return <header className="page-header"><div><h1>{title}</h1>{description && <p>{description}</p>}</div>{action}</header>;
}
export function Pagination({ offset, limit, count, onChange }: { offset: number; limit: number; count: number; onChange: (offset: number) => void }) {
  return <nav className="pagination" aria-label="Paginación"><Button className="secondary" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))}>Anterior</Button><span>Registros {count ? offset + 1 : 0}–{offset + count}</span><Button className="secondary" disabled={count < limit} onClick={() => onChange(offset + limit)}>Siguiente</Button></nav>;
}
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeRef.current?.focus(); }, []);
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <header><h2 id="modal-title">{title}</h2><button ref={closeRef} className="icon-button" aria-label="Cerrar" onClick={onClose}><X size={18} /></button></header>
      {children}
    </section>
  </div>;
}

interface ToastState { message: string; kind: "success" | "error" }
const ToastContext = createContext<(message: string, kind?: ToastState["kind"]) => void>(() => undefined);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(null), 4000); return () => window.clearTimeout(timer); }, [toast]);
  return <ToastContext.Provider value={(message, kind = "success") => setToast({ message, kind })}>{children}{toast && <div className={`toast ${toast.kind}`} role="status">{toast.message}</div>}</ToastContext.Provider>;
}
export const useToast = () => useContext(ToastContext);

export function RoleGate({ allowed, role, children, fallback = null }: { allowed: readonly string[]; role: string; children: ReactNode; fallback?: ReactNode }) {
  return allowed.includes(role) ? children : fallback;
}

export function DetailGrid({ record, hidden = [] }: { record: Record<string, unknown>; hidden?: string[] }) {
  return <dl className="detail-grid">{Object.entries(record).filter(([key]) => !hidden.includes(key)).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{typeof value === "object" ? JSON.stringify(value) : String(value ?? "—")}</dd></div>)}</dl>;
}
