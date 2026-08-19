import { AppError } from "../../core/errors/app-error.js";
import type { IntegrationsService } from "../../modules/integrations/integrations.service.js";
import type { PaymentsService } from "../../modules/payments/payments.service.js";
import type { PaymentStatus } from "../../modules/payments/payments.types.js";
import { mercadoPagoCredentials } from "./mercado-pago.settings.js";
import { verifyMercadoPagoSignature } from "./mercado-pago.signature.js";
import {
  type MercadoPagoHttpClient,
  MercadoPagoApiError,
  type MercadoPagoPaymentResource,
} from "./mercado-pago.types.js";

const mercadoPagoProviderKey = "mercado_pago";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface MercadoPagoWebhookInput {
  integrationId: string;
  type: string;
  dataId: string;
  xSignature?: string;
  xRequestId?: string;
}

export interface MercadoPagoWebhookResult {
  processed: boolean;
}

type SafeWarning = (details: {
  providerPaymentId: string;
  providerStatus: string;
  statusDetail: string | null;
}) => void;

function mapStatus(status: string): PaymentStatus | null {
  switch (status) {
    case "approved": return "approved";
    case "pending":
    case "in_process":
    case "authorized": return "pending";
    case "rejected": return "rejected";
    case "cancelled": return "cancelled";
    default: return null;
  }
}

function validateFinancialResource(resource: MercadoPagoPaymentResource): void {
  if (!Number.isSafeInteger(resource.transactionAmount) || resource.transactionAmount <= 0) {
    throw new AppError("Payment amount does not match", 409, "PAYMENT_AMOUNT_MISMATCH");
  }
}

export class MercadoPagoWebhookService {
  constructor(
    private readonly integrations: Pick<IntegrationsService, "getActiveIntegrationById">,
    private readonly payments: Pick<PaymentsService, "applyVerifiedProviderUpdate">,
    private readonly client: MercadoPagoHttpClient,
    private readonly warnUnsupportedStatus: SafeWarning = () => undefined,
  ) {}

  async process(input: MercadoPagoWebhookInput): Promise<MercadoPagoWebhookResult> {
    const integration = await this.integrations.getActiveIntegrationById(
      input.integrationId,
      mercadoPagoProviderKey,
    );
    if (!integration) {
      throw new AppError("Integration not found", 404, "INTEGRATION_NOT_FOUND");
    }
    let credentials: ReturnType<typeof mercadoPagoCredentials>;
    try {
      credentials = mercadoPagoCredentials(integration);
    } catch {
      throw new AppError(
        "Payment provider not available",
        503,
        "PAYMENT_PROVIDER_NOT_AVAILABLE",
      );
    }
    if (!verifyMercadoPagoSignature({
      ...(input.xSignature === undefined ? {} : { xSignature: input.xSignature }),
      ...(input.xRequestId === undefined ? {} : { xRequestId: input.xRequestId }),
      dataId: input.dataId,
      secret: credentials.webhookSecret,
    })) {
      throw new AppError("Invalid webhook signature", 401, "INVALID_WEBHOOK_SIGNATURE");
    }
    if (input.type !== "payment") return { processed: false };

    let resource: MercadoPagoPaymentResource;
    try {
      resource = await this.client.getPayment(credentials.accessToken, input.dataId);
    } catch (error) {
      if (!(error instanceof MercadoPagoApiError)) throw error;
      throw new AppError(
        "Payment provider is temporarily unavailable",
        503,
        "PAYMENT_PROVIDER_TEMPORARILY_UNAVAILABLE",
      );
    }
    if (resource.id !== input.dataId) {
      throw new AppError("Provider payment does not match", 409, "PAYMENT_PROVIDER_MISMATCH");
    }
    const status = mapStatus(resource.status);
    if (status === null) {
      this.warnUnsupportedStatus({
        providerPaymentId: resource.id,
        providerStatus: resource.status,
        statusDetail: resource.statusDetail,
      });
      return { processed: false };
    }
    if (
      resource.externalReference === null ||
      !uuidPattern.test(resource.externalReference)
    ) {
      throw new AppError("Payment not found", 404, "PAYMENT_NOT_FOUND");
    }
    validateFinancialResource(resource);
    await this.payments.applyVerifiedProviderUpdate({
      businessId: integration.businessId,
      paymentId: resource.externalReference,
      providerKey: mercadoPagoProviderKey,
      providerPaymentId: resource.id,
      status,
      amount: resource.transactionAmount,
      currency: resource.currencyId,
    });
    return { processed: true };
  }
}
