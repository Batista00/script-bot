import type { FastifyReply, FastifyRequest } from "fastify";

import type { ImportProviderServiceInput } from "./provider-product-import.types.js";
import { ProviderProductImportService } from "./provider-product-import.service.js";

export interface ProviderProductImportParams { businessId: string }

export class ProviderProductImportController {
  constructor(private readonly service: ProviderProductImportService) {}

  import = async (
    request: FastifyRequest<{
      Params: ProviderProductImportParams;
      Body: ImportProviderServiceInput;
    }>,
    reply: FastifyReply,
  ): Promise<FastifyReply> => reply.status(201).send(
    await this.service.import(request.params.businessId, request.body),
  );
}
