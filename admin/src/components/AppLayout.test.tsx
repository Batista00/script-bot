import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import type { BusinessAccess } from "../lib/api/types";
import { AuthProvider, authQueryKey } from "../features/auth/auth-context";
import { BusinessProvider } from "../features/businesses/business-context";
import { AppLayout } from "./AppLayout";

const businessId = "30292e18-abfd-43c1-946d-8e18489a39a5";
const now = "2026-01-01T00:00:00.000Z";

function renderLayout(status: BusinessAccess["status"]) {
  const business: BusinessAccess = { id: businessId, name: "Flowchat DEV", currency: "CLP", status, role: "owner" };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(authQueryKey, {
    user: { id: "user-ana", email: "ana@example.com", name: "Ana", status: "active", createdAt: now, updatedAt: now },
    businesses: [business],
  });
  render(
    <QueryClientProvider client={client}><AuthProvider>
      <BusinessProvider business={business}>
        <MemoryRouter initialEntries={[`/businesses/${businessId}/dashboard`]}>
          <Routes><Route element={<AppLayout />}><Route path="/businesses/:businessId/dashboard" element={<p>contenido</p>} /></Route></Routes>
        </MemoryRouter>
      </BusinessProvider>
    </AuthProvider></QueryClientProvider>,
  );
}

test("warns that commercial operations are blocked for an inactive business", () => {
  renderLayout("inactive");
  expect(screen.getByRole("status")).toHaveTextContent(/operaciones comerciales están bloqueadas/i);
  expect(screen.getByText("contenido")).toBeInTheDocument();
});

test("does not warn for an active business", () => {
  renderLayout("active");
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(screen.getByText("contenido")).toBeInTheDocument();
});
