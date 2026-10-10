"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "next-themes";
import {
  Briefcase,
  Check,
  ChevronDown,
  ChevronUp,
  Moon,
  TerminalSquare,
  Wrench,
} from "lucide-react";
import { demoSignIn, signIn, type SignInResult } from "@/app/login/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { API_BASE } from "@/lib/api";
import { formatCompactINR, formatNumber, formatPercent } from "@/lib/format";
import {
  initials,
  personaEntry,
  PERSONA_CATALOG,
  scopeLabel,
  type ExperienceSide,
  type PersonaScope,
} from "@/lib/personas";
import { BUSINESS_HOME } from "@/lib/session";
import { nextTheme, THEME_ICON, type ThemeValue } from "@/lib/theme";
import type { Kpis } from "@/lib/types";
import { cn } from "@/lib/utils";

type DemoPersona = {
  persona: string;
  label: string;
  experience: ExperienceSide;
  display_name: string;
  blurb: string;
  can_approve: boolean;
  scopes?: PersonaScope[];
};

const LAST_PERSONA_KEY = "qc_last_demo_persona";
const STACK = ["PostgreSQL", "Delta", "Redpanda", "FastAPI"];

export function LoginScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [kpisState, setKpisState] = useState<"loading" | "live" | "unavailable">("loading");
  const [personas, setPersonas] = useState<DemoPersona[]>([]);
  const [personasState, setPersonasState] = useState<"loading" | "ready" | "empty" | "error">(
    "loading",
  );
  const [side, setSide] = useState<ExperienceSide | null>(null);
  const [selectedPersona, setSelectedPersona] = useState<string | null>(null);
  const [emailOpen, setEmailOpen] = useState(false);
  const preselected = useRef(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/qc-api/v1/auth/demo-personas", { signal: controller.signal, cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error(`status ${res.status}`);
        return res.json();
      })
      .then((data: DemoPersona[]) => {
        const list = Array.isArray(data) ? data : [];
        setPersonas(list);
        setPersonasState(list.length === 0 ? "empty" : "ready");
        if (list.length === 0) setEmailOpen(true);
      })
      .catch(() => {
        setPersonas([]);
        setPersonasState("error");
        setEmailOpen(true);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${API_BASE}/api/v1/overview/kpis`, { signal: controller.signal, cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: Kpis | null) => {
        if (data) {
          setKpis(data);
          setKpisState("live");
        } else {
          setKpisState("unavailable");
        }
      })
      .catch(() => setKpisState("unavailable"));
    return () => controller.abort();
  }, []);

  // Preselect from URL, then last-used persona, once per mount after personas load.
  useEffect(() => {
    if (preselected.current || personasState !== "ready" || personas.length === 0) return;
    preselected.current = true;
    const urlSide = searchParams.get("side");
    const urlPersona = searchParams.get("persona");
    let last: string | null = null;
    try {
      last = window.localStorage.getItem(LAST_PERSONA_KEY);
    } catch {
      last = null;
    }
    const fromUrl = personas.find((p) => p.persona === urlPersona);
    const fromLast = personas.find((p) => p.persona === last);
    const pick = fromUrl ?? fromLast;
    if (pick) {
      setSide(pick.experience);
      setSelectedPersona(pick.persona);
      return;
    }
    if (urlSide === "business" || urlSide === "ops") {
      setSide(urlSide);
      const first = personas.find((p) => p.experience === urlSide);
      if (first) setSelectedPersona(first.persona);
    }
  }, [personas, personasState, searchParams]);

  const filtered = useMemo(
    () => (side ? personas.filter((p) => p.experience === side) : []),
    [personas, side],
  );

  const selected = useMemo(
    () => personas.find((p) => p.persona === selectedPersona) ?? null,
    [personas, selectedPersona],
  );

  const catalog = selected ? personaEntry(selected.persona) : null;

  useEffect(() => {
    if (!selected) return;
    const landing = catalog?.landing ?? (selected.experience === "business" ? BUSINESS_HOME : "/");
    router.prefetch(landing);
  }, [selected, catalog, router]);

  async function finish(result: SignInResult) {
    if (!result.ok) {
      setPending(false);
      setError(result.error);
      return;
    }
    try {
      if (selectedPersona) window.localStorage.setItem(LAST_PERSONA_KEY, selectedPersona);
    } catch {
      // private mode
    }
    const landing =
      result.experience === "business"
        ? BUSINESS_HOME
        : (personaEntry(result.persona)?.landing ?? "/");
    router.push(landing);
    router.refresh();
  }

  async function onSubmit(formData: FormData) {
    setError(null);
    setPending(true);
    await finish(await signIn(formData));
  }

  async function onContinue() {
    if (!selectedPersona) return;
    setError(null);
    setPending(true);
    await finish(await demoSignIn(selectedPersona));
  }

  function retryPersonas() {
    setPersonasState("loading");
    setError(null);
    fetch("/qc-api/v1/auth/demo-personas", { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error(`status ${res.status}`);
        return res.json();
      })
      .then((data: DemoPersona[]) => {
        const list = Array.isArray(data) ? data : [];
        setPersonas(list);
        setPersonasState(list.length === 0 ? "empty" : "ready");
        if (list.length === 0) setEmailOpen(true);
      })
      .catch(() => {
        setPersonas([]);
        setPersonasState("error");
        setEmailOpen(true);
      });
  }

  const ThemeIcon = mounted ? THEME_ICON[(theme as ThemeValue) ?? "system"] : Moon;
  const businessCount = personas.filter((p) => p.experience === "business").length;
  const opsCount = personas.filter((p) => p.experience === "ops").length;

  return (
    <div className="relative min-h-screen bg-background text-foreground">
      <a
        href="#sign-in"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
      >
        Skip to sign in
      </a>

      <header className="sticky top-0 z-40 border-b border-border/80 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-12 max-w-[1400px] items-center gap-3 px-4">
          <div className="flex items-center gap-2">
            <TerminalSquare className="size-4" strokeWidth={1.75} aria-hidden />
            <span className="text-sm font-medium tracking-tight">QuickCart</span>
          </div>
          <div className="ml-auto">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground"
              onClick={() => setTheme(nextTheme(theme))}
              aria-label="Cycle theme"
              title={`Theme: ${theme ?? "system"} (${resolvedTheme ?? "…"})`}
            >
              <ThemeIcon className="size-3.5" />
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid min-h-[calc(100vh-3rem)] max-w-[1400px] lg:grid-cols-2">
        <section id="sign-in" className="flex flex-col justify-center px-4 py-10 md:px-10 lg:px-14">
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">Sign in to QuickCart</h1>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            Pick a side, choose a demo persona, or sign in with email. Business and Operations share
            the same data — different jobs.
          </p>

          <div className="mt-8 space-y-6">
            <fieldset>
              <legend className="mb-2 text-xs font-medium text-muted-foreground">1. Choose a side</legend>
              <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Experience side">
                <SideCard
                  side="business"
                  selected={side === "business"}
                  icon={Briefcase}
                  title="Business"
                  description="KPIs, stores, money, and plain-English asks."
                  count={businessCount}
                  onSelect={() => {
                    setSide("business");
                    const first = personas.find((p) => p.experience === "business");
                    setSelectedPersona(first?.persona ?? null);
                  }}
                />
                <SideCard
                  side="ops"
                  selected={side === "ops"}
                  icon={Wrench}
                  title="Operations"
                  description="Live pipeline, proposals, SQL, and the agent."
                  count={opsCount}
                  onSelect={() => {
                    setSide("ops");
                    const first = personas.find((p) => p.experience === "ops");
                    setSelectedPersona(first?.persona ?? null);
                  }}
                />
              </div>
            </fieldset>

            {side ? (
              <fieldset>
                <legend className="mb-2 text-xs font-medium text-muted-foreground">
                  2. Choose a persona
                </legend>
                {personasState === "loading" ? (
                  <p className="text-sm text-muted-foreground">Loading demo personas…</p>
                ) : personasState === "error" ? (
                  <div role="alert" className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
                    <p>Couldn&apos;t reach the API for demo personas.</p>
                    <Button type="button" size="sm" variant="outline" onClick={retryPersonas}>
                      Retry
                    </Button>
                  </div>
                ) : filtered.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No demo personas on this side. Use email below.
                  </p>
                ) : (
                  <ul className="grid gap-2" role="radiogroup" aria-label="Demo persona">
                    {filtered.map((persona) => {
                      const entry = personaEntry(persona.persona);
                      const scopes = persona.scopes ?? entry?.scopes ?? [];
                      const selectedCard = selectedPersona === persona.persona;
                      return (
                        <li key={persona.persona}>
                          <button
                            type="button"
                            role="radio"
                            aria-checked={selectedCard}
                            disabled={pending}
                            onClick={() => setSelectedPersona(persona.persona)}
                            className={cn(
                              "flex w-full items-start gap-3 rounded-lg border bg-card px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                              selectedCard
                                ? "border-foreground ring-1 ring-foreground/30"
                                : "border-border hover:bg-secondary/60",
                            )}
                          >
                            <span
                              aria-hidden
                              className="grid size-9 shrink-0 place-items-center rounded-full bg-secondary text-xs font-medium"
                            >
                              {initials(persona.display_name)}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex flex-wrap items-center gap-2">
                                <span className="font-medium">{persona.display_name}</span>
                                {persona.can_approve ? (
                                  <span className="rounded-md border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                    Can approve
                                  </span>
                                ) : null}
                              </span>
                              <span className="mt-0.5 block text-sm text-muted-foreground">
                                {persona.label} · {scopeLabel(scopes)}
                              </span>
                              <span className="mt-1 block text-xs text-muted-foreground">
                                {persona.blurb}
                              </span>
                            </span>
                            {selectedCard ? (
                              <Check className="size-4 shrink-0 text-foreground" aria-hidden />
                            ) : null}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </fieldset>
            ) : null}

            {selected ? (
              <Button
                type="button"
                size="lg"
                className="h-10 w-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                disabled={pending}
                onClick={() => void onContinue()}
              >
                {pending ? "Signing in…" : `Continue as ${selected.display_name.split("(")[0].trim()}`}
              </Button>
            ) : null}

            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}

            <div>
              <div className="relative my-2 flex items-center gap-3">
                <div className="h-px flex-1 bg-border" />
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground">or</span>
                <div className="h-px flex-1 bg-border" />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full justify-between text-muted-foreground"
                onClick={() => setEmailOpen((v) => !v)}
                aria-expanded={emailOpen}
              >
                Sign in with email
                {emailOpen ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
              </Button>
              {emailOpen ? (
                <form action={onSubmit} className="mt-3 space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="email">Email</Label>
                      <Input
                        id="email"
                        name="email"
                        type="text"
                        autoComplete="username"
                        required
                        placeholder="you@quickcart.local"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="password">Password</Label>
                      <Input
                        id="password"
                        name="password"
                        type="password"
                        autoComplete="current-password"
                        required
                        placeholder="Password"
                      />
                    </div>
                  </div>
                  <Button type="submit" disabled={pending} className="h-9">
                    {pending ? "Checking…" : "Enter console"}
                  </Button>
                </form>
              ) : null}
            </div>
          </div>
        </section>

        <aside className="relative hidden border-l border-border lg:block">
          <div className="login-grid absolute inset-0" aria-hidden />
          <div className="relative sticky top-12 flex h-[calc(100vh-3rem)] flex-col justify-center gap-4 p-10">
            <Card size="sm" className="bg-card/90 backdrop-blur">
              <CardHeader>
                <CardTitle>
                  {selected
                    ? `You'll land on ${catalog?.landingLabel ?? (selected.experience === "business" ? "Today" : "Overview")}`
                    : "Pick a persona to preview"}
                </CardTitle>
                <CardDescription>
                  {selected
                    ? selected.blurb
                    : "Business personas open Today. Operations personas open Overview."}
                </CardDescription>
              </CardHeader>
              {catalog ? (
                <CardContent>
                  <ul className="space-y-1.5 text-sm text-muted-foreground">
                    {catalog.highlights.map((item) => (
                      <li key={item} className="flex gap-2">
                        <Check className="mt-0.5 size-3.5 shrink-0 text-foreground" aria-hidden />
                        {item}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              ) : (
                <CardContent>
                  <ul className="space-y-1.5 text-sm text-muted-foreground">
                    {PERSONA_CATALOG.filter((p) => p.side === (side ?? "business"))
                      .slice(0, 3)
                      .map((p) => (
                        <li key={p.persona}>
                          {p.label} — {p.landingLabel}
                        </li>
                      ))}
                  </ul>
                </CardContent>
              )}
            </Card>

            <Card size="sm" className="bg-card/90 backdrop-blur">
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-2 text-sm">
                  Floor numbers
                  <span className="text-[10px] font-normal uppercase tracking-wider text-muted-foreground">
                    {kpisState === "live" ? "Live" : kpisState === "loading" ? "Loading" : "Unavailable"}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-3 gap-3">
                  <Stat label="Orders" value={kpis ? formatNumber(kpis.orders_placed) : "—"} />
                  <Stat label="GMV" value={kpis ? formatCompactINR(kpis.gmv) : "—"} />
                  <Stat
                    label="Late"
                    value={kpis ? formatPercent(kpis.late_delivery_rate) : "—"}
                  />
                </dl>
              </CardContent>
            </Card>

            <ul className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              {STACK.map((name) => (
                <li key={name} className="rounded-md border border-border bg-card/80 px-2 py-1">
                  {name}
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}

function SideCard({
  side,
  selected,
  icon: Icon,
  title,
  description,
  count,
  onSelect,
}: {
  side: ExperienceSide;
  selected: boolean;
  icon: typeof Briefcase;
  title: string;
  description: string;
  count: number;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "flex flex-col gap-1 rounded-lg border bg-card px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected ? "border-foreground ring-1 ring-foreground/30" : "border-border hover:bg-secondary/60",
      )}
      data-side={side}
    >
      <span className="flex items-center gap-2 text-sm font-medium">
        <Icon className="size-3.5" strokeWidth={1.75} aria-hidden />
        {title}
        {count > 0 ? (
          <span className="ml-auto text-[11px] font-normal text-muted-foreground">{count}</span>
        ) : null}
      </span>
      <span className="text-xs text-muted-foreground">{description}</span>
    </button>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-lg font-medium tracking-tight">{value}</dd>
    </div>
  );
}
