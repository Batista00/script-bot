export type Role = "owner" | "admin" | "operator";
export type Status = "active" | "inactive";

export interface BusinessAccess { id: string; name: string; status: Status; role: Role }
export interface User { id: string; email: string; name: string; status: Status; createdAt: string; updatedAt: string }
export interface AuthView { user: User; businesses: BusinessAccess[] }
export interface Business { id: string; name: string; status: Status; createdAt: string; updatedAt: string }

export interface Customer {
  id: string; businessId: string; name: string | null; phone: string | null;
  email: string | null; status: Status; createdAt: string; updatedAt: string;
}
export interface Category {
  id: string; businessId: string; name: string; status: Status;
  createdAt: string; updatedAt: string;
}
export interface Product {
  id: string; businessId: string; categoryId: string | null; name: string;
  description: string | null; type: "service" | "product"; sku: string | null;
  minQuantity: number | null; maxQuantity: number | null; status: Status;
  createdAt: string; updatedAt: string;
}
export interface Price {
  id: string; businessId: string; productId: string; pricingType: "fixed" | "unit";
  currency: string; fixedPrice: number | null; unitPrice: number | null;
  minQuantity: number | null; maxQuantity: number | null; status: Status;
  createdAt: string; updatedAt: string;
}
export interface Quote {
  id: string; businessId: string; customerId: string | null; productId: string;
  quantity: number; productName: string; currency: string; pricingType: "fixed" | "unit";
  unitPrice: number | null; totalPrice: number; status: string;
  expiresAt: string | null; createdAt: string;
}
export interface OrderItem {
  id: string; productId: string; productName: string; quantity: number;
  pricingType: string; unitPrice: number | null; totalPrice: number;
}
export interface Order {
  id: string; businessId: string; customerId: string; quoteId: string; status: string;
  currency: string; subtotal: number; total: number; createdAt: string; updatedAt: string;
  items: OrderItem[];
}
export interface Payment {
  id: string; businessId: string; orderId: string; providerKey: string;
  providerReferenceId: string | null; providerPaymentId: string | null; status: string;
  amount: number; currency: string; checkoutUrl: string | null; expiresAt: string | null;
  approvedAt: string | null; createdAt: string; updatedAt: string;
}
export interface Fulfillment {
  id: string; businessId: string; orderId: string; orderItemId: string; productId: string;
  integrationId: string; providerServiceId: string; providerKey: string;
  externalServiceId: string; providerServiceType: string | null; quantity: number;
  status: string; providerOrderId: string | null; providerStatusRaw: string | null;
  providerCharge: string | null; providerCurrency: string | null;
  providerRemains: number | null; providerStartCount: number | null;
  submissionAttemptedAt: string | null; submittedAt: string | null;
  lastStatusSyncedAt: string | null; completedAt: string | null;
  createdAt: string; updatedAt: string;
}
export interface Integration {
  id: string; businessId: string; providerKey: string; status: Status;
  config: Record<string, unknown>; createdAt: string; updatedAt: string;
}
export interface ProviderService {
  id: string; businessId: string; integrationId: string; providerKey: string;
  externalServiceId: string; name: string; category: string | null;
  serviceType: string | null; rate: string | null; rateCurrency: string | null;
  minQuantity: number | null; maxQuantity: number | null;
  providerStatus: Status; lastSyncedAt: string; createdAt: string; updatedAt: string;
}
export interface ProductMapping {
  id: string; businessId: string; productId: string; providerServiceId: string;
  status: Status; createdAt: string; updatedAt: string;
}
export interface ApiCredential {
  id: string; businessId: string; name: string; prefix: string; status: Status;
  createdAt: string; updatedAt: string;
}
export interface ApiCredentialCreated { credential: ApiCredential; token: string }

export type QueryValue = string | number | null | undefined;
