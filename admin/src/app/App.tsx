import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";

import { AppLayout } from "../components/AppLayout";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { ToastProvider } from "../components/ui";
import { ApiCredentialsPage } from "../features/api-credentials/ApiCredentialsPage";
import { AuthProvider } from "../features/auth/auth-context";
import { LoginPage } from "../features/auth/LoginPage";
import { BusinessesPage } from "../features/businesses/BusinessesPage";
import { BusinessSettingsPage } from "../features/businesses/BusinessSettingsPage";
import { CategoriesPage } from "../features/catalog/CategoriesPage";
import { ProductsPage } from "../features/catalog/ProductsPage";
import { CustomersPage } from "../features/customers/CustomersPage";
import { DashboardPage } from "../features/dashboard/DashboardPage";
import { FulfillmentsPage } from "../features/fulfillments/FulfillmentsPage";
import { IntegrationsPage } from "../features/integrations/IntegrationsPage";
import { OrdersPage } from "../features/orders/OrdersPage";
import { PaymentsPage } from "../features/payments/PaymentsPage";
import { PricingPage } from "../features/pricing/PricingPage";
import { MappingsPage } from "../features/providers/MappingsPage";
import { ProviderServicesPage } from "../features/providers/ProviderServicesPage";
import { QuotesPage } from "../features/quotes/QuotesPage";
import { HomeRedirect, RequireAuth, RequireBusiness } from "../routes/guards";
import { NotFoundPage } from "../routes/NotFoundPage";
import { queryClient } from "./query-client";

export function App() {
  return <ErrorBoundary><QueryClientProvider client={queryClient}><ToastProvider><BrowserRouter><AuthProvider><Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route element={<RequireAuth />}>
      <Route index element={<HomeRedirect />} />
      <Route path="businesses" element={<BusinessesPage />} />
      <Route path="businesses/:businessId" element={<RequireBusiness />}>
        <Route element={<AppLayout />}>
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="customers" element={<CustomersPage />} />
          <Route path="categories" element={<CategoriesPage />} />
          <Route path="products" element={<ProductsPage />} />
          <Route path="pricing" element={<PricingPage />} />
          <Route path="quotes" element={<QuotesPage />} />
          <Route path="orders" element={<OrdersPage />} />
          <Route path="payments" element={<PaymentsPage />} />
          <Route path="fulfillments" element={<FulfillmentsPage />} />
          <Route path="provider-services" element={<ProviderServicesPage />} />
          <Route path="mappings" element={<MappingsPage />} />
          <Route path="integrations" element={<IntegrationsPage />} />
          <Route path="api-credentials" element={<ApiCredentialsPage />} />
          <Route path="settings" element={<BusinessSettingsPage />} />
          <Route index element={<HomeRedirect />} />
        </Route>
      </Route>
    </Route>
    <Route path="*" element={<NotFoundPage />} />
  </Routes></AuthProvider></BrowserRouter></ToastProvider></QueryClientProvider></ErrorBoundary>;
}
