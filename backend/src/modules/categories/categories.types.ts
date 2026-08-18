export const categoryStatuses = ["active", "inactive"] as const;

export type CategoryStatus = (typeof categoryStatuses)[number];

export interface Category {
  id: string;
  businessId: string;
  name: string;
  status: CategoryStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCategoryInput {
  name: string;
}

export interface UpdateCategoryInput {
  name?: string;
  status?: CategoryStatus;
}

export interface CategoryListOptions {
  limit: number;
  offset: number;
  status?: CategoryStatus;
}

export interface CategoryListQuery {
  limit?: string;
  offset?: string;
  status?: CategoryStatus;
}

export interface CategoryPersistenceInput {
  name: string;
  status: CategoryStatus;
}

export class CategoryNameConflictError extends Error {
  constructor() {
    super("Category name already exists in this business");
    this.name = "CategoryNameConflictError";
  }
}

export interface CategoriesRepository {
  create(businessId: string, input: CategoryPersistenceInput): Promise<Category>;
  list(businessId: string, options: CategoryListOptions): Promise<Category[]>;
  findById(businessId: string, categoryId: string): Promise<Category | null>;
  findByName(
    businessId: string,
    name: string,
    excludeCategoryId?: string,
  ): Promise<Category | null>;
  update(
    businessId: string,
    categoryId: string,
    input: CategoryPersistenceInput,
  ): Promise<Category | null>;
}
