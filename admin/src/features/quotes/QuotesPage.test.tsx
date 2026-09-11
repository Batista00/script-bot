import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ToastProvider } from "../../components/ui";
import { ApiError } from "../../lib/api/client";
import { customersApi, ordersApi, productsApi, quotesApi } from "../../lib/api/resources";
import type { Order, Quote } from "../../lib/api/types";
import { BusinessProvider } from "../businesses/business-context";
import { QuotesPage } from "./QuotesPage";

const businessId = "30292e18-abfd-43c1-946d-8e18489a39a5";
const now = "2026-01-01T00:00:00.000Z";

const activeQuote: Quote = {
  id: "0112b819-6653-4234-821a-6a2fce393c3f", businessId, customerId: null,
  productId: "499aa88d-a044-4a60-b0c0-e463acfe4ac2", quantity: 2, productName: "Seguidores",
  currency: "CLP", pricingType: "unit", unitPrice: 100, totalPrice: 200,
  status: "active", expiresAt: null, createdAt: now,
};
const convertedQuote: Quote = { ...activeQuote, id: "273676c0-da1f-47d4-a0a7-15624760233b", status: "converted" };

function renderQuotes(quotes: Quote[]) {
  vi.spyOn(quotesApi, "list").mockResolvedValue(quotes);
  vi.spyOn(productsApi, "list").mockResolvedValue([]);
  vi.spyOn(customersApi, "list").mockResolvedValue([]);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  render(
    <QueryClientProvider client={client}><ToastProvider>
      <BusinessProvider business={{ id: businessId, name: "Flowchat DEV", currency: "CLP", status: "active", role: "owner" }}>
        <QuotesPage />
      </BusinessProvider>
    </ToastProvider></QueryClientProvider>,
  );
  return { invalidate };
}

test("converts an active quote through the orders endpoint and refreshes quotes and orders", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const createOrder = vi.spyOn(ordersApi, "create").mockResolvedValue({} as Order);
  const { invalidate } = renderQuotes([activeQuote, convertedQuote]);

  await userEvent.click(await screen.findByRole("button", { name: "Convertir en pedido" }));

  await waitFor(() => expect(createOrder).toHaveBeenCalledWith(businessId, { quoteId: activeQuote.id }));
  await waitFor(() => {
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["quotes", businessId] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["orders", businessId] });
  });
  expect(screen.getAllByRole("button", { name: "Convertir en pedido" })).toHaveLength(1);
});

test("only offers conversion after explicit confirmation", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(false);
  const createOrder = vi.spyOn(ordersApi, "create").mockResolvedValue({} as Order);
  renderQuotes([activeQuote]);

  await userEvent.click(await screen.findByRole("button", { name: "Convertir en pedido" }));
  expect(window.confirm).toHaveBeenCalled();
  expect(createOrder).not.toHaveBeenCalled();
});

test("shows the domain error when the quote can no longer be converted", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  vi.spyOn(ordersApi, "create").mockRejectedValue(
    new ApiError(409, "QUOTE_EXPIRED", "La cotización expiró. Crea una nueva para continuar."),
  );
  renderQuotes([activeQuote]);

  await userEvent.click(await screen.findByRole("button", { name: "Convertir en pedido" }));
  expect(await screen.findByText("La cotización expiró. Crea una nueva para continuar.")).toBeInTheDocument();
});
