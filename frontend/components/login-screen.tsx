"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Briefcase,
  Check,
  ChevronDown,
  ChevronUp,
  Wrench,
} from "lucide-react";
import { demoSignIn, signIn, type SignInResult } from "@/app/login/actions";
import { MARKETING_IMAGES } from "@/components/marketing/assets";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";
import { Button } from "@/components/ui/button";
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
  const personaSectionRef = useRef<HTMLFieldSetElement>(null);

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

  useEffect(() => {
    if (!side) return;
    const id = window.setTimeout(() => {
      personaSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 80);
    return () => window.clearTimeout(id);
  }, [side]);

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

  function selectSide(next: ExperienceSide) {
    setSide(next);
    setError(null);
    const first = personas.find((p) => p.experience === next);
    setSelectedPersona(first?.persona ?? null);
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

      <div className="relative isolate min-h-[100svh] overflow-hidden">
        <Image
          src={MARKETING_IMAGES.login}
          alt=""
          fill
          priority
          sizes="100vw"
          className="marketing-media-print object-cover object-center"
        />
        <div className="marketing-grain opacity-60" aria-hidden />
        <div className="absolute inset-0 bg-background/55 backdrop-blur-[2px] dark:bg-background/70" aria-hidden />

        <div className="relative z-10">
          <SiteHeader />

          <div className="mx-auto grid min-h-[calc(100svh-3.5rem)] max-w-[1120px] lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            <aside className="hidden flex-col justify-end px-6 pb-16 pt-12 lg:flex lg:px-8">
              <p className="text-sm font-medium tracking-tight text-muted-foreground">QuickCart</p>
              <h2 className="mt-3 max-w-md text-3xl font-semibold tracking-tight text-balance md:text-4xl">
                Connect the floor to the lakehouse.
              </h2>
              <p className="mt-3 max-w-sm text-sm text-muted-foreground">
                Business and Operations share one data path — pick a side and step in.
              </p>

              <dl className="mt-10 grid max-w-md grid-cols-3 gap-4 border-t border-border pt-6">
                <Stat label="Orders" value={kpis ? formatNumber(kpis.orders_placed) : "—"} />
                <Stat label="GMV" value={kpis ? formatCompactINR(kpis.gmv) : "—"} />
                <Stat label="Late" value={kpis ? formatPercent(kpis.late_delivery_rate) : "—"} />
              </dl>
              <p className="mt-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                Floor numbers ·{" "}
                {kpisState === "live" ? "Live" : kpisState === "loading" ? "Loading" : "Unavailable"}
              </p>

              <ul className="mt-6 flex flex-wrap gap-2 text-xs text-muted-foreground">
                {STACK.map((name) => (
                  <li
                    key={name}
                    className="rounded-md border border-border bg-card/80 px-2 py-1 backdrop-blur-sm"
                  >
                    {name}
                  </li>
                ))}
              </ul>
            </aside>

            <section
              id="sign-in"
              className="flex flex-col justify-center px-4 py-8 md:px-8 lg:py-12"
            >
              <div className="marketing-reveal mx-auto flex w-full max-w-lg flex-col rounded-2xl border border-border bg-card/95 shadow-lg backdrop-blur-md">
                <div className="border-b border-border px-5 py-5 md:px-7 md:py-6">
                  <p className="text-xs text-muted-foreground">
                    <Link href="/home" className="underline-offset-4 hover:underline">
                      ← Back to home
                    </Link>
                  </p>
                  <h1 className="mt-3 text-2xl font-semibold tracking-tight md:text-3xl">
                    Sign in to QuickCart
                  </h1>
                  <ol className="mt-4 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                    <StepChip n={1} label="Side" done={Boolean(side)} active={!side} />
                    <StepChip n={2} label="Persona" done={Boolean(selected)} active={Boolean(side) && !selected} />
                    <StepChip n={3} label="Enter" done={false} active={Boolean(selected)} />
                  </ol>
                </div>

                <div className="space-y-5 px-5 py-5 md:px-7 md:py-6">
                  <fieldset>
                    <legend className="mb-2 text-xs font-medium text-muted-foreground">
                      1. Choose a side
                    </legend>
                    <div
                      className="grid gap-2 sm:grid-cols-2"
                      role="radiogroup"
                      aria-label="Experience side"
                    >
                      <SideCard
                        side="business"
                        selected={side === "business"}
                        icon={Briefcase}
                        title="Business"
                        description="KPIs, stores, money, and plain-English asks."
                        count={businessCount}
                        onSelect={() => selectSide("business")}
                      />
                      <SideCard
                        side="ops"
                        selected={side === "ops"}
                        icon={Wrench}
                        title="Operations"
                        description="Live pipeline, proposals, SQL, and the agent."
                        count={opsCount}
                        onSelect={() => selectSide("ops")}
                      />
                    </div>
                  </fieldset>

                  {side ? (
                    <fieldset
                      ref={personaSectionRef}
                      className="marketing-panel-in rounded-xl border border-border bg-secondary/30 p-3 md:p-4"
                    >
                      <legend className="mb-2 px-1 text-xs font-medium text-muted-foreground">
                        2. Choose a persona
                        <span className="ml-2 font-normal">
                          ({filtered.length} on {side === "business" ? "Business" : "Operations"})
                        </span>
                      </legend>

                      {personasState === "loading" ? (
                        <p className="px-1 text-sm text-muted-foreground">Loading demo personas…</p>
                      ) : personasState === "error" ? (
                        <div
                          role="alert"
                          className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm"
                        >
                          <p>Couldn&apos;t reach the API for demo personas.</p>
                          <Button type="button" size="sm" variant="outline" onClick={retryPersonas}>
                            Retry
                          </Button>
                        </div>
                      ) : filtered.length === 0 ? (
                        <p className="px-1 text-sm text-muted-foreground">
                          No demo personas on this side. Use email below.
                        </p>
                      ) : (
                        <ul
                          className="grid max-h-[min(52vh,420px)] gap-2 overflow-y-auto overscroll-contain pr-0.5"
                          role="radiogroup"
                          aria-label="Demo persona"
                        >
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
                                    "flex w-full items-start gap-3 rounded-xl border bg-card px-3 py-3.5 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                    selectedCard
                                      ? "border-foreground shadow-sm ring-1 ring-foreground/25"
                                      : "border-border hover:border-foreground/30 hover:bg-secondary/50",
                                  )}
                                >
                                  <span
                                    aria-hidden
                                    className="grid size-10 shrink-0 place-items-center rounded-full bg-secondary text-xs font-medium"
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
                  ) : (
                    <p className="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
                      Select Business or Operations to see demo personas.
                    </p>
                  )}

                  {selected ? (
                    <div className="marketing-panel-in space-y-3 rounded-xl border border-border bg-background p-3 md:p-4">
                      <p className="text-xs text-muted-foreground">
                        You&apos;ll land on{" "}
                        <span className="font-medium text-foreground">
                          {catalog?.landingLabel ??
                            (selected.experience === "business" ? "Today" : "Overview")}
                        </span>
                        {" — "}
                        {selected.blurb}
                      </p>
                      {catalog ? (
                        <ul className="space-y-1 text-xs text-muted-foreground">
                          {catalog.highlights.slice(0, 3).map((item) => (
                            <li key={item} className="flex gap-2">
                              <Check className="mt-0.5 size-3 shrink-0 text-foreground" aria-hidden />
                              {item}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <ul className="space-y-1 text-xs text-muted-foreground">
                          {PERSONA_CATALOG.filter((p) => p.side === (side ?? "business"))
                            .slice(0, 2)
                            .map((p) => (
                              <li key={p.persona}>
                                {p.label} — {p.landingLabel}
                              </li>
                            ))}
                        </ul>
                      )}
                      <Button
                        type="button"
                        size="lg"
                        className="h-11 w-full"
                        disabled={pending}
                        onClick={() => void onContinue()}
                      >
                        {pending
                          ? "Signing in…"
                          : `Continue as ${selected.display_name.split("(")[0].trim()}`}
                      </Button>
                    </div>
                  ) : null}

                  {error ? (
                    <p role="alert" className="text-sm text-destructive">
                      {error}
                    </p>
                  ) : null}

                  <div>
                    <div className="relative my-1 flex items-center gap-3">
                      <div className="h-px flex-1 bg-border" />
                      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                        or
                      </span>
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
                      {emailOpen ? (
                        <ChevronUp className="size-3.5" />
                      ) : (
                        <ChevronDown className="size-3.5" />
                      )}
                    </Button>
                    {emailOpen ? (
                      <form action={onSubmit} className="mt-3 space-y-3">
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
                        <Button type="submit" disabled={pending} className="h-10 w-full">
                          {pending ? "Checking…" : "Enter console"}
                        </Button>
                      </form>
                    ) : null}
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>

      <SiteFooter />
    </div>
  );
}

function StepChip({
  n,
  label,
  done,
  active,
}: {
  n: number;
  label: string;
  done: boolean;
  active: boolean;
}) {
  return (
    <li
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1",
        done && "border-foreground/40 bg-secondary text-foreground",
        active && !done && "border-foreground bg-foreground text-background",
        !done && !active && "border-border",
      )}
    >
      <span className="tabular-nums">{n}</span>
      {label}
    </li>
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
        "flex flex-col gap-1 rounded-xl border bg-background px-3 py-3.5 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected
          ? "border-foreground ring-1 ring-foreground/30"
          : "border-border hover:bg-secondary/60",
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
