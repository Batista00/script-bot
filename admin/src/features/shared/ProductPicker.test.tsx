import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { productsApi } from "../../lib/api/resources";
import type { Product } from "../../lib/api/types";
import { BusinessProvider } from "../businesses/business-context";
import { ProductPicker } from "./ProductPicker";

const businessId = "30292e18-abfd-43c1-946d-8e18489a39a5";
const now = "2026-01-01T00:00:00.000Z";

function product(index: number): Product {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    businessId, categoryId: null, name: `Producto ${index}`, description: null,
    type: "service", sku: null, minQuantity: null, maxQuantity: null, status: "active",
    requiredInputs: [], createdAt: now, updatedAt: now,
  };
}

function renderPicker() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onChange = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <BusinessProvider business={{ id: businessId, name: "Flowchat DEV", currency: "CLP", status: "active", role: "owner" }}>
        <ProductPicker value="" onChange={onChange} />
      </BusinessProvider>
    </QueryClientProvider>,
  );
  return { onChange };
}

test("searches products on the server instead of loading the first 100", async () => {
  const list = vi.spyOn(productsApi, "list").mockResolvedValue([product(1)]);
  renderPicker();

  await userEvent.type(screen.getByLabelText("Buscar producto"), "seg");

  await waitFor(() => expect(list).toHaveBeenCalledWith(businessId, expect.objectContaining({
    search: "seg", limit: 25, offset: 0, status: "active",
  })));
});

test("paginates products through the server using offset", async () => {
  const list = vi.spyOn(productsApi, "list")
    .mockResolvedValue(Array.from({ length: 25 }, (_value, index) => product(index + 1)));
  renderPicker();

  await userEvent.click(await screen.findByRole("button", { name: "Siguiente" }));

  await waitFor(() => expect(list).toHaveBeenCalledWith(businessId, expect.objectContaining({
    limit: 25, offset: 25,
  })));
});
