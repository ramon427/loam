import { useId, type CSSProperties } from "react";

/** The document and graph share the same grid; only the graph transforms it. */
export function CanvasDotBackground({
  gap = 16,
  x = 0,
  y = 0,
  zoom = 1,
  style,
}: {
  gap?: number;
  x?: number;
  y?: number;
  zoom?: number;
  style?: CSSProperties;
}) {
  const patternId = useId();
  const spacing = gap * zoom;
  const radius = (1.25 * zoom) / 2;
  const offset = 1 + spacing / 2;

  return (
    <svg
      aria-hidden="true"
      data-canvas-dot-background=""
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        ...style,
      }}
    >
      <defs>
        <pattern
          id={patternId}
          x={x % spacing}
          y={y % spacing}
          width={spacing}
          height={spacing}
          patternUnits="userSpaceOnUse"
          patternTransform={`translate(-${offset},-${offset})`}
        >
          <circle
            cx={radius}
            cy={radius}
            r={radius}
            opacity={0.85}
            fill="var(--note-graph-grid-color, color-mix(in srgb, var(--app-border) 50%, color-mix(in srgb, var(--app-muted) 55%, transparent)))"
          />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${patternId})`} />
    </svg>
  );
}
