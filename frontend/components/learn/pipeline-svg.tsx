const BANDS = [
  { x: 16, title: "Source", lines: ["Simulator", "PostgreSQL"] },
  { x: 196, title: "Ingest", lines: ["Batch export", "Redpanda", "Debezium"] },
  { x: 376, title: "Lakehouse", lines: ["Bronze", "Silver", "Quarantine", "Gold"] },
  { x: 556, title: "Intelligence", lines: ["ML → Gold", "Qdrant", "LangGraph"] },
  { x: 736, title: "Serving", lines: ["FastAPI", "Streamlit", "Next.js"] },
];

export function PipelineSvg() {
  return (
    <svg
      viewBox="0 0 920 210"
      role="img"
      aria-label="Five bands: source, ingest, lakehouse, intelligence, and serving. Arrows move left to right. A note says the agent proposes and a human approves."
      className="w-full"
    >
      <rect width="920" height="210" fill="var(--card)" />
      {BANDS.map((band, index) => (
        <g key={band.title}>
          <rect
            x={band.x}
            y={28}
            width="164"
            height="128"
            rx="8"
            fill="var(--muted)"
            stroke="var(--border)"
          />
          <text
            x={band.x + 12}
            y={50}
            fill="var(--muted-foreground)"
            fontSize="11"
            fontFamily="var(--font-mono)"
          >
            {band.title}
          </text>
          {band.lines.map((line, lineIndex) => (
            <text
              key={line}
              x={band.x + 12}
              y={76 + lineIndex * 18}
              fill="var(--foreground)"
              fontSize="12"
              fontFamily="var(--font-mono)"
            >
              {line}
            </text>
          ))}
          {index < BANDS.length - 1 ? (
            <path
              d={`M${band.x + 164} 92 H${BANDS[index + 1].x - 8}`}
              stroke="var(--chart-1)"
              strokeWidth="1.5"
              markerEnd="url(#arrow)"
            />
          ) : null}
        </g>
      ))}
      <defs>
        <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0 0 L6 3 L0 6" fill="var(--chart-1)" />
        </marker>
      </defs>
      <text
        x="16"
        y="186"
        fill="var(--muted-foreground)"
        fontSize="12"
        fontFamily="var(--font-mono)"
      >
        The agent proposes. A human approves. PostgreSQL changes only then.
      </text>
    </svg>
  );
}
