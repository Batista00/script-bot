import { AppError } from "../../core/errors/app-error.js";
import type { JsonObject } from "../integrations/integrations.types.js";
import {
  type CreatePaymentMethodInput,
  type PaymentMethod,
  PaymentMethodConflictError,
  PaymentMethodHistoryConflictError,
  type PaymentMethodPersistenceInput,
  type PaymentMethodsRepository,
  paymentMethodStatuses,
  paymentMethodTypes,
  type UpdatePaymentMethodInput,
} from "./payment-methods.types.js";

const accountTypes = ["checking", "sight", "savings"] as const;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function text(value: unknown, field: string, maximum: number): string {
  if (typeof value !== "string") throw invalidConfig(field);
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maximum) throw invalidConfig(field);
  return normalized;
}
function invalidConfig(field: string): AppError {
  return new AppError(`Invalid bank transfer ${field}`, 400, "INVALID_PAYMENT_METHOD_CONFIG");
}
function normalizeName(value: string): string {
  const name = value.trim();
  if (name.length === 0 || name.length > 120) {
    throw new AppError("Invalid payment method name", 400, "INVALID_PAYMENT_METHOD_NAME");
  }
  return name;
}
function normalizeConfig(type: string, value: JsonObject | undefined): JsonObject {
  const config = value ?? {};
  if (type === "mercado_pago") {
    if (Object.keys(config).length > 0) throw invalidConfig("config");
    return {};
  }
  const allowed = new Set([
    "accountHolder", "rut", "bankName", "accountType", "accountNumber", "email",
  ]);
  if (Object.keys(config).some((key) => !allowed.has(key))) throw invalidConfig("field");
  const accountType = config.accountType;
  if (typeof accountType !== "string" || !accountTypes.includes(accountType as never)) {
    throw invalidConfig("accountType");
  }
  const rut = text(config.rut, "rut", 16).toUpperCase().replaceAll(".", "");
  if (!/^\d{7,8}-[\dK]$/.test(rut)) throw invalidConfig("rut");
  const email = config.email === undefined || config.email === null || config.email === ""
    ? undefined : text(config.email, "email", 254).toLowerCase();
  if (email !== undefined && !emailPattern.test(email)) throw invalidConfig("email");
  return {
    accountHolder: text(config.accountHolder, "accountHolder", 160),
    rut,
    bankName: text(config.bankName, "bankName", 120),
    accountType,
    accountNumber: text(config.accountNumber, "accountNumber", 64),
    ...(email === undefined ? {} : { email }),
  };
}
function conflict(): AppError {
  return new AppError("Payment method already exists", 409, "PAYMENT_METHOD_CONFLICT");
}

export class PaymentMethodsService {
  constructor(private readonly repository: PaymentMethodsRepository) {}

  async create(businessId: string, input: CreatePaymentMethodInput): Promise<PaymentMethod> {
    if (!paymentMethodTypes.includes(input.type)) {
      throw new AppError("Invalid payment method type", 400, "INVALID_PAYMENT_METHOD_TYPE");
    }
    try {
      return await this.repository.create(businessId, {
        type: input.type, name: normalizeName(input.name), status: "active",
        config: normalizeConfig(input.type, input.config),
      });
    } catch (error) {
      if (error instanceof PaymentMethodConflictError) throw conflict();
      throw error;
    }
  }

  list(businessId: string, status?: "active" | "inactive"): Promise<PaymentMethod[]> {
    if (status !== undefined && !paymentMethodStatuses.includes(status)) {
      throw new AppError("Invalid payment method status", 400, "INVALID_PAYMENT_METHOD_STATUS");
    }
    return this.repository.list(businessId, status);
  }

  async getActiveById(businessId: string, paymentMethodId: string): Promise<PaymentMethod> {
    const method = await this.repository.findById(businessId, paymentMethodId);
    if (!method || method.status !== "active") {
      throw new AppError("Payment method not found", 404, "PAYMENT_METHOD_NOT_FOUND");
    }
    return method;
  }

  async update(
    businessId: string,
    paymentMethodId: string,
    input: UpdatePaymentMethodInput,
  ): Promise<PaymentMethod> {
    const current = await this.repository.findById(businessId, paymentMethodId);
    if (!current) throw new AppError("Payment method not found", 404, "PAYMENT_METHOD_NOT_FOUND");
    if (input.status !== undefined && !paymentMethodStatuses.includes(input.status)) {
      throw new AppError("Invalid payment method status", 400, "INVALID_PAYMENT_METHOD_STATUS");
    }
    const values: PaymentMethodPersistenceInput = {
      type: current.type,
      name: input.name === undefined ? current.name : normalizeName(input.name),
      status: input.status ?? current.status,
      config: input.config === undefined
        ? current.config : normalizeConfig(current.type, input.config),
    };
    try {
      const method = await this.repository.update(businessId, paymentMethodId, values);
      if (!method) throw new AppError("Payment method not found", 404, "PAYMENT_METHOD_NOT_FOUND");
      return method;
    } catch (error) {
      if (error instanceof PaymentMethodConflictError) throw conflict();
      throw error;
    }
  }

  async delete(businessId: string, paymentMethodId: string): Promise<void> {
    try {
      if (!await this.repository.delete(businessId, paymentMethodId)) {
        throw new AppError("Payment method not found", 404, "PAYMENT_METHOD_NOT_FOUND");
      }
    } catch (error) {
      if (error instanceof PaymentMethodHistoryConflictError) {
        throw new AppError(
          "Payment method has payment history; deactivate it instead",
          409,
          "PAYMENT_METHOD_HAS_HISTORY",
        );
      }
      throw error;
    }
  }
}
