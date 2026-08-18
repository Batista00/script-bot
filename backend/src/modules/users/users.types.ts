import type { DatabaseExecutor } from "../../core/database/database.js";

export const userStatuses = ["active", "inactive"] as const;

export type UserStatus = (typeof userStatuses)[number];

export interface User {
  id: string;
  email: string;
  name: string;
  status: UserStatus;
  createdAt: string;
  updatedAt: string;
}

export interface UserWithPasswordHash extends User {
  passwordHash: string;
}

export interface CreateUserInput {
  email: string;
  name: string;
  passwordHash: string;
}

export interface UsersRepository {
  create(input: CreateUserInput, executor?: DatabaseExecutor): Promise<User>;
  findByEmail(email: string, executor?: DatabaseExecutor): Promise<UserWithPasswordHash | null>;
}

