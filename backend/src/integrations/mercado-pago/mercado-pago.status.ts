import type { PaymentStatus } from "../../modules/payments/payments.types.js";

/**
 * Maps a Mercado Pago payment status to the platform vocabulary. `null` means
 * the external status is unknown and must not invent a local transition.
 */
export function mapMercadoPagoStatus(status: string): PaymentStatus | null {
  switch (status) {
    case "approved": return "approved";
    case "pending":
    case "in_process":
    case "authorized": return "pending";
    case "rejected": return "rejected";
    case "cancelled": return "cancelled";
    case "refunded": return "refunded";
    case "charged_back": return "chargeback";
    case "expired": return "expired";
    default: return null;
  }
}
