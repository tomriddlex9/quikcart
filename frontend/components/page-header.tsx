import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="max-w-[62ch]">
        <h1 className="font-display text-[26px] font-semibold leading-tight tracking-tight text-paper">
          {title}
        </h1>
        {description ? (
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">{description}</p>
        ) : null}
      </div>
      {children}
    </header>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="mb-3 text-[11px] font-medium tracking-wide text-faint">
      {children}
    </h2>
  );
}
