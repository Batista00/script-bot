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
  create(name: string): Promise<Business>;
  list(): Promise<Business[]>;
  findById(id: string): Promise<Business | null>;
  update(id: string, input: UpdateBusinessInput): Promise<Business | null>;
}

