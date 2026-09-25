import type { ReactNode } from "react";

export function Figure({
  src,
  alt,
  caption,
}: {
  src: string;
  alt: string;
  caption: string;
}) {
  return (
    <figure className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
      <img src={src} alt={alt} className="block w-full bg-muted" />
      <figcaption className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
        {caption}
      </figcaption>
    </figure>
  );
}

export function StepFlow({
  title,
  summary,
  steps,
}: {
  title: string;
  summary: string;
  steps: { label: string; detail: string }[];
}) {
  return (
    <section>
      <h2 className="text-base font-medium tracking-tight">{title}</h2>
      <p className="mt-1 max-w-[70ch] text-sm text-muted-foreground">{summary}</p>
      <ol className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-5">
        {steps.map((step, index) => (
          <li key={step.label} className="rounded-lg border border-border px-3 py-2.5">
            <div className="text-xs tabular-nums text-muted-foreground">
              {String(index + 1).padStart(2, "0")}
            </div>
            <h3 className="mt-0.5 text-sm font-medium">{step.label}</h3>
            <p className="mt-1 text-xs text-muted-foreground">{step.detail}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function Prose({ children }: { children: ReactNode }) {
  return <div className="max-w-[72ch] space-y-3 text-sm text-muted-foreground">{children}</div>;
}
