"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, SESSION_TOKEN } from "@/lib/session";

const USERNAME = "tomriddle";
const PASSWORD = "ghost";

async function secureCookie() {
  const forwarded = (await headers()).get("x-forwarded-proto");
  return forwarded === "https" || process.env.NODE_ENV === "production";
}

export async function signIn(formData: FormData): Promise<{ ok: true } | { ok: false; error: string }> {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (username !== USERNAME || password !== PASSWORD) {
    return { ok: false, error: "That username and password do not match." };
  }
  const jar = await cookies();
  jar.set(SESSION_COOKIE, SESSION_TOKEN, {
    httpOnly: true,
    secure: await secureCookie(),
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  return { ok: true };
}

export async function signOut() {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: await secureCookie(),
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  redirect("/login");
}
