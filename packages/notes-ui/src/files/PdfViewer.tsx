import { useEffect, useEffectEvent, useRef, useState } from "react";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  MoveHorizontalIcon,
  SearchIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  EventBus,
  LinkTarget,
  PDFFindController,
  PDFLinkService,
  PDFViewer,
} from "pdfjs-dist/web/pdf_viewer.mjs";
import "pdfjs-dist/web/pdf_viewer.css";

import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { openPdf } from "./pdfjs";
import { clamp } from "../lib/clamp";

/** How long the PDF stays on a page before the page is told, so scrolling past pages isn't. */
const PAGE_SETTLE_MS = 1000;
const ZOOM_STEP = 1.2;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 5;

/** What the toolbar does to the viewer. */
const controlsFor = (viewer: PDFViewer, eventBus: EventBus) => ({
  zoom(factor: number) {
    viewer.currentScale = clamp(viewer.currentScale * factor, MIN_ZOOM, MAX_ZOOM);
  },
  fitWidth() {
    viewer.currentScaleValue = "page-width";
  },
  find(query: string, findPrevious: boolean) {
    eventBus.dispatch("find", {
      source: null,
      type: "again",
      query,
      caseSensitive: false,
      entireWord: false,
      highlightAll: true,
      findPrevious,
      matchDiacritics: false,
    });
  },
});

type ViewerControls = ReturnType<typeof controlsFor>;

/**
 * A PDF to read: pages with selectable text and working links, zoom, find,
 * and the page it was left at. `onPageChange` hears the page as it changes.
 */
export default function PdfViewer({
  bytes,
  initialPage,
  onPageChange,
}: {
  bytes: Uint8Array;
  initialPage?: number;
  onPageChange: (page: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const controlsRef = useRef<ViewerControls | null>(null);
  const [pages, setPages] = useState({ current: 1, count: 0 });
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const openAt = useEffectEvent(() => initialPage);
  const reportPage = useEffectEvent((page: number) => onPageChange(page));

  useEffect(() => {
    const container = containerRef.current!;
    const eventBus = new EventBus();
    const linkService = new PDFLinkService({ eventBus, externalLinkTarget: LinkTarget.BLANK });
    const findController = new PDFFindController({ eventBus, linkService });
    const viewer = new PDFViewer({ container, eventBus, linkService, findController });
    linkService.setViewer(viewer);
    controlsRef.current = controlsFor(viewer, eventBus);
    eventBus.on("pagesinit", () => {
      viewer.currentScaleValue = "page-width";
      const page = openAt();
      if (page && page <= viewer.pagesCount) viewer.currentPageNumber = page;
      setPages({ current: viewer.currentPageNumber, count: viewer.pagesCount });
    });
    let pageTimer: number | undefined;
    eventBus.on("pagechanging", ({ pageNumber }: { pageNumber: number }) => {
      setPages((current) => ({ ...current, current: pageNumber }));
      window.clearTimeout(pageTimer);
      pageTimer = window.setTimeout(() => reportPage(pageNumber), PAGE_SETTLE_MS);
    });

    let document: PDFDocumentProxy | null = null;
    const loading = openPdf(bytes);
    loading.promise.then(
      (loaded) => {
        document = loaded;
        viewer.setDocument(loaded);
        linkService.setDocument(loaded);
      },
      () => setFailed(true),
    );
    return () => {
      window.clearTimeout(pageTimer);
      controlsRef.current = null;
      void loading.destroy();
      void document?.destroy();
    };
  }, [bytes]);

  const zoom = (factor: number) => controlsRef.current?.zoom(factor);
  const find = (findPrevious = false) => controlsRef.current?.find(query, findPrevious);

  if (failed)
    return (
      <p className="py-16 text-center text-sm text-(--app-muted)">This PDF can't be opened.</p>
    );

  return (
    <div className="flex h-full flex-col">
      <div
        role="toolbar"
        aria-label="PDF"
        className="flex shrink-0 items-center gap-1 border-b border-(--app-border) px-2 py-1"
      >
        <span className="shrink-0 px-2 text-xs whitespace-nowrap text-(--app-muted) tabular-nums">
          {pages.count ? `Page ${pages.current} of ${pages.count}` : "Loading…"}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Zoom out"
          onClick={() => zoom(1 / ZOOM_STEP)}
        >
          <ZoomOutIcon />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Zoom in" onClick={() => zoom(ZOOM_STEP)}>
          <ZoomInIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Fit to width"
          onClick={() => controlsRef.current?.fitWidth()}
        >
          <MoveHorizontalIcon />
        </Button>
        <form
          className="ml-auto flex min-w-0 items-center gap-1"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            find();
          }}
        >
          <SearchIcon aria-hidden="true" className="size-3.5 shrink-0 text-(--app-muted)" />
          <Input
            aria-label="Find in PDF"
            placeholder="Find"
            value={query}
            exitOnCommitKeys={false}
            className="h-7 w-40 min-w-16 shrink"
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              find(event.shiftKey);
            }}
          />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Previous match"
            onClick={() => find(true)}
          >
            <ChevronUpIcon />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Next match" onClick={() => find()}>
            <ChevronDownIcon />
          </Button>
        </form>
      </div>
      <div className="relative min-h-0 flex-1">
        {/* pdf.js lays pages out in an absolutely placed, scrolling container. */}
        <div ref={containerRef} className="absolute inset-0 overflow-auto bg-(--app-surface-2)">
          <div className="pdfViewer" />
        </div>
      </div>
    </div>
  );
}
