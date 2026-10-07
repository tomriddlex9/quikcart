"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, serverApiBase } from "@/lib/session";

export type SignInResult =
  | { ok: true; persona: string; experience: "business" | "ops" }
  | { ok: false; error: string };

type MeBody = { persona?: string; experience?: "business" | "ops"; detail?: unknown };

async function secureCookie() {
  const forwarded = (await headers()).get("x-forwarded-proto");
  return forwarded === "https" || process.env.NODE_ENV === "production";
}

/** Pull the session JWT (and its lifetime) out of FastAPI's Set-Cookie header. */
function readSessionCookie(res: Response): { value: string; maxAge: number } | null {
  for (const raw of res.headers.getSetCookie()) {
    if (!raw.startsWith(`${SESSION_COOKIE}=`)) continue;
    const parts = raw.split(";").map((part) => part.trim());
    const value = parts[0].slice(SESSION_COOKIE.length + 1);
    const maxAge = Number(parts.find((p) => p.toLowerCase().startsWith("max-age="))?.slice(8));
    if (value) return { value, maxAge: Number.isFinite(maxAge) && maxAge > 0 ? maxAge : 43200 };
  }
  return null;
}

async function callAuth(path: string, body: unknown): Promise<SignInResult> {
  let res: Response;
  try {
    res = await fetch(`${serverApiBase()}/api/v1/auth/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    return { ok: false, error: "Can't reach the QuickCart API. Try again in a moment." };
  }

  if (res.status === 401) return { ok: false, error: "That email and password do not match." };
  if (!res.ok) {
    return { ok: false, error: `Sign-in failed (${res.status}).` };
  }

  const session = readSessionCookie(res);
  if (!session) return { ok: false, error: "The API did not return a session." };

  const me = (await res.json()) as MeBody;
  const jar = await cookies();
  jar.set(SESSION_COOKIE, session.value, {
    httpOnly: true,
    secure: await secureCookie(),
    sameSite: "lax",
    path: "/",
    maxAge: session.maxAge,
  });
  return { ok: true, persona: me.persona ?? "", experience: me.experience ?? "ops" };
}

/** Email (or legacy username) + password sign-in against FastAPI. */
export async function signIn(formData: FormData): Promise<SignInResult> {
  const email = String(formData.get("email") ?? formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { ok: false, error: "Enter your email and password." };
  return callAuth("login", { email, password });
}

/** Passwordless sign-in as a demo persona (demo picker). */
export async function demoSignIn(persona: string): Promise<SignInResult> {
  return callAuth("demo-login", { persona });
}

export async function signOut() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    try {
      await fetch(`${serverApiBase()}/api/v1/auth/logout`, {
        method: "POST",
        headers: { cookie: `${SESSION_COOKIE}=${token}` },
        cache: "no-store",
      });
    } catch (error) {
      // Cookie is cleared below regardless; the server session simply expires on its own.
      console.error("logout: could not revoke server session", error);
    }
  }
  jar.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: await secureCookie(),
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  redirect("/login");
}
