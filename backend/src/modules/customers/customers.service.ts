import { AppError } from "../../core/errors/app-error.js";
import {
  CustomerContactConflictError,
  customerStatuses,
  type CreateCustomerInput,
  type Customer,
  type CustomerContactConflict,
  type CustomerListOptions,
  type CustomersRepository,
  type UpdateCustomerInput,
} from "./customers.types.js";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phonePattern = /^\+?[0-9]{1,32}$/;

function normalizeName(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const normalized = value.trim();
  if (normalized.length === 0) return null;
  if (normalized.length > 120) {
    throw new AppError("Customer name must not exceed 120 characters", 400, "INVALID_CUSTOMER_NAME");
  }
  return normalized;
}

function normalizePhone(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const normalized = value.trim().replace(/[\s().\/-]/g, "");
  if (normalized.length === 0) return null;
  if (!phonePattern.test(normalized)) {
    throw new AppError("Invalid customer phone", 400, "INVALID_CUSTOMER_PHONE");
  }
  return normalized;
}

function normalizeEmail(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) return null;
  if (normalized.length > 254 || !emailPattern.test(normalized)) {
    throw new AppError("Invalid customer email", 400, "INVALID_CUSTOMER_EMAIL");
  }
  return normalized;
}

function requireContact(phone: string | null, email: string | null): void {
  if (!phone && !email) {
    throw new AppError(
      "Customer must have a phone or email",
      400,
      "CUSTOMER_CONTACT_REQUIRED",
    );
  }
}

function duplicateError(field: CustomerContactConflict): AppError {
  return new AppError(
    `Customer ${field} already exists in this business`,
    409,
    "CUSTOMER_CONTACT_CONFLICT",
  );
}

export class CustomersService {
  constructor(private readonly repository: CustomersRepository) {}

  async create(businessId: string, input: CreateCustomerInput): Promise<Customer> {
    const name = normalizeName(input.name);
    const phone = normalizePhone(input.phone);
    const email = normalizeEmail(input.email);
    requireContact(phone, email);

    const conflict = await this.repository.findContactConflict(businessId, { phone, email });
    if (conflict) throw duplicateError(conflict);

    try {
      return await this.repository.create(businessId, {
        name,
        phone,
        email,
        status: "active",
      });
    } catch (error) {
      if (error instanceof CustomerContactConflictError) throw duplicateError(error.field);
      throw error;
    }
  }

  list(businessId: string, options: CustomerListOptions): Promise<Customer[]> {
    const phone = options.phone === undefined ? undefined : normalizePhone(options.phone);
    const email = options.email === undefined ? undefined : normalizeEmail(options.email);

    return this.repository.list(businessId, {
      limit: options.limit,
      offset: options.offset,
      ...(phone ? { phone } : {}),
      ...(email ? { email } : {}),
    });
  }

  async getById(businessId: string, customerId: string): Promise<Customer> {
    const customer = await this.repository.findById(businessId, customerId);
    if (!customer) throw new AppError("Customer not found", 404, "CUSTOMER_NOT_FOUND");
    return customer;
  }

  async update(
    businessId: string,
    customerId: string,
    input: UpdateCustomerInput,
  ): Promise<Customer> {
    if (
      input.name === undefined &&
      input.phone === undefined &&
      input.email === undefined &&
      input.status === undefined
    ) {
      throw new AppError(
        "At least one customer field must be provided",
        400,
        "EMPTY_CUSTOMER_UPDATE",
      );
    }

    if (input.status !== undefined && !customerStatuses.includes(input.status)) {
      throw new AppError("Invalid customer status", 400, "INVALID_CUSTOMER_STATUS");
    }

    const existing = await this.getById(businessId, customerId);
    const name = input.name === undefined ? existing.name : normalizeName(input.name);
    const phone = input.phone === undefined ? existing.phone : normalizePhone(input.phone);
    const email = input.email === undefined ? existing.email : normalizeEmail(input.email);
    const status = input.status ?? existing.status;
    requireContact(phone, email);

    const conflict = await this.repository.findContactConflict(
      businessId,
      { phone, email },
      customerId,
    );
    if (conflict) throw duplicateError(conflict);

    try {
      const customer = await this.repository.update(businessId, customerId, {
        name,
        phone,
        email,
        status,
      });
      if (!customer) throw new AppError("Customer not found", 404, "CUSTOMER_NOT_FOUND");
      return customer;
    } catch (error) {
      if (error instanceof CustomerContactConflictError) throw duplicateError(error.field);
      throw error;
    }
  }
}
