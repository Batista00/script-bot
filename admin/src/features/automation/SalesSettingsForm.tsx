import { type FormEvent } from "react";

import { Button, Field, TextAreaField } from "../../components/ui";
import type { SalesSettings } from "./sales-automation.types";

interface Props {
  formKey: string;
  settings: SalesSettings;
  pending: boolean;
  onSubmit: (settings: SalesSettings) => void;
}

export function SalesSettingsForm({ formKey, settings, pending, onSubmit }: Props) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onSubmit({
      enabled: form.has("enabled"), autoDispatch: form.has("autoDispatch"),
      displayName: String(form.get("displayName")), welcome: String(form.get("welcome")),
      policies: String(form.get("policies")), humanContact: String(form.get("humanContact")),
      telegramChatId: String(form.get("telegramChatId")),
      evidenceRetentionDays: Number(form.get("evidenceRetentionDays")),
    });
  }

  return <section className="form-card automation-card"><form key={formKey} onSubmit={submit}>
    <h2>Operación del canal</h2>
    <p className="muted">Controla la recepción, la revisión humana y el despacho del negocio seleccionado.</p>
    <label className="check-row"><input type="checkbox" name="enabled" aria-label="Recibir ventas por WhatsApp" defaultChecked={settings.enabled} />
      <span><strong>Recibir ventas por WhatsApp</strong><small>Permite que los flujos procesen mensajes para este negocio.</small></span></label>
    <label className="check-row"><input type="checkbox" name="autoDispatch" aria-label="Despachar automáticamente después del pago" defaultChecked={settings.autoDispatch} />
      <span><strong>Despachar automáticamente después del pago</strong><small>Puede consumir saldo real del proveedor. El pago debe estar confirmado primero.</small></span></label>
    <Field label="Chat de Telegram para alertas" name="telegramChatId" defaultValue={settings.telegramChatId}
      hint="Es el Chat ID que recibirá solicitudes de atención y revisión de transferencias." />
    <Field label="Mensaje al derivar a una persona" name="humanContact" defaultValue={settings.humanContact} maxLength={500}
      hint="Ejemplo: Un ejecutivo continuará atendiéndote en este mismo chat." />
    <Field label="Conservar comprobantes (días)" type="number" name="evidenceRetentionDays" min={2} max={90}
      defaultValue={settings.evidenceRetentionDays} />
    <details className="advanced-settings"><summary>Respuestas de respaldo del backend</summary>
      <div className="alert">El prompt principal y el estilo conversacional se administran en Typebot. Estos textos se usan como respaldo seguro y para reglas controladas por el backend.</div>
      <Field label="Identidad comercial de respaldo" name="displayName" defaultValue={settings.displayName} required maxLength={120} />
      <TextAreaField label="Bienvenida de respaldo" name="welcome" defaultValue={settings.welcome} required maxLength={500} />
      <TextAreaField label="Políticas autorizadas del negocio" name="policies" defaultValue={settings.policies} maxLength={8000} />
    </details>
    <Button type="submit" disabled={pending}>Guardar configuración</Button>
  </form></section>;
}
