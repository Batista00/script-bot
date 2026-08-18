import { AppError } from "../../core/errors/app-error.js";
import {
  CategoryNameConflictError,
  categoryStatuses,
  type CategoriesRepository,
  type Category,
  type CategoryListOptions,
  type CreateCategoryInput,
  type UpdateCategoryInput,
} from "./categories.types.js";

function normalizeName(name: string): string {
  const normalized = name.trim();
  if (normalized.length === 0 || normalized.length > 120) {
    throw new AppError(
      "Category name must contain between 1 and 120 characters",
      400,
      "INVALID_CATEGORY_NAME",
    );
  }
  return normalized;
}

function conflictError(): AppError {
  return new AppError(
    "Category name already exists in this business",
    409,
    "CATEGORY_ALREADY_EXISTS",
  );
}

export class CategoriesService {
  constructor(private readonly repository: CategoriesRepository) {}

  async create(businessId: string, input: CreateCategoryInput): Promise<Category> {
    const name = normalizeName(input.name);
    if (await this.repository.findByName(businessId, name)) throw conflictError();

    try {
      return await this.repository.create(businessId, { name, status: "active" });
    } catch (error) {
      if (error instanceof CategoryNameConflictError) throw conflictError();
      throw error;
    }
  }

  list(businessId: string, options: CategoryListOptions): Promise<Category[]> {
    return this.repository.list(businessId, options);
  }

  async getById(businessId: string, categoryId: string): Promise<Category> {
    const category = await this.repository.findById(businessId, categoryId);
    if (!category) throw new AppError("Category not found", 404, "CATEGORY_NOT_FOUND");
    return category;
  }

  async update(
    businessId: string,
    categoryId: string,
    input: UpdateCategoryInput,
  ): Promise<Category> {
    if (input.name === undefined && input.status === undefined) {
      throw new AppError(
        "At least one category field must be provided",
        400,
        "EMPTY_CATEGORY_UPDATE",
      );
    }
    if (input.status !== undefined && !categoryStatuses.includes(input.status)) {
      throw new AppError("Invalid category status", 400, "INVALID_CATEGORY_STATUS");
    }

    const existing = await this.getById(businessId, categoryId);
    const name = input.name === undefined ? existing.name : normalizeName(input.name);
    const status = input.status ?? existing.status;
    if (await this.repository.findByName(businessId, name, categoryId)) {
      throw conflictError();
    }

    try {
      const category = await this.repository.update(businessId, categoryId, { name, status });
      if (!category) throw new AppError("Category not found", 404, "CATEGORY_NOT_FOUND");
      return category;
    } catch (error) {
      if (error instanceof CategoryNameConflictError) throw conflictError();
      throw error;
    }
  }
}
