export const businessStatuses = ["active", "inactive"] as const;

export type BusinessStatus = (typeof businessStatuses)[number];

export interface Business {
  id: string;
  name: string;
  status: BusinessStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBusinessInput {
  name: string;
}

export interface UpdateBusinessInput {
  name?: string;
  status?: BusinessStatus;
}

export interface BusinessesRepository {
  create(name: string, executor?: DatabaseExecutor): Promise<Business>;
  listForUser(userId: string, executor?: DatabaseExecutor): Promise<Business[]>;
  findById(id: string, executor?: DatabaseExecutor): Promise<Business | null>;
  update(
    id: string,
    input: UpdateBusinessInput,
    executor?: DatabaseExecutor,
  ): Promise<Business | null>;
}
import type { DatabaseExecutor } from "../../core/database/database.js";

