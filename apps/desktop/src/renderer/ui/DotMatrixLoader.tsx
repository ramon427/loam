import { cn } from "./cn";
import styles from "./dotMatrixLoader.module.css";

/** Each dot's delay: a chevron that sweeps across the grid from the left. */
const DELAYS_MS = [0, 1, 2].flatMap((row) =>
  [0, 1, 2].map((column) => (column + Math.abs(row - 1)) * 90),
);

/**
 * Something is at work: a 3×3 grid of dots that light up in a wave. Still,
 * with every dot half lit, when motion is reduced.
 */
export function DotMatrixLoader({ label, className }: { label?: string; className?: string }) {
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn(styles.grid, className)}
    >
      {DELAYS_MS.map((delay, index) => (
        <span
          // The grid never changes.
          key={index}
          className={styles.dot}
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </span>
  );
}
