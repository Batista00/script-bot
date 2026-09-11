import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";

import { ToastProvider } from "../../components/ui";
import { paymentsApi } from "../../lib/api/resources";
import type { Payment } from "../../lib/api/types";
import { BusinessProvider } from "../businesses/business-context";
import { PAYMENT_STATUS_LABELS, PaymentsPage } from "./PaymentsPage";

const businessId = "30292e18-abfd-43c1-946d-8e18489a39a5";
const now = "2026-01-01T00:00:00.000Z";

function payment(status: string, id: string): Payment {
  return {
    id, businessId, orderId: "499aa88d-a044-4a60-b0c0-e463acfe4ac2", paymentMethodId: null,
    providerKey: "mercado_pago", providerReferenceId: null, providerPaymentId: null,
    status, amount: 1000, currency: "CLP", checkoutUrl: null, expiresAt: null,
    approvedAt: null, createdAt: now, updatedAt: now,
  };
}

function renderPayments(payments: Payment[]) {
  vi.spyOn(paymentsApi, "list").mockResolvedValue(payments);
  const client = new QueryClient({ defaultOptions: {
    queries: { retry: false }, mutations: { retry: false },
  } });
  render(
    <QueryClientProvider client={client}><ToastProvider>
      <BusinessProvider business={{ id: businessId, name: "Flowchat DEV", currency: "CLP", status: "active", role: "owner" }}>
        <PaymentsPage />
      </BusinessProvider>
    </ToastProvider></QueryClientProvider>,
  );
}

test("offers refunded and chargeback as payment filters", async () => {
  renderPayments([]);

  expect(PAYMENT_STATUS_LABELS.refunded).toBe("Reembolsado");
  expect(PAYMENT_STATUS_LABELS.chargeback).toBe("Contracargo");
  expect(await screen.findByRole("option", { name: "Reembolsado" })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: "Contracargo" })).toBeInTheDocument();
});

test("colors refunded and chargeback badges like the rest of the payment states", async () => {
  renderPayments([
    payment("refunded", "0112b819-6653-4234-821a-6a2fce393c3f"),
    payment("chargeback", "273676c0-da1f-47d4-a0a7-15624760233b"),
  ]);

  expect(await screen.findByText("refunded")).toHaveClass("status-refunded");
  expect(screen.getByText("chargeback")).toHaveClass("status-chargeback");
});
