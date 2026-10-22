import type { AiContextUsage } from "@loam/shared/ai/aiChat";

import { cn } from "@loam/notes-ui/ui/cn";

const RADIUS = 6;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** "850", "45k", "1.2M". */
const formatTokens = (tokens: number) =>
  tokens < 1000
    ? String(tokens)
    : tokens < 1_000_000
      ? `${Math.round(tokens / 1000)}k`
      : `${(tokens / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;

/**
 * How full the model's context is with this chat: a ring that fills, amber
 * near the end and red at it, or the count alone when the model's size isn't
 * known. Its tooltip says the numbers.
 */
export function AiChatContextMeter({ usage }: { usage: AiContextUsage }) {
  const share = usage.window ? Math.min(1, usage.tokens / usage.window) : null;
  const label =
    share === null
      ? `Context: ${formatTokens(usage.tokens)} tokens`
      : `Context: ${formatTokens(usage.tokens)} of ${formatTokens(usage.window!)} tokens (${Math.round(share * 100)}%)`;
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1 px-1 text-[11px] text-(--app-muted) tabular-nums",
        share !== null && share >= 0.8 && "text-(--status-warning)",
        share !== null && share >= 0.95 && "text-(--status-danger)",
      )}
    >
      {share === null ? (
        formatTokens(usage.tokens)
      ) : (
        <svg viewBox="0 0 16 16" className="size-4 -rotate-90" aria-hidden>
          <circle
            cx="8"
            cy="8"
            r={RADIUS}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            opacity="0.2"
          />
          <circle
            cx="8"
            cy="8"
            r={RADIUS}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={CIRCUMFERENCE * (1 - share)}
            className="transition-[stroke-dashoffset] duration-(--duration-enter) ease-(--ease-out) motion-reduce:transition-none"
          />
        </svg>
      )}
    </span>
  );
}
