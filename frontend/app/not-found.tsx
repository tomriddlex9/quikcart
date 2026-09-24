import Link from "next/link";

export default function NotFound() {
  return (
    <div className="panel mx-auto max-w-md px-6 py-10 text-center">
      <div className="font-display text-[40px] font-semibold leading-none text-paper">404</div>
      <p className="mt-3 text-[12.5px] leading-relaxed text-muted">
        This page does not exist in the console. The pipeline stages are all accounted for —
        the route you asked for is not one of them.
      </p>
      <Link
        href="/"
        className="mt-5 inline-block rounded-xs border border-amber-dim/70 bg-amber/10 px-4 py-2 text-[12px] text-amber transition-colors hover:bg-amber/20"
      >
        back to overview
      </Link>
    </div>
  );
}
