import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Same-origin probe so the console can tell Online from Offline.
 * A browser fetch of Streamlit is cross-origin and often opaque.
 */
export async function GET() {
  const url = (process.env.NEXT_PUBLIC_STREAMLIT_URL ?? "http://localhost:8501").replace(/\/$/, "");
  if (!url) {
    return NextResponse.json({ ok: false, status: 0 });
  }
  try {
    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(8000),
    });
    const ok = response.status >= 200 && response.status < 400;
    return NextResponse.json({ ok, status: response.status });
  } catch {
    return NextResponse.json({ ok: false, status: 0 });
  }
}
