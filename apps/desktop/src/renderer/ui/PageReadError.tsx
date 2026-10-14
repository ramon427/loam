import { Button } from "./Button";

export type ReadRecoveryState = "unavailable" | "first-load" | "stale";

/** Replaces unavailable page content; query owners retain data and control retry. */
export function PageReadError({
  state,
  onRetry,
  pending = false,
  waiting = false,
}: {
  state: ReadRecoveryState;
  onRetry: () => void;
  pending?: boolean;
  waiting?: boolean;
}) {
  return (
    <div
      data-read-recovery={state}
      className="flex min-h-[60svh] flex-1 items-center justify-center px-(--page-gutter) py-16 text-center"
    >
      <section className="w-full max-w-lg" aria-label="Page unavailable">
        <div role="status" aria-live="polite" aria-atomic="true">
          <h2 className="text-2xl font-semibold tracking-tight text-(--app-text)">
            Temporarily unavailable
          </h2>
          <p className="mt-2 text-sm text-(--app-muted)">
            We couldn&apos;t load this page. Please try again.
          </p>
        </div>
        <div className="mt-6 flex justify-center">
          <Button variant="outlineMuted" size="sm" disabled={pending || waiting} onClick={onRetry}>
            Try again
          </Button>
        </div>
        {waiting ? (
          <p className="mt-3 text-xs text-(--app-muted)">Please wait before trying again.</p>
        ) : null}
      </section>
    </div>
  );
}
