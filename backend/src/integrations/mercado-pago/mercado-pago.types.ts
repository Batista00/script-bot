export interface MercadoPagoBackUrls {
  success: string;
  pending: string;
  failure: string;
}

export interface MercadoPagoPreferenceRequest {
  items: Array<{
    id: string;
    title: string;
    quantity: 1;
    currency_id: "CLP";
    unit_price: number;
  }>;
  external_reference: string;
  notification_url: string;
  back_urls?: MercadoPagoBackUrls;
}

export interface MercadoPagoPreference {
  id: string;
  initPoint: string;
}

export interface MercadoPagoPaymentResource {
  id: string;
  status: string;
  statusDetail: string | null;
  transactionAmount: number;
  currencyId: string;
  externalReference: string | null;
}

export interface MercadoPagoAccount {
  id: string;
}

export interface MercadoPagoHttpClient {
  createPreference(
    accessToken: string,
    input: MercadoPagoPreferenceRequest,
  ): Promise<MercadoPagoPreference>;
  getPayment(accessToken: string, paymentId: string): Promise<MercadoPagoPaymentResource>;
  /** Looks up the payment created for a preference; used to reconcile pending payments. */
  searchPayments?(
    accessToken: string,
    externalReference: string,
  ): Promise<MercadoPagoPaymentResource | null>;
  /** Validates that the access token belongs to an active account. */
  getAccount?(accessToken: string): Promise<MercadoPagoAccount>;
}

/** The provider rejected the credentials (401/403) instead of failing transiently. */
export class MercadoPagoAuthError extends Error {
  constructor() {
    super("Mercado Pago rejected the credentials");
    this.name = "MercadoPagoAuthError";
  }
}

export class MercadoPagoApiError extends Error {
  constructor() {
    super("Mercado Pago API request failed");
    this.name = "MercadoPagoApiError";
  }
}
