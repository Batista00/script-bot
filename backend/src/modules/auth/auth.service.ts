import { AppError } from "../../core/errors/app-error.js";
import type { MembershipsRepository } from "../memberships/memberships.types.js";
import type { User, UsersRepository } from "../users/users.types.js";
import {
  createSessionToken,
  hashSessionToken,
  verifyPassword,
} from "./auth.crypto.js";
import type {
  AuthSessionsRepository,
  AuthView,
  LoginInput,
  LoginResult,
} from "./auth.types.js";

const invalidCredentials = (): AppError =>
  new AppError("Invalid email or password", 401, "INVALID_CREDENTIALS");

export class AuthService {
  constructor(
    private readonly users: UsersRepository,
    private readonly sessions: AuthSessionsRepository,
    private readonly memberships: MembershipsRepository,
    private readonly sessionTtlHours: number,
  ) {}

  async login(input: LoginInput): Promise<LoginResult> {
    const user = await this.users.findByEmail(input.email.trim().toLowerCase());

    if (!user) throw invalidCredentials();

    const passwordIsValid = await verifyPassword(user.passwordHash, input.password);
    if (!passwordIsValid || user.status !== "active") throw invalidCredentials();

    const sessionToken = createSessionToken();
    const expiresAt = new Date(Date.now() + this.sessionTtlHours * 60 * 60 * 1_000);
    await this.sessions.create(user.id, hashSessionToken(sessionToken), expiresAt);

    return {
      ...(await this.getView(user)),
      sessionToken,
      expiresAt,
    };
  }

  async authenticate(sessionToken: string | undefined): Promise<User> {
    if (!sessionToken) {
      throw new AppError("Authentication required", 401, "AUTHENTICATION_REQUIRED");
    }

    const user = await this.sessions.findActiveUserByTokenHash(hashSessionToken(sessionToken));
    if (!user) throw new AppError("Invalid or expired session", 401, "INVALID_SESSION");
    return user;
  }

  async getView(user: User): Promise<AuthView> {
    const memberships = await this.memberships.listForUser(user.id);
    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        status: user.status,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
      businesses: memberships.map(({ business, role }) => ({
        id: business.id,
        name: business.name,
        status: business.status,
        role,
      })),
    };
  }

  async logout(sessionToken: string | undefined): Promise<void> {
    if (sessionToken) {
      await this.sessions.deleteByTokenHash(hashSessionToken(sessionToken));
    }
  }
}
