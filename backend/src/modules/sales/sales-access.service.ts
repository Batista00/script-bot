import { createHash, randomBytes } from "node:crypto";
import { AppError } from "../../core/errors/app-error.js";
import type { BotGatewayService } from "../bot-gateway/bot-gateway.service.js";
import type { PostgresSalesRepository } from "./sales.repository.js";

export function secretHash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
export class SalesAccessService {
  constructor(private readonly repository: PostgresSalesRepository, private readonly gateway: BotGatewayService) {}
  async open(businessId: string, contact: string, name?: string) {
    if (!/^[0-9]{8,15}$/.test(contact)) throw new AppError("Número de WhatsApp no válido",400,"INVALID_CONTACT");
    const settings = await this.repository.settings(businessId);
    if (!settings.enabled) throw new AppError("Ventas automáticas desactivadas",409,"SALES_DISABLED");
    return this.repository.exclusive(`${businessId}:${contact}`,async()=>{
      const customer = await this.gateway.resolveCustomer(businessId,{phone:contact,...(name ? {name} : {})});
      const session = await this.repository.ensureSession(businessId,customer.customerId,contact);
      const token = `cs_${randomBytes(32).toString("base64url")}`;
      await this.repository.addToken(session,secretHash(token));
      return {sessionId:session.id,sessionToken:token,typebotSessionId:session.typebotSessionId};
    });
  }
  async authenticate(authorization: unknown) {
    const token = typeof authorization === "string" ? /^Bearer (cs_[A-Za-z0-9_-]{43})$/.exec(authorization)?.[1] : undefined;
    const result = token ? await this.repository.token(secretHash(token)) : null;
    if (!result) throw new AppError("Conversación expirada o no autorizada",401,"SALES_SESSION_UNAUTHORIZED");
    return result;
  }
}
