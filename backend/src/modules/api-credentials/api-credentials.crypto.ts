import { createHash, randomBytes } from "node:crypto";

const tokenPattern = /^bw_[A-Za-z0-9_-]{43}$/;

export function generateApiCredentialToken(): string {
  return `bw_${randomBytes(32).toString("base64url")}`;
}

export function hashApiCredentialToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function apiCredentialTokenPrefix(token: string): string {
  return token.slice(0, 11);
}

export function isApiCredentialToken(value: string): boolean {
  return tokenPattern.test(value);
}
