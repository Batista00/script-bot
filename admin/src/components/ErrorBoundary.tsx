import { Component, type ReactNode } from "react";
import { Button } from "./ui";

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { /* No sensitive payloads are logged. */ }
  render() {
    if (this.state.failed) return <main className="centered"><section className="error-page"><h1>No pudimos mostrar esta pantalla</h1><p>Recarga el panel. Si el problema continúa, revisa el estado del backend.</p><Button onClick={() => window.location.reload()}>Recargar</Button></section></main>;
    return this.props.children;
  }
}
