export const customerStatuses = ["active", "inactive"] as const;

export type CustomerStatus = (typeof customerStatuses)[number];

export interface Customer {
  id: string;
  businessId: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  status: CustomerStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCustomerInput {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
}

export interface UpdateCustomerInput {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  status?: CustomerStatus;
}

export interface CustomerListOptions {
  limit: number;
  offset: number;
  phone?: string;
  email?: string;
}

export interface CustomerListQuery {
  limit?: string;
  offset?: string;
  phone?: string;
  email?: string;
}

export interface CustomerContact {
  phone: string | null;
  email: string | null;
}

export interface CustomerPersistenceInput extends CustomerContact {
  name: string | null;
  status: CustomerStatus;
}

export type CustomerContactConflict = "phone" | "email";

export class CustomerContactConflictError extends Error {
  constructor(readonly field: CustomerContactConflict) {
    super(`Customer ${field} already exists in this business`);
    this.name = "CustomerContactConflictError";
  }
}

export interface CustomersRepository {
  create(businessId: string, input: CustomerPersistenceInput): Promise<Customer>;
  list(businessId: string, options: CustomerListOptions): Promise<Customer[]>;
  findById(businessId: string, customerId: string): Promise<Customer | null>;
  findContactConflict(
    businessId: string,
    contact: CustomerContact,
    excludeCustomerId?: string,
  ): Promise<CustomerContactConflict | null>;
  update(
    businessId: string,
    customerId: string,
    input: CustomerPersistenceInput,
  ): Promise<Customer | null>;
}
