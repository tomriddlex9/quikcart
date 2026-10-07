/** Session cookie shared by the console middleware, server actions, and the FastAPI backend. */
export const SESSION_COOKIE = "qc_session";

export const DEV_AUTH_SECRET = "quickcart-dev-secret-change-me";

/** Secret used to verify the HS256 session JWT issued by FastAPI (must match its `auth_secret`). */
export function authSecret(): string {
  return process.env.AUTH_SECRET || process.env.QUICKCART_AUTH_SECRET || DEV_AUTH_SECRET;
}

/** FastAPI base URL for server-side calls (server actions, middleware-adjacent code). */
export function serverApiBase(): string {
  return (
    process.env.QUICKCART_API_BASE ||
    process.env.NEXT_PUBLIC_API_BASE ||
    "http://localhost:8000"
  ).replace(/\/$/, "");
}

/** Claims carried by the session JWT (the JWT itself stays opaque to client code). */
export type SessionClaims = {
  sub: string;
  sid: string;
  persona: string;
  /** 1 once the user has finished onboarding. */
  onb: number;
};

/** Personas that use the business experience (the rest are ops/admin). */
export const BUSINESS_PERSONAS: ReadonlySet<string> = new Set([
  "business_exec",
  "city_manager",
  "store_manager",
  "category_manager",
  "leadership",
]);

export function isBusinessPersona(persona: string | undefined | null): boolean {
  return !!persona && BUSINESS_PERSONAS.has(persona);
}

export const BUSINESS_HOME = "/b/today";
export const BUSINESS_WELCOME = "/b/welcome";
