import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";

import { Button, Field, Spinner } from "../../components/ui";
import { errorMessage } from "../../lib/api/client";
import { authApi } from "../../lib/api/resources";
import { useAuth } from "./auth-context";

export function LoginPage() {
  const { auth, isLoading, setAuth } = useAuth();
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  if (isLoading) return <div className="centered"><Spinner label="Comprobando sesión" /></div>;
  if (auth) return <Navigate to="/" replace />;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true); setError("");
    const data = new FormData(event.currentTarget);
    try {
      const view = await authApi.login(String(data.get("email")), String(data.get("password")));
      setAuth(view);
      const requested = (location.state as { from?: string } | null)?.from;
      navigate(requested || "/", { replace: true });
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setSubmitting(false); }
  }

  return <main className="login-shell">
    <section className="login-brand">
      <span className="eyebrow">BOT WHATSAP</span>
      <h1>Tu operación comercial, en un solo lugar.</h1>
      <p>Gestiona negocios, ventas, pagos y proveedores con separación estricta por cliente.</p>
    </section>
    <section className="login-card">
      <div><span className="brand-mark">BW</span><h2>Acceso administrativo</h2><p className="muted">Ingresa con tu cuenta humana.</p></div>
      <form onSubmit={submit}>
        <Field label="Correo electrónico" name="email" type="email" autoComplete="email" required />
        <Field label="Contraseña" name="password" type="password" autoComplete="current-password" required />
        {error && <div className="alert error" role="alert">{error}</div>}
        <Button type="submit" disabled={submitting}>{submitting ? "Ingresando…" : "Ingresar"}</Button>
      </form>
      <small>La sesión se protege mediante una cookie HttpOnly del backend.</small>
    </section>
  </main>;
}
