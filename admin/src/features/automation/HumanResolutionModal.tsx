import { type FormEvent } from "react";

import { Button, Modal, SelectField, TextAreaField } from "../../components/ui";
import type { HumanOutcome, SalesAdminSession } from "./sales-automation.types";

interface Props {
  session: SalesAdminSession;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (input: { outcome: HumanOutcome; note: string; resumeBot: boolean }) => void;
}

export function HumanResolutionModal({ session, pending, error, onClose, onSubmit }: Props) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onSubmit({ outcome: String(form.get("outcome")) as HumanOutcome, note: String(form.get("note")), resumeBot: form.has("resumeBot") });
  }

  return <Modal title="Registrar atención humana" onClose={onClose}>
    <p>Cliente <strong>{session.contact}</strong>. Registra qué ocurrió para conservar el seguimiento.</p>
    <form onSubmit={submit}>
      <SelectField label="Resultado" name="outcome" defaultValue="follow_up">
        <option value="sale_completed">Venta finalizada</option><option value="no_sale">Venta no concretada</option>
        <option value="follow_up">Requiere seguimiento</option><option value="other">Otro resultado</option>
      </SelectField>
      <TextAreaField label="Nota de la gestión" name="note" required maxLength={1000} />
      <label className="check-row compact"><input type="checkbox" name="resumeBot" aria-label="Reanudar el bot al guardar" />
        <span><strong>Reanudar el bot al guardar</strong><small>Déjalo desmarcado si la persona seguirá atendiendo por WhatsApp.</small></span></label>
      {error && <div className="alert error">{error}</div>}
      <div className="form-actions"><Button className="secondary" type="button" onClick={onClose}>Cancelar</Button>
        <Button type="submit" disabled={pending}>Guardar resultado</Button></div>
    </form>
  </Modal>;
}
