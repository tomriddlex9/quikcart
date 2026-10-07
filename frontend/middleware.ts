import { jwtVerify } from "jose";
import { NextResponse, type NextRequest } from "next/server";
import {
  authSecret,
  BUSINESS_HOME,
  BUSINESS_WELCOME,
  isBusinessPersona,
  SESSION_COOKIE,
  type SessionClaims,
} from "@/lib/session";

/** Public showcase (Vercel → AWS API). When set, the console is open without login. */
function isPublicDemo(): boolean {
  const flag = process.env.QUICKCART_PUBLIC_DEMO ?? process.env.NEXT_PUBLIC_PUBLIC_DEMO ?? "";
  return flag === "1" || flag.toLowerCase() === "true";
}

/**
 * Business personas always land on the business console (/b/*). Set
 * QUICKCART_BUSINESS_UX=0 (or "false") to opt out and keep everyone on the ops console.
 */
function businessUxEnabled(): boolean {
  const flag = (process.env.QUICKCART_BUSINESS_UX ?? "").toLowerCase();
  return flag !== "0" && flag !== "false";
}

/** Set by the welcome tour on completion; the session JWT's `onb` claim only refreshes at next sign-in. */
const ONBOARDED_COOKIE = "qc_onb";

function redirectTo(request: NextRequest, pathname: string) {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  if (host && !host.startsWith("127.") && !host.startsWith("localhost")) {
    return NextResponse.redirect(new URL(pathname, `${proto}://${host}`));
  }
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = "";
  return NextResponse.redirect(url);
}

/** Verified claims, or null when the cookie is missing, tampered with, or expired. */
async function readSession(request: NextRequest): Promise<SessionClaims | null> {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(authSecret()), {
      algorithms: ["HS256"],
    });
    if (typeof payload.sub !== "string" || typeof payload.sid !== "string") return null;
    return {
      sub: payload.sub,
      sid: payload.sid,
      persona: typeof payload.persona === "string" ? payload.persona : "",
      onb: payload.onb === 1 ? 1 : 0,
    };
  } catch {
    return null;
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicDemo()) {
    if (pathname === "/login") return redirectTo(request, "/");
    return NextResponse.next();
  }

  if (pathname === "/api/streamlit-health") return NextResponse.next();
  // Same-origin API proxy (next.config rewrite). FastAPI enforces auth; do not
  // gate these with the console cookie or login cannot load demo personas.
  if (pathname.startsWith("/qc-api")) return NextResponse.next();

  const session = await readSession(request);
  const business = businessUxEnabled() && isBusinessPersona(session?.persona);

  if (pathname === "/login") {
    if (!session) return NextResponse.next();
    return redirectTo(request, business ? BUSINESS_HOME : "/");
  }

  if (!session) return redirectTo(request, "/login");

  if (business) {
    // First sign-in: welcome tour before anything else.
    const onboarded = session.onb === 1 || request.cookies.get(ONBOARDED_COOKIE)?.value === "1";
    if (!onboarded && pathname !== BUSINESS_WELCOME && pathname !== "/onboarding") {
      return redirectTo(request, BUSINESS_WELCOME);
    }
    // Landing page for business personas. Ops-only deep paths stay reachable for now.
    if (pathname === "/") return redirectTo(request, BUSINESS_HOME);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
