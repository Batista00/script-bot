import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { AppError } from "../src/core/errors/app-error.js";
import { PaymentMethodsService } from "../src/modules/payment-methods/payment-methods.service.js";
import { PaymentMethodHistoryConflictError, type PaymentMethod, type PaymentMethodPersistenceInput, type PaymentMethodsRepository } from "../src/modules/payment-methods/payment-methods.types.js";
import { BankTransferPaymentProvider } from "../src/modules/payments/bank-transfer.provider.js";

const businessId = randomUUID();
class MemoryRepository implements PaymentMethodsRepository {
  methods: PaymentMethod[] = []; historyConflict = false;
  async create(scope: string, input: PaymentMethodPersistenceInput) { const method: PaymentMethod = { id: randomUUID(), businessId: scope, ...input, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }; this.methods.push(method); return method; }
  async list(scope: string, status?: "active" | "inactive") { return this.methods.filter((item) => item.businessId === scope && (!status || item.status === status)); }
  async findById(scope: string, id: string) { return this.methods.find((item) => item.businessId === scope && item.id === id) ?? null; }
  async update(scope: string, id: string, input: PaymentMethodPersistenceInput) { const method = await this.findById(scope, id); if (!method) return null; Object.assign(method, input); return method; }
  async delete(scope: string, id: string) { if (this.historyConflict) throw new PaymentMethodHistoryConflictError(); const index = this.methods.findIndex((item) => item.businessId === scope && item.id === id); if (index < 0) return false; this.methods.splice(index, 1); return true; }
}
function error(code: string) { return (value: unknown) => value instanceof AppError && value.code === code; }

test("normalizes a Chilean bank transfer payment method", async () => {
  const service = new PaymentMethodsService(new MemoryRepository());
  const method = await service.create(businessId, { type: "bank_transfer", name: " Transferencia ", config: { accountHolder: "Flowchat SpA", rut: "12.345.678-k", bankName: "Banco Estado", accountType: "sight", accountNumber: "12345678", email: "PAGOS@EXAMPLE.COM" } });
  assert.equal(method.name, "Transferencia"); assert.equal(method.config.rut, "12345678-K"); assert.equal(method.config.email, "pagos@example.com");
});
test("rejects incomplete bank details", async () => {
  const service = new PaymentMethodsService(new MemoryRepository());
  await assert.rejects(service.create(businessId, { type: "bank_transfer", name: "Transferencia", config: {} }), error("INVALID_PAYMENT_METHOD_CONFIG"));
});
test("requires deactivation when a method has payment history", async () => {
  const repository = new MemoryRepository(); const service = new PaymentMethodsService(repository);
  const method = await service.create(businessId, { type: "mercado_pago", name: "Mercado Pago" }); repository.historyConflict = true;
  await assert.rejects(service.delete(businessId, method.id), error("PAYMENT_METHOD_HAS_HISTORY"));
});
test("bank transfer provider never approves automatically", async () => {
  const result = await new BankTransferPaymentProvider().createPayment({ businessId, paymentId: randomUUID(), orderId: randomUUID(), amount: 1000, currency: "CLP", customer: { id: randomUUID(), name: null, phone: "+56911111111", email: null } });
  assert.deepEqual(result, { status: "pending" });
});
