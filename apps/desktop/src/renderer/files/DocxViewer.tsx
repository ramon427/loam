import { useEffect, useRef, useState } from "react";
import { renderAsync } from "docx-preview";

/**
 * A Word document to read, laid out in pages with its headers, footers,
 * footnotes, comments and tracked changes. Loam doesn't edit Word
 * documents; the tab opens them in Word for that.
 */
export default function DocxViewer({ bytes }: { bytes: Uint8Array }) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const styleRef = useRef<HTMLDivElement | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const body = bodyRef.current!;
    let active = true;
    setFailed(false);
    renderAsync(new Blob([bytes.slice()]), body, styleRef.current!, {
      className: "docx",
      inWrapper: true,
      breakPages: true,
      renderHeaders: true,
      renderFooters: true,
      renderFootnotes: true,
      renderEndnotes: true,
      renderComments: true,
      renderChanges: true,
      // Embedded HTML and other documents would run as pages of their own.
      renderAltChunks: false,
    }).catch(() => {
      if (active) setFailed(true);
    });
    return () => {
      active = false;
      body.replaceChildren();
    };
  }, [bytes]);

  return (
    <div className="relative h-full">
      {failed ? (
        <p className="py-16 text-center text-sm text-(--app-muted)">
          This Word document can't be shown.
        </p>
      ) : null}
      <div ref={styleRef} hidden />
      {/* The document's own colors, on a page of its own, whatever the app's theme. */}
      <div
        ref={bodyRef}
        aria-label="Word document"
        className="absolute inset-0 overflow-auto bg-(--app-surface-2) text-black [&_.docx-wrapper]:bg-transparent! [&_.docx-wrapper]:py-6!"
      />
    </div>
  );
}
