import { Link } from "react-router-dom";
export function NotFoundPage() { return <main className="centered"><section className="error-page"><span className="eyebrow">404</span><h1>Página no encontrada</h1><p>La ruta solicitada no pertenece al panel.</p><Link className="button link-button" to="/">Volver al inicio</Link></section></main>; }
