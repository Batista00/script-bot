import type { DatabaseExecutor } from "../../core/database/database.js";
import type { JsonObject } from "../integrations/integrations.types.js";

export const paymentMethodTypes = ["mercado_pago", "bank_transfer"] as const;
export const paymentMethodStatuses = ["active", "inactive"] as const;
export type PaymentMethodType = (typeof paymentMethodTypes)[number];
export type PaymentMethodStatus = (typeof paymentMethodStatuses)[number];

export interface BankTransferConfig extends JsonObject {
  accountHolder: string;
  rut: string;
  bankName: string;
  accountType: "checking" | "sight" | "savings";
  accountNumber: string;
  email?: string;
}

export type PaymentMethodConfig = JsonObject | BankTransferConfig;

export interface PaymentMethod {
  id: string;
  businessId: string;
  type: PaymentMethodType;
  name: string;
  status: PaymentMethodStatus;
  config: PaymentMethodConfig;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePaymentMethodInput {
  type: PaymentMethodType;
  name: string;
  config?: JsonObject;
}

export interface UpdatePaymentMethodInput {
  name?: string;
  status?: PaymentMethodStatus;
  config?: JsonObject;
}

export interface PaymentMethodPersistenceInput {
  type: PaymentMethodType;
  name: string;
  status: PaymentMethodStatus;
  config: JsonObject;
}

export class PaymentMethodConflictError extends Error {}
export class PaymentMethodHistoryConflictError extends Error {}

export interface PaymentMethodsRepository {
  create(
    businessId: string,
    input: PaymentMethodPersistenceInput,
    executor?: DatabaseExecutor,
  ): Promise<PaymentMethod>;
  list(businessId: string, status?: PaymentMethodStatus): Promise<PaymentMethod[]>;
  findById(
    businessId: string,
    paymentMethodId: string,
    executor?: DatabaseExecutor,
  ): Promise<PaymentMethod | null>;
  update(
    businessId: string,
    paymentMethodId: string,
    input: PaymentMethodPersistenceInput,
  ): Promise<PaymentMethod | null>;
  delete(businessId: string, paymentMethodId: string): Promise<boolean>;
}
