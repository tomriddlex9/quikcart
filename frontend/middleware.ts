import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, SESSION_TOKEN } from "@/lib/session";

/** Public showcase (Vercel → AWS API). When set, the console is open without login. */
function isPublicDemo(): boolean {
  const flag = process.env.QUICKCART_PUBLIC_DEMO ?? process.env.NEXT_PUBLIC_PUBLIC_DEMO ?? "";
  return flag === "1" || flag.toLowerCase() === "true";
}

function redirectTo(request: NextRequest, pathname: string) {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  if (host && !host.startsWith("127.") && !host.startsWith("localhost")) {
    return NextResponse.redirect(new URL(pathname, `${proto}://${host}`));
  }
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  return NextResponse.redirect(url);
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicDemo()) {
    if (pathname === "/login") return redirectTo(request, "/");
    return NextResponse.next();
  }

  const signedIn = request.cookies.get(SESSION_COOKIE)?.value === SESSION_TOKEN;

  if (pathname === "/login") {
    if (signedIn) return redirectTo(request, "/");
    return NextResponse.next();
  }

  if (!signedIn) return redirectTo(request, "/login");
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
