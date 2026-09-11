import type { IntegrationsService } from "../../modules/integrations/integrations.service.js";
import {
  type CreateProviderPaymentInput,
  type CreateProviderPaymentResult,
  type FetchProviderPaymentStatusInput,
  type PaymentProvider,
  PaymentProviderCurrencyNotSupportedError,
  PaymentProviderUnavailableError,
  type ProviderPaymentStatus,
} from "../../modules/payments/payments.provider.js";
import {
  mercadoPagoConfig,
  mercadoPagoCredentials,
  mercadoPagoNotificationUrl,
} from "./mercado-pago.settings.js";
import { mapMercadoPagoStatus } from "./mercado-pago.status.js";
import type {
  MercadoPagoHttpClient,
  MercadoPagoPaymentResource,
  MercadoPagoPreferenceRequest,
} from "./mercado-pago.types.js";

export class MercadoPagoPaymentProvider implements PaymentProvider {
  readonly key = "mercado_pago";

  constructor(
    private readonly integrations: Pick<IntegrationsService, "getActiveIntegration">,
    private readonly client: MercadoPagoHttpClient,
    private readonly publicApiBaseUrl: string | undefined,
    private readonly nodeEnv: "development" | "test" | "production",
  ) {}

  async createPayment(input: CreateProviderPaymentInput): Promise<CreateProviderPaymentResult> {
    if (input.currency !== "CLP") {
      throw new PaymentProviderCurrencyNotSupportedError();
    }
    const integration = await this.integrations.getActiveIntegration(input.businessId, this.key);
    if (!integration) throw new PaymentProviderUnavailableError();
    const credentials = mercadoPagoCredentials(integration);
    const config = mercadoPagoConfig(integration);
    const preference: MercadoPagoPreferenceRequest = {
      items: [{
        id: input.paymentId,
        title: `Order ${input.orderId}`,
        quantity: 1,
        currency_id: "CLP",
        unit_price: input.amount,
      }],
      external_reference: input.paymentId,
      notification_url: mercadoPagoNotificationUrl(
        this.publicApiBaseUrl,
        integration.id,
        this.nodeEnv,
      ),
      ...(config.successUrl !== undefined && config.pendingUrl !== undefined &&
        config.failureUrl !== undefined
        ? {
            back_urls: {
              success: config.successUrl,
              pending: config.pendingUrl,
              failure: config.failureUrl,
            },
          }
        : {}),
    };
    const created = await this.client.createPreference(credentials.accessToken, preference);
    return {
      providerReferenceId: created.id,
      status: "pending",
      checkoutUrl: created.initPoint,
    };
  }

  async fetchStatus(input: FetchProviderPaymentStatusInput): Promise<ProviderPaymentStatus | null> {
    const integration = await this.integrations.getActiveIntegration(input.businessId, this.key);
    if (!integration) throw new PaymentProviderUnavailableError();
    const credentials = mercadoPagoCredentials(integration);

    let resource: MercadoPagoPaymentResource | null = null;
    if (input.providerPaymentId !== null) {
      resource = await this.client.getPayment(credentials.accessToken, input.providerPaymentId);
    } else if (this.client.searchPayments) {
      resource = await this.client.searchPayments(credentials.accessToken, input.paymentId);
    }
    if (resource === null) return null;

    const status = mapMercadoPagoStatus(resource.status);
    if (status === null) return null;
    return {
      providerPaymentId: resource.id,
      status,
      amount: resource.transactionAmount,
      currency: resource.currencyId,
    };
  }
}
