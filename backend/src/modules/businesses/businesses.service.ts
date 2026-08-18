import { AppError } from "../../core/errors/app-error.js";
import {
  businessStatuses,
  type Business,
  type BusinessesRepository,
  type CreateBusinessInput,
  type UpdateBusinessInput,
} from "./businesses.types.js";

const maximumNameLength = 120;

function normalizeName(name: string): string {
  const normalized = name.trim();

  if (normalized.length === 0 || normalized.length > maximumNameLength) {
    throw new AppError(
      `Business name must contain between 1 and ${maximumNameLength} characters`,
      400,
      "INVALID_BUSINESS_NAME",
    );
  }

  return normalized;
}

export class BusinessesService {
  constructor(private readonly repository: BusinessesRepository) {}

  create(input: CreateBusinessInput): Promise<Business> {
    return this.repository.create(normalizeName(input.name));
  }

  list(): Promise<Business[]> {
    return this.repository.list();
  }

  async getById(id: string): Promise<Business> {
    const business = await this.repository.findById(id);

    if (!business) {
      throw new AppError("Business not found", 404, "BUSINESS_NOT_FOUND");
    }

    return business;
  }

  async update(id: string, input: UpdateBusinessInput): Promise<Business> {
    if (input.name === undefined && input.status === undefined) {
      throw new AppError(
        "At least one business field must be provided",
        400,
        "EMPTY_BUSINESS_UPDATE",
      );
    }

    if (input.status !== undefined && !businessStatuses.includes(input.status)) {
      throw new AppError("Invalid business status", 400, "INVALID_BUSINESS_STATUS");
    }

    const business = await this.repository.update(id, {
      ...(input.name === undefined ? {} : { name: normalizeName(input.name) }),
      ...(input.status === undefined ? {} : { status: input.status }),
    });

    if (!business) {
      throw new AppError("Business not found", 404, "BUSINESS_NOT_FOUND");
    }

    return business;
  }
}

