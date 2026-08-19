import { apiRequest } from "./client";
import type {
  ApiCredential, ApiCredentialCreated, AuthView, Business, Category, Customer,
  Fulfillment, Integration, Order, Payment, Price, Product, ProductMapping,
  ProviderService, QueryValue, Quote,
} from "./types";

type Params = Record<string, QueryValue>;
const businessPath = (businessId: string, suffix: string) => `/businesses/${businessId}/${suffix}`;

export const authApi = {
  login: (email: string, password: string) => apiRequest<AuthView>("/auth/login", { method: "POST", body: { email, password } }),
  me: () => apiRequest<AuthView>("/auth/me"),
  logout: () => apiRequest<void>("/auth/logout", { method: "POST" }),
};
export const businessesApi = {
  list: () => apiRequest<Business[]>("/businesses"),
  create: (body: { name: string }) => apiRequest<Business>("/businesses", { method: "POST", body }),
  update: (id: string, body: Partial<Pick<Business, "name" | "status">>) => apiRequest<Business>(`/businesses/${id}`, { method: "PATCH", body }),
};

function crud<T>(name: string) {
  return {
    list: (businessId: string, query: Params = {}) => apiRequest<T[]>(businessPath(businessId, name), { query }),
    get: (businessId: string, id: string) => apiRequest<T>(businessPath(businessId, `${name}/${id}`)),
    create: (businessId: string, body: unknown) => apiRequest<T>(businessPath(businessId, name), { method: "POST", body }),
    update: (businessId: string, id: string, body: unknown) => apiRequest<T>(businessPath(businessId, `${name}/${id}`), { method: "PATCH", body }),
  };
}
export const customersApi = crud<Customer>("customers");
export const categoriesApi = crud<Category>("categories");
export const productsApi = crud<Product>("products");

export const pricingApi = {
  list: (businessId: string, productId: string, query: Params = {}) => apiRequest<Price[]>(businessPath(businessId, `products/${productId}/prices`), { query }),
  create: (businessId: string, productId: string, body: unknown) => apiRequest<Price>(businessPath(businessId, `products/${productId}/prices`), { method: "POST", body }),
  update: (businessId: string, productId: string, priceId: string, body: unknown) => apiRequest<Price>(businessPath(businessId, `products/${productId}/prices/${priceId}`), { method: "PATCH", body }),
};
export const quotesApi = {
  list: (businessId: string, query: Params = {}) => apiRequest<Quote[]>(businessPath(businessId, "quotes"), { query }),
  create: (businessId: string, body: unknown) => apiRequest<Quote>(businessPath(businessId, "quotes"), { method: "POST", body }),
  get: (businessId: string, id: string) => apiRequest<Quote>(businessPath(businessId, `quotes/${id}`)),
};
export const ordersApi = {
  list: (businessId: string, query: Params = {}) => apiRequest<Order[]>(businessPath(businessId, "orders"), { query }),
  get: (businessId: string, id: string) => apiRequest<Order>(businessPath(businessId, `orders/${id}`)),
  cancel: (businessId: string, id: string) => apiRequest<Order>(businessPath(businessId, `orders/${id}/cancel`), { method: "POST" }),
};
export const paymentsApi = {
  list: (businessId: string, query: Params = {}) => apiRequest<Payment[]>(businessPath(businessId, "payments"), { query }),
  get: (businessId: string, id: string) => apiRequest<Payment>(businessPath(businessId, `payments/${id}`)),
  byOrder: (businessId: string, orderId: string) => apiRequest<Payment[]>(businessPath(businessId, `orders/${orderId}/payments`)),
};
export const fulfillmentsApi = {
  list: (businessId: string, query: Params = {}) => apiRequest<Fulfillment[]>(businessPath(businessId, "fulfillments"), { query }),
  dispatch: (businessId: string, orderId: string, body: unknown) => apiRequest<Fulfillment>(businessPath(businessId, `orders/${orderId}/fulfillments`), { method: "POST", body }),
  retry: (businessId: string, id: string) => apiRequest<Fulfillment>(businessPath(businessId, `fulfillments/${id}/retry`), { method: "POST" }),
  sync: (businessId: string, id: string) => apiRequest<Fulfillment>(businessPath(businessId, `fulfillments/${id}/sync-status`), { method: "POST" }),
};
export const integrationsApi = {
  list: (businessId: string, query: Params = {}) => apiRequest<Integration[]>(businessPath(businessId, "integrations"), { query }),
  create: (businessId: string, body: unknown) => apiRequest<Integration>(businessPath(businessId, "integrations"), { method: "POST", body }),
  update: (businessId: string, id: string, body: unknown) => apiRequest<Integration>(businessPath(businessId, `integrations/${id}`), { method: "PATCH", body }),
};
export const providerApi = {
  list: (businessId: string, query: Params = {}) => apiRequest<ProviderService[]>(businessPath(businessId, "provider-services"), { query }),
  sync: (businessId: string, integrationId: string) => apiRequest<{ integrationId: string; providerKey: string; received: number; created: number; updated: number; deactivated: number }>(businessPath(businessId, `integrations/${integrationId}/provider-services/sync`), { method: "POST" }),
  mapping: (businessId: string, productId: string) => apiRequest<ProductMapping>(businessPath(businessId, `products/${productId}/provider-mapping`)),
  createMapping: (businessId: string, productId: string, providerServiceId: string) => apiRequest<ProductMapping>(businessPath(businessId, `products/${productId}/provider-mapping`), { method: "POST", body: { providerServiceId } }),
  updateMapping: (businessId: string, productId: string, body: unknown) => apiRequest<ProductMapping>(businessPath(businessId, `products/${productId}/provider-mapping`), { method: "PATCH", body }),
};
export const credentialsApi = {
  list: (businessId: string, query: Params = {}) => apiRequest<ApiCredential[]>(businessPath(businessId, "api-credentials"), { query }),
  create: (businessId: string, name: string) => apiRequest<ApiCredentialCreated>(businessPath(businessId, "api-credentials"), { method: "POST", body: { name } }),
  update: (businessId: string, id: string, body: unknown) => apiRequest<ApiCredential>(businessPath(businessId, `api-credentials/${id}`), { method: "PATCH", body }),
};
