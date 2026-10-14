import type { CSSProperties } from "react";

import {
  getBlockPreviewExample,
  type BlockPreviewKind,
  type BlockPreviewLine,
} from "./blockTypePreviewModel";
import { editorStyles as styles } from "./blockNoteStyles";

type BlockPreviewCardProps = {
  kind: BlockPreviewKind;
  title: string;
  description?: string;
  /** Beside the slash menu, or at fixed viewport coordinates next to another menu. */
  placement: "slash-menu" | { left: number; top: number };
};

/** A sample of what a block type looks like, shown while its menu item is highlighted. */
export function BlockPreviewCard({ kind, title, description, placement }: BlockPreviewCardProps) {
  const preview = getBlockPreviewExample(kind, title, description);
  const style: CSSProperties | undefined =
    placement === "slash-menu" ? undefined : { left: placement.left, top: placement.top };
  return (
    <aside
      className={`${styles.blockPreviewCard} ${
        placement === "slash-menu" ? styles.slashMenuPreview : styles.blockPreviewCardFloating
      }`}
      style={style}
      data-preview-kind={kind}
      aria-hidden="true"
    >
      <div className={styles.blockPreviewVisual}>
        <PreviewVisual preview={preview} />
      </div>
      <div className={styles.blockPreviewBody}>
        <div className={styles.blockPreviewTitle}>{preview.title}</div>
        {preview.description ? (
          <div className={styles.blockPreviewDescription}>{preview.description}</div>
        ) : null}
      </div>
    </aside>
  );
}

function PreviewVisual({ preview }: { preview: ReturnType<typeof getBlockPreviewExample> }) {
  switch (preview.variant) {
    case "image":
      return (
        <div className={styles.blockPreviewImageFrame}>
          <span className={styles.blockPreviewImageSun} />
          <span className={styles.blockPreviewImageMountain} />
          <span className={styles.blockPreviewImageCaption}>Photo</span>
        </div>
      );
    case "table":
      return (
        <div className={styles.blockPreviewTable}>
          {preview.table?.flatMap((row, rowIndex) =>
            row.map((cell, cellIndex) => (
              <span
                key={`${rowIndex}-${cellIndex}`}
                className={
                  rowIndex === 0 ? styles.blockPreviewTableHeader : styles.blockPreviewTableCell
                }
              >
                {cell}
              </span>
            )),
          )}
        </div>
      );
    case "columns":
      return (
        <div
          className={styles.blockPreviewColumns}
          data-column-count={preview.columns?.length ?? 2}
        >
          {preview.columns?.map((column) => (
            <div key={column.join("::")} className={styles.blockPreviewColumn}>
              <strong>{column[0]}</strong>
              <span>{column[1]}</span>
            </div>
          ))}
        </div>
      );
    case "divider":
      return (
        <div className={styles.blockPreviewPaper}>
          {preview.lines[0] ? <PreviewLine line={preview.lines[0]} /> : null}
          <span className={styles.blockPreviewDividerLine} />
          {preview.lines[1] ? <PreviewLine line={preview.lines[1]} /> : null}
        </div>
      );
    default:
      return (
        <div className={styles.blockPreviewPaper}>
          {preview.lines.map((line) => (
            <PreviewLine key={`${line.kind}:${line.marker ?? ""}:${line.text}`} line={line} />
          ))}
        </div>
      );
  }
}

const lineClassName: Record<BlockPreviewLine["kind"], string | undefined> = {
  bullet: styles.blockPreviewExampleBullet,
  check: styles.blockPreviewExampleCheckLine,
  heading: styles.blockPreviewExampleHeading,
  number: styles.blockPreviewExampleNumber,
  quote: styles.blockPreviewExampleQuote,
  text: styles.blockPreviewExampleTextLine,
  toggle: styles.blockPreviewExampleToggle,
};

function PreviewLine({ line }: { line: BlockPreviewLine }) {
  let leading = null;
  if (line.kind === "check") {
    leading = (
      <span
        className={styles.blockPreviewExampleCheck}
        data-checked={line.checked ? "true" : undefined}
        aria-hidden="true"
      />
    );
  } else if (line.marker) {
    leading = (
      <span className={styles.blockPreviewExampleMarker} aria-hidden="true">
        {line.marker}
      </span>
    );
  }
  return (
    <div className={`${styles.blockPreviewExampleLine} ${lineClassName[line.kind]}`}>
      {leading}
      <span className={styles.blockPreviewExampleText}>{line.text}</span>
    </div>
  );
}
