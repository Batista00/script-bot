export type Role = "owner" | "admin" | "operator";
export type Status = "active" | "inactive";

export interface BusinessAccess { id: string; name: string; currency: string; status: Status; role: Role }
export interface User { id: string; email: string; name: string; status: Status; createdAt: string; updatedAt: string }
export interface AuthView { user: User; businesses: BusinessAccess[] }
export interface Business { id: string; name: string; currency: string; status: Status; createdAt: string; updatedAt: string }

export interface Customer {
  id: string; businessId: string; name: string | null; phone: string | null;
  email: string | null; status: Status; createdAt: string; updatedAt: string;
}
export interface Category {
  parentId?: string | null;
  id: string; businessId: string; name: string; status: Status;
  createdAt: string; updatedAt: string;
}
export interface Product {
  deliveryConfig?: ProductDelivery | null;
  id: string; businessId: string; categoryId: string | null; name: string;
  description: string | null; type: "service" | "product"; sku: string | null;
  minQuantity: number | null; maxQuantity: number | null; status: Status;
  requiredInputs: ProductInputField[];
  createdAt: string; updatedAt: string;
}
export type ProductInputType = "url" | "text" | "textarea" | "integer" | "date";
export interface ProductDelivery {
  digitalContents?: "downloads" | "licenses" | "both";
  kind: "service" | "digital" | "physical";
  methods: Array<"service" | "digital" | "shipping" | "pickup">;
  processing: "manual" | "automatic";
  instructions: string;
  shipping?: {mode:"fixed";fee:number} | {mode:"zones";zones:Array<{name:string;fee:number}>} | {mode:"quote"};
  pickupAddress?: string;
}
export interface PhysicalDelivery {method:"shipping"|"pickup";address:string;zone:string|null;fee:number;instructions:string}
export interface ProductInputField {
  key: string; label: string; helpText: string | null; type: ProductInputType;
  required: boolean; position: number;
  validation: { minLength?: number; maxLength?: number; minimum?: number; maximum?: number };
}
export interface ProviderOrderField { key: string; providerField: string; type: ProductInputType }
export interface ProviderOrderCapabilities {
  supported: boolean; required: ProviderOrderField[]; optional: ProviderOrderField[];
  source?: "official" | "unverified"; unsupportedReason?: string;
}
export interface Price {
  id: string; businessId: string; productId: string; pricingType: "fixed" | "unit";
  currency: string; fixedPrice: number | null; unitPrice: number | null;
  minQuantity: number | null; maxQuantity: number | null; status: Status;
  createdAt: string; updatedAt: string;
}
export interface Quote {
  items?:Array<Omit<OrderItem,"id">>;
  delivery?: PhysicalDelivery | null;
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
  delivery?: PhysicalDelivery | null;
  id: string; businessId: string; customerId: string; quoteId: string; status: string;
  currency: string; subtotal: number; total: number; createdAt: string; updatedAt: string;
  items: OrderItem[];
}
export interface Payment {
  id: string; businessId: string; orderId: string; paymentMethodId: string | null; providerKey: string;
  providerReferenceId: string | null; providerPaymentId: string | null; status: string;
  amount: number; currency: string; checkoutUrl: string | null; expiresAt: string | null;
  approvedAt: string | null; createdAt: string; updatedAt: string;
}
export interface PaymentMethod {
  id: string; businessId: string; type: "mercado_pago" | "bank_transfer";
  name: string; status: Status; config: Record<string, unknown>;
  createdAt: string; updatedAt: string;
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
  providerDescription: string | null; orderCapabilities: ProviderOrderCapabilities;
  mappingCount: number;
  metadata: Record<string, unknown>;
  supportsRefill: boolean | null; supportsCancel: boolean | null;
  providerStatus: Status; lastSyncedAt: string; createdAt: string; updatedAt: string;
}
export interface ProviderConnectionTestResult {
  integrationId: string; providerKey: string; connectionStatus: "ok";
  balance: string | null; currency: string | null; checkedAt: string;
}
export interface PaymentProviderConnectionTestResult {
  integrationId: string; providerKey: string; connectionStatus: "ok"; checkedAt: string;
}
export interface ProductMapping {
  id: string; businessId: string; productId: string; providerServiceId: string;
  status: Status; createdAt: string; updatedAt: string;
}
export interface ImportProviderProductInput {
  deliveryConfig?: ProductDelivery | null;
  providerServiceId: string; name: string; description: string | null;
  categoryId: string | null; sku: string | null; type: "service" | "product";
  minQuantity: number | null; maxQuantity: number | null; currency: string;
  pricingType: "fixed" | "unit"; retailPrice: number; status: Status;
  requiredInputs?: ProductInputField[];
}
export interface ImportedProviderProduct {
  product: Product; price: Price; mapping: ProductMapping;
}
export interface ProviderCatalogSyncResult {
  integrationId: string; providerKey: string; received: number; normalized: number;
  rejected: number; rejectionReasons: Record<string, number>; created: number;
  updated: number; reactivated: number; deactivated: number;
}
export interface ProviderCatalogState {
  businessId: string; integrationId: string; connectionStatus: "unknown" | "ok" | "error";
  providerBalance: string | null; providerCurrency: string | null;
  servicesReceived: number; servicesNormalized: number; servicesRejected: number;
  rejectionReasons: Record<string, number>; lastSyncAt: string | null;
  lastBalanceAt: string | null; lastErrorCode: string | null; updatedAt: string;
}
export interface ApiCredential {
  id: string; businessId: string; name: string; prefix: string; status: Status;
  createdAt: string; updatedAt: string;
}
export interface ApiCredentialCreated { credential: ApiCredential; token: string }

export interface MembershipUser { id: string; email: string; name: string; status: Status }
export interface Membership {
  id: string; businessId: string; userId: string; role: Role; status: Status;
  createdAt: string; updatedAt: string; user: MembershipUser;
}
export interface CreateMembershipInput {
  email: string; role: Role; name?: string | null; password?: string | null;
}
export interface UpdateMembershipInput { role?: Role; status?: Status }
export interface CreateOrderInput { quoteId: string; customerId?: string | null }

export const JOB_STATUSES = ["pending", "running", "completed", "failed", "cancelled"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
export interface Job {
  jobId: string; jobType: string; status: JobStatus; attempts: number;
  maxAttempts: number; runAt: string; lastError: string | null;
  createdAt: string; updatedAt: string;
}

export type QueryValue = string | number | null | undefined;
