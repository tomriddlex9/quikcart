"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { signIn } from "@/app/login/actions";
import { FloorShader } from "@/components/floor-shader";
import { API_BASE } from "@/lib/api";
import { ALL_PAGES } from "@/lib/nav";
import { formatCompactINR, formatNumber, formatPercent } from "@/lib/format";
import type { Kpis } from "@/lib/types";

const NAV = ["Operate", "Live", "ML", "Gold", "Agent", "Trust"];
const STACK = ["PostgreSQL", "Delta", "Redpanda", "FastAPI"];

export function LoginScreen() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [booting, setBooting] = useState(false);
  const [step, setStep] = useState(0);
  const [kpis, setKpis] = useState<Kpis | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${API_BASE}/api/v1/overview/kpis`, { signal: controller.signal, cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: Kpis | null) => {
        if (data) setKpis(data);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  async function onSubmit(formData: FormData) {
    setError(null);
    setPending(true);
    const result = await signIn(formData);
    if (!result.ok) {
      setPending(false);
      setError(result.error);
      return;
    }
    setBooting(true);
    for (let i = 0; i < ALL_PAGES.length; i += 1) {
      router.prefetch(ALL_PAGES[i].href);
      setStep(i);
      await wait(120);
    }
    router.push("/");
    router.refresh();
  }

  const current = ALL_PAGES[step];

  return (
    <div className="login-axiom relative min-h-screen overflow-hidden bg-[#070807] text-white">
      <FloorShader mode="ascii" className="pointer-events-none absolute inset-0 h-full w-full opacity-70" />
      <div className="pointer-events-none absolute inset-0 login-axiom-shade" />

      <div className="relative z-10 flex min-h-screen flex-col">
        <header className="grid grid-cols-[auto_1fr_auto] items-center gap-4 border-b border-white/15 px-4 py-3 md:px-6">
          <p className="text-sm font-medium tracking-tight">QuickCart</p>
          <nav className="hidden items-center justify-center gap-5 text-[11px] tracking-[0.16em] text-white/70 md:flex" aria-label="Console">
            {NAV.map((item) => (
              <span key={item}>/ {item}</span>
            ))}
          </nav>
          <a
            href="#sign-in"
            className="justify-self-end border border-white/25 px-3 py-1.5 text-xs text-white/90"
          >
            Dashboard
          </a>
        </header>

        <div className="grid flex-1 lg:grid-cols-2">
          <section className="login-axiom-stripe flex flex-col justify-center border-white/15 px-6 py-10 md:px-12 lg:border-r">
            <p className="w-fit border border-white/20 bg-black/40 px-2 py-1 text-[11px] text-white/70">
              Gold marts — live orders
            </p>
            <h1 className="mt-8 max-w-xl text-4xl font-medium leading-[1.05] tracking-tight md:text-6xl">
              {booting ? (
                <>Opening the floor</>
              ) : (
                <>
                  The operations
                  <br />
                  layer for every
                  <br />
                  dark store
                </>
              )}
            </h1>
            <p className="mt-6 max-w-md text-sm leading-relaxed text-white/65">
              {booting
                ? `${current.label}${current.hint ? ` — ${current.hint}` : ""}`
                : "Orders, stock, and forecasts from the lakehouse. The agent can propose a restock. A person still has to approve it."}
            </p>

            {booting ? (
              <ol className="mt-8 grid max-w-md grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
                {ALL_PAGES.map((page, index) => (
                  <li
                    key={page.href}
                    className={index <= step ? "text-sm text-[#C6F53A]" : "text-sm text-white/35"}
                  >
                    {page.label}
                  </li>
                ))}
              </ol>
            ) : (
              <form id="sign-in" action={onSubmit} className="mt-8 max-w-md space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="sr-only">Username</span>
                    <input
                      name="username"
                      autoComplete="username"
                      required
                      autoFocus
                      placeholder="Username"
                      className="h-11 w-full border border-white/25 bg-black/50 px-3 text-sm outline-none placeholder:text-white/40 focus:border-[#C6F53A]"
                    />
                  </label>
                  <label className="block">
                    <span className="sr-only">Password</span>
                    <input
                      name="password"
                      type="password"
                      autoComplete="current-password"
                      required
                      placeholder="Password"
                      className="h-11 w-full border border-white/25 bg-black/50 px-3 text-sm outline-none placeholder:text-white/40 focus:border-[#C6F53A]"
                    />
                  </label>
                </div>
                {error ? (
                  <p role="alert" className="text-sm text-[#ff8b7b]">
                    {error}
                  </p>
                ) : null}
                <button
                  type="submit"
                  disabled={pending}
                  className="h-11 border border-[#C6F53A] bg-[#C6F53A] px-5 text-sm font-medium text-black disabled:opacity-60"
                >
                  {pending ? "Checking…" : "Enter console"}
                </button>
              </form>
            )}
          </section>

          <section className="relative min-h-[320px] border-t border-white/15 lg:border-t-0">
            <FloorShader mode="dither" className="absolute inset-0 h-full w-full" />
            <div className="absolute left-4 top-4 border border-[#C6F53A]/50 bg-black/70 px-2 py-1 text-[10px] tracking-[0.14em] text-[#C6F53A]">
              {booting ? "LOADING PAGES" : "STORES ON THE FLOOR"}
            </div>
            <div className="absolute right-4 top-4 flex gap-0.5" aria-hidden>
              {Array.from({ length: 14 }, (_, i) => (
                <span
                  key={i}
                  className="login-tick block w-[3px] bg-[#C6F53A]"
                  style={{ height: 8 + ((i * 5) % 12), animationDelay: `${i * 80}ms` }}
                />
              ))}
            </div>
          </section>
        </div>

        <footer className="grid border-t border-white/15 md:grid-cols-2">
          <ul className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-white/15 px-6 py-4 text-sm text-white/70 md:border-b-0 md:border-r">
            {STACK.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
          <dl className="grid grid-cols-3">
            <Stat label="Orders placed" value={kpis ? formatNumber(kpis.orders_placed) : "—"} />
            <Stat label="GMV" value={kpis ? formatCompactINR(kpis.gmv) : "—"} />
            <Stat
              label="Late deliveries"
              value={kpis ? formatPercent(kpis.late_delivery_rate) : "—"}
            />
          </dl>
        </footer>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-l border-white/15 px-4 py-4 first:border-l-0">
      <dt className="text-[10px] tracking-[0.14em] text-white/45">{label}</dt>
      <dd className="mt-2 text-2xl font-medium tracking-tight md:text-3xl">{value}</dd>
    </div>
  );
}

function wait(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}
