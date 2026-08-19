import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { BusinessSwitcher } from "./BusinessSwitcher";

const a = { id: "business-a", name: "Cliente A", status: "active", role: "owner" } as const;
const b = { id: "business-b", name: "Cliente B", status: "active", role: "admin" } as const;
function Location() { return <span data-testid="location">{useLocation().pathname}</span>; }

test("switches the explicit URL and removes only the previous business cache", async () => {
  const client = new QueryClient(); client.setQueryData(["products", a.id], ["A product"]); client.setQueryData(["products", b.id], ["B product"]); client.setQueryData(["auth", "me"], { user: true });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/businesses/${a.id}/products`]}><BusinessSwitcher businesses={[a, b]} current={a} currentSection="products" /><Routes><Route path="*" element={<Location />} /></Routes></MemoryRouter></QueryClientProvider>);
  await userEvent.selectOptions(screen.getByLabelText("Negocio actual"), b.id);
  expect(screen.getByTestId("location")).toHaveTextContent(`/businesses/${b.id}/products`);
  expect(client.getQueryData(["products", a.id])).toBeUndefined();
  expect(client.getQueryData(["products", b.id])).toEqual(["B product"]);
  expect(client.getQueryData(["auth", "me"])).toEqual({ user: true });
});
