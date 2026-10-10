import Image from "next/image";
import Link from "next/link";
import {
  Briefcase,
  Database,
  GitBranch,
  MessageSquare,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import { MARKETING_IMAGES } from "@/components/marketing/assets";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";
import { Button } from "@/components/ui/button";

const PROBLEMS = [
  {
    title: "Scattered ops data",
    body: "Orders, inventory, and deliveries live in separate tools — hard to trust a single number.",
  },
  {
    title: "Jargon between teams",
    body: "Engineers speak Delta and CDC. Managers need sales, late rates, and what to do next.",
  },
  {
    title: "Ungoverned automation",
    body: "Agents that write freely break trust. High-impact actions need a human in the loop.",
  },
] as const;

const FEATURES = [
  {
    icon: Briefcase,
    title: "Business layer",
    body: "Today, stores, money, and asks in plain English — scoped to your role.",
  },
  {
    icon: Wrench,
    title: "Ops console",
    body: "Live pipeline, SQL, lineage, ML, and proposals for the people who run the stack.",
  },
  {
    icon: MessageSquare,
    title: "Grounded agent",
    body: "Answers from real metrics and docs. No invented figures.",
  },
  {
    icon: ShieldCheck,
    title: "Human approval",
    body: "Restocks and promotions become proposals until someone taps approve.",
  },
] as const;

const STACK = [
  { name: "PostgreSQL", role: "Operational source" },
  { name: "Redpanda", role: "Streaming" },
  { name: "Debezium", role: "CDC" },
  { name: "PySpark / Delta", role: "Medallion lakehouse" },
  { name: "MLflow", role: "Model tracking" },
  { name: "Qdrant", role: "Document RAG" },
  { name: "FastAPI", role: "Serving API" },
  { name: "Next.js", role: "Console UI" },
] as const;

const BUSINESS = [
  {
    icon: Database,
    title: "One data truth",
    body: "Business KPIs and ops views read the same serving layer.",
  },
  {
    icon: GitBranch,
    title: "Two front doors",
    body: "Managers land on Today. Engineers land on Overview. Same app.",
  },
  {
    icon: ShieldCheck,
    title: "Decide, then act",
    body: "Suggestions wait in Actions / Proposals until a person signs off.",
  },
] as const;

const STATS = [
  { value: "2", label: "Experiences, one app" },
  { value: "0$", label: "Cloud bill to start" },
  { value: "1", label: "Laptop for the full stack" },
] as const;

export function LandingPage() {
  return (
    <div className="relative min-h-screen bg-background text-foreground">
      <SiteHeader showNav overMedia />

      <main>
        <section className="relative isolate min-h-[min(92vh,780px)] overflow-hidden">
          <Image
            src={MARKETING_IMAGES.hero}
            alt=""
            fill
            priority
            sizes="100vw"
            className="marketing-media-hero marketing-kenburns object-cover object-[center_40%]"
          />
          <div className="marketing-grain" aria-hidden />
          <div
            className="absolute inset-0 bg-gradient-to-b from-black/35 via-black/25 to-black/65"
            aria-hidden
          />

          <div className="relative mx-auto flex min-h-[min(92vh,780px)] max-w-[1120px] flex-col justify-end px-4 pb-14 pt-24 md:px-6 md:pb-20">
            <div className="grid gap-8 md:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] md:items-end">
              <div>
                <h1 className="marketing-reveal text-5xl font-semibold tracking-tight text-white md:text-6xl lg:text-7xl">
                  QuickCart
                </h1>
                <p className="marketing-reveal marketing-reveal-delay-1 mt-4 max-w-lg text-xl font-medium tracking-tight text-balance text-white/95 md:text-2xl">
                  Connect the floor to the lakehouse.
                </p>
              </div>
              <div className="marketing-reveal marketing-reveal-delay-2 md:pb-1">
                <p className="max-w-sm text-sm leading-relaxed text-white/85 md:text-[15px]">
                  From orders to Delta to a grounded agent — local-first, inspectable, and
                  zero-cost by default.
                </p>
                <div className="mt-6 flex flex-wrap gap-2">
                  <Button
                    nativeButton={false}
                    render={<Link href="/login" />}
                    size="lg"
                    className="h-10 bg-white px-4 text-neutral-900 transition-transform hover:bg-white/90 motion-safe:hover:-translate-y-0.5"
                  >
                    Get started today
                  </Button>
                  <Button
                    nativeButton={false}
                    render={<a href="#features" />}
                    variant="outline"
                    size="lg"
                    className="h-10 border-white/50 bg-transparent px-4 text-white transition-colors hover:bg-white/10 hover:text-white"
                  >
                    Explore features
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="border-b border-border bg-background">
          <div className="relative mx-auto max-w-[1120px] px-4 pt-10 md:px-6 md:pt-12">
            <div className="relative h-40 overflow-hidden rounded-2xl md:h-52">
              <Image
                src={MARKETING_IMAGES.band}
                alt=""
                fill
                sizes="(max-width: 1120px) 100vw, 1120px"
                className="marketing-media-print object-cover object-center transition-transform duration-700 ease-out hover:scale-[1.02]"
              />
              <div
                className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-transparent"
                aria-hidden
              />
            </div>
            <p className="mt-8 text-center text-sm text-muted-foreground">
              Built for teams who need the day — and the pipeline — in one place
            </p>
            <dl className="mt-8 grid grid-cols-1 gap-8 border-y border-border py-10 sm:grid-cols-3 sm:gap-4">
              {STATS.map((stat, i) => (
                <div
                  key={stat.label}
                  className="marketing-reveal text-center"
                  style={{ animationDelay: `${0.05 * i}s` }}
                >
                  <dt className="sr-only">{stat.label}</dt>
                  <dd className="text-3xl font-semibold tracking-tight md:text-4xl">{stat.value}</dd>
                  <p className="mt-1 text-sm text-muted-foreground">{stat.label}</p>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section id="problem" className="scroll-mt-16 border-b border-border">
          <div className="mx-auto grid max-w-[1120px] gap-10 px-4 py-16 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] md:gap-16 md:px-6 md:py-20">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">
                The gap we close
              </h2>
              <p className="mt-3 max-w-sm text-sm text-muted-foreground">
                Quick commerce moves fast. The platform that explains it usually doesn&apos;t.
              </p>
            </div>
            <ul className="divide-y divide-border border-y border-border">
              {PROBLEMS.map((item) => (
                <li
                  key={item.title}
                  className="py-5 transition-colors hover:bg-secondary/40"
                >
                  <h3 className="text-sm font-medium">{item.title}</h3>
                  <p className="mt-1.5 text-sm text-muted-foreground">{item.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="features" className="scroll-mt-16 border-b border-border">
          <div className="mx-auto max-w-[1120px] px-4 py-16 md:px-6 md:py-20">
            <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">What you get</h2>
            <p className="mt-3 max-w-lg text-sm text-muted-foreground">
              One platform with two experiences — business clarity and ops depth.
            </p>
            <ul className="mt-10 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2">
              {FEATURES.map((item) => {
                const Icon = item.icon;
                return (
                  <li
                    key={item.title}
                    className="bg-card p-6 transition-colors hover:bg-secondary/50 md:p-7"
                  >
                    <Icon className="size-4 text-muted-foreground" strokeWidth={1.75} aria-hidden />
                    <h3 className="mt-4 text-sm font-medium">{item.title}</h3>
                    <p className="mt-1.5 text-sm text-muted-foreground">{item.body}</p>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        <section id="stack" className="scroll-mt-16 border-b border-border">
          <div className="mx-auto max-w-[1120px] px-4 py-16 md:px-6 md:py-20">
            <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">
                  Technical stack
                </h2>
                <p className="mt-3 max-w-md text-sm text-muted-foreground">
                  Pinned versions, Docker profiles, and a path you can run end to end.
                </p>
              </div>
              <p className="font-mono text-xs text-muted-foreground">
                PostgreSQL → Spark/Delta → API → Console
              </p>
            </div>
            <ul className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {STACK.map((item) => (
                <li
                  key={item.name}
                  className="rounded-lg border border-border bg-card/60 px-3 py-3 transition-transform motion-safe:hover:-translate-y-0.5"
                >
                  <p className="text-sm font-medium">{item.name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{item.role}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="business" className="scroll-mt-16 border-b border-border">
          <div className="mx-auto max-w-[1120px] px-4 py-16 md:px-6 md:py-20">
            <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">
              Built for the business side too
            </h2>
            <p className="mt-3 max-w-lg text-sm text-muted-foreground">
              Leadership and store managers get the day in plain language — without a second
              product.
            </p>
            <ul className="mt-10 grid gap-8 md:grid-cols-3">
              {BUSINESS.map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.title}>
                    <Icon className="size-4 text-muted-foreground" strokeWidth={1.75} aria-hidden />
                    <h3 className="mt-3 text-sm font-medium">{item.title}</h3>
                    <p className="mt-1.5 text-sm text-muted-foreground">{item.body}</p>
                  </li>
                );
              })}
            </ul>

            <div className="mt-12 grid gap-4 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
              <div className="relative min-h-[200px] overflow-hidden rounded-2xl border border-border">
                <Image
                  src={MARKETING_IMAGES.login}
                  alt=""
                  fill
                  sizes="(max-width: 768px) 100vw, 40vw"
                  className="marketing-media-print object-cover transition-transform duration-700 hover:scale-[1.03]"
                />
              </div>
              <div className="relative overflow-hidden rounded-2xl border border-border">
                <Image
                  src={MARKETING_IMAGES.band}
                  alt=""
                  fill
                  sizes="(max-width: 768px) 100vw, 55vw"
                  className="marketing-media-print object-cover"
                />
                <div className="absolute inset-0 bg-black/45" aria-hidden />
                <blockquote className="relative flex h-full min-h-[200px] flex-col justify-end p-6 text-white md:p-8">
                  <p className="max-w-md text-lg font-medium tracking-tight text-balance md:text-xl">
                    “See the day in plain English — then open the pipe that produced the number.”
                  </p>
                  <footer className="mt-4 text-sm text-white/75">QuickCart · Business + Ops</footer>
                </blockquote>
              </div>
            </div>

            <div className="mt-12 flex flex-wrap items-center gap-3 border-t border-border pt-10">
              <p className="mr-auto max-w-sm text-sm text-muted-foreground">
                Pick a demo persona and walk the pipeline — or the morning briefing.
              </p>
              <Button
                nativeButton={false}
                render={<Link href="/login" />}
                size="lg"
                className="h-10 px-4"
              >
                Sign in to try it
              </Button>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
