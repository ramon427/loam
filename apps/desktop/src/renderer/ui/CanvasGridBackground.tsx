import { useId, type CSSProperties } from "react";

/**
 * Faint graph paper, or dots, behind the note's paper and the graph. The document and graph
 * share it; only the graph moves and scales it with its viewport, and its lines stay one pixel
 * wide.
 */
export function CanvasGridBackground({
  pattern = "grid",
  gap = pattern === "dots" ? 16 : 20,
  x = 0,
  y = 0,
  zoom = 1,
  style,
}: {
  pattern?: "grid" | "dots";
  gap?: number;
  x?: number;
  y?: number;
  zoom?: number;
  style?: CSSProperties;
}) {
  const patternId = useId();
  const spacing = gap * zoom;
  const radius = (1.25 * zoom) / 2;

  return (
    <svg
      aria-hidden="true"
      data-canvas-grid-background={pattern}
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
        >
          {pattern === "dots" ? (
            <circle
              cx={spacing / 2}
              cy={spacing / 2}
              r={radius}
              opacity={0.85}
              fill="var(--note-graph-grid-color, color-mix(in srgb, var(--app-border) 50%, color-mix(in srgb, var(--app-muted) 55%, transparent)))"
            />
          ) : (
            // Half a pixel in, so each line covers one whole pixel.
            <path
              d={`M ${spacing} 0.5 H 0.5 V ${spacing}`}
              fill="none"
              stroke="var(--note-graph-grid-color, var(--canvas-grid-line))"
              strokeWidth={1}
            />
          )}
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${patternId})`} />
    </svg>
  );
}
