export function RouteTrace({ active = false }: { active?: boolean }) {
  return (
    <svg
      viewBox="0 0 640 360"
      className="h-auto w-full max-w-2xl text-foreground"
      role="img"
      aria-label={active ? "Loading console pages" : "Delivery routes between stores"}
    >
      <path
        d="M40 280 C 120 280, 140 80, 220 80 S 340 280, 420 200 S 560 40, 600 120"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.18"
        strokeWidth="2"
      />
      <path
        d="M40 280 C 120 280, 140 80, 220 80 S 340 280, 420 200 S 560 40, 600 120"
        fill="none"
        className={active ? "route-draw" : "route-idle"}
        stroke="var(--ring)"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <circle className="route-courier" cx="40" cy="280" r="6" fill="var(--ring)" />
      {[
        [40, 280],
        [220, 80],
        [420, 200],
        [600, 120],
      ].map(([cx, cy]) => (
        <g key={`${cx}-${cy}`}>
          <circle cx={cx} cy={cy} r="10" fill="var(--background)" stroke="currentColor" strokeOpacity="0.45" />
          <circle cx={cx} cy={cy} r="3" fill="currentColor" />
        </g>
      ))}
    </svg>
  );
}
