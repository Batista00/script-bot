import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ToastProvider } from "../../components/ui";
import { BusinessProvider } from "../businesses/business-context";
import { EntityPage } from "./EntityPage";

const businessId = "30292e18-abfd-43c1-946d-8e18489a39a5";
const product = { id: "0112b819-6653-4234-821a-6a2fce393c3f", name: "Disposable", status: "active" };

test("confirmed product deletion invalidates its Business-scoped list", async () => {
  const remove = vi.fn().mockResolvedValue(undefined);
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  render(
    <QueryClientProvider client={client}><ToastProvider>
      <BusinessProvider business={{ id: businessId, name: "Flowchat DEV", currency: "CLP", status: "active", role: "owner" }}>
        <EntityPage
          resource="products" title="Productos" description="Test" empty="Vacío"
          list={async () => [product]} create={async () => product} update={async () => product}
          remove={remove} fields={[]} columns={[{ label: "Nombre", value: (item) => item.name }]}
        />
      </BusinessProvider>
    </ToastProvider></QueryClientProvider>,
  );

  await userEvent.click(await screen.findByRole("button", { name: "Eliminar" }));
  expect(window.confirm).toHaveBeenCalled();
  await waitFor(() => expect(remove).toHaveBeenCalledWith(businessId, product.id));
  await waitFor(() => expect(invalidate).toHaveBeenCalledWith({
    queryKey: ["products", businessId],
  }));
});
