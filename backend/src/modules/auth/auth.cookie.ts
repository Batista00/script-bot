import type { FastifyCookieOptions } from "@fastify/cookie";

export const sessionCookieName = "bot_whatsap_session";

type CookieOptions = NonNullable<FastifyCookieOptions["parseOptions"]>;

export function sessionCookieOptions(
  production: boolean,
  expires?: Date,
): CookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: production,
    path: "/",
    ...(expires ? { expires } : {}),
  };
}

