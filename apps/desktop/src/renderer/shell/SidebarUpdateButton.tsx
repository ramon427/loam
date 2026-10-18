import { useEffect, useRef, useState } from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import {
  CheckIcon,
  CircleAlertIcon,
  DownloadIcon,
  ExternalLinkIcon,
  RefreshCwIcon,
  RotateCwIcon,
} from "lucide-react";

import type { BridgeUpdateStatus } from "@loam/shared/bridge/loamBridge";
import { clamp } from "../lib/clamp";
import { useUpdateStatus } from "../settings/queries";
import { Button } from "../ui/Button";
import { cn } from "../ui/cn";
import { PopoverContent } from "../ui/Popover";

import {
  openReleasePage,
  RELEASES_URL,
  releaseUrl,
  useCheckForUpdates,
  useInstallUpdate,
} from "./useAppUpdates";

const describe = (update: BridgeUpdateStatus) => {
  if (update.state === "checking") return "Checking for updates…";
  if (update.state === "available")
    return update.version
      ? `Download version ${update.version} from GitHub`
      : "Download the new version from GitHub";
  if (update.state === "downloading")
    return `Downloading ${update.version ?? "the update"}… ${update.progress ?? 0}%`;
  if (update.state === "ready") return `Restart to install version ${update.version ?? ""}`.trim();
  if (update.state === "error")
    return `${update.error ?? "Could not check for updates."} Check again`;
  return "Check for updates";
};

const PROGRESS_RADIUS = 12;
const PROGRESS_CIRCUMFERENCE = 2 * Math.PI * PROGRESS_RADIUS;

function DownloadProgressIcon({ percent }: { percent: number }) {
  const clamped = clamp(percent, 0, 100);
  return (
    <span className="relative grid size-7 place-items-center">
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 size-full -rotate-90"
        viewBox="0 0 28 28"
      >
        <circle
          cx="14"
          cy="14"
          r={PROGRESS_RADIUS}
          fill="none"
          className="stroke-current opacity-20"
          strokeWidth="1.5"
        />
        <circle
          cx="14"
          cy="14"
          r={PROGRESS_RADIUS}
          fill="none"
          stroke="currentColor"
          strokeDasharray={PROGRESS_CIRCUMFERENCE}
          strokeDashoffset={PROGRESS_CIRCUMFERENCE * (1 - clamped / 100)}
          strokeLinecap="round"
          strokeWidth="1.5"
          className="transition-[stroke-dashoffset] duration-300 ease-out motion-reduce:transition-none"
        />
      </svg>
      <DownloadIcon className="size-4" aria-hidden="true" />
    </span>
  );
}

function ReadyIcon() {
  return (
    <span className="relative grid size-4 place-items-center">
      <RotateCwIcon className="size-4" aria-hidden="true" />
      <span className="absolute -right-1 -bottom-1 grid size-2.5 place-items-center rounded-full bg-(--app-accent) text-(--app-accent-foreground) ring-2 ring-(--app-page)">
        <CheckIcon className="size-2" strokeWidth={4} aria-hidden="true" />
      </span>
    </span>
  );
}

function AvailableIcon() {
  return (
    <span className="relative grid size-4 place-items-center">
      <DownloadIcon className="size-4" aria-hidden="true" />
      <span className="absolute -right-0.5 -bottom-0.5 size-2 rounded-full bg-(--app-accent) ring-2 ring-(--app-page)" />
    </span>
  );
}

function StatusIcon({ update }: { update: BridgeUpdateStatus }) {
  if (update.state === "downloading")
    return <DownloadProgressIcon percent={update.progress ?? 0} />;
  if (update.state === "ready") return <ReadyIcon />;
  if (update.state === "available") return <AvailableIcon />;
  const Icon = update.state === "error" ? CircleAlertIcon : RefreshCwIcon;
  return (
    <Icon
      className={cn(
        "size-4",
        update.state === "checking" && "animate-spin motion-reduce:animate-none",
        update.state === "error" && "text-(--status-warning)",
      )}
      aria-hidden="true"
    />
  );
}

function ReleaseLink({ href, children }: { href: string; children: string }) {
  // The window opens new-window links in the browser.
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="mt-2 inline-flex items-center gap-1 rounded-sm text-xs leading-5 text-(--muted-text) underline decoration-dotted underline-offset-4 outline-none hover:text-(--text) focus-visible:ring-2 focus-visible:ring-(--app-focus-ring)"
    >
      {children}
      <ExternalLinkIcon className="size-3 shrink-0" aria-hidden="true" />
    </a>
  );
}

/** What changed in the releases being installed, newest first. */
function UpdateReleaseNotes({ update }: { update: BridgeUpdateStatus }) {
  return (
    <div className="flex max-w-[min(24rem,calc(100vw-2rem))] flex-col text-left">
      <div className="px-1 text-sm leading-5 font-medium">{describe(update)}</div>
      <div className="max-h-[min(28rem,calc(100vh-6rem))] overflow-y-auto px-1 pt-3 pb-1">
        {update.releaseNotes.map((note, index) => {
          const omitted = Math.max(0, note.totalItems - note.items.length);
          return (
            <section
              key={note.version}
              className={index > 0 ? "mt-3 border-t border-(--app-border) pt-3" : undefined}
            >
              <h3 className="text-xs leading-4 font-semibold">
                {index === 0 ? "What's changed" : `Changes in ${note.version}`}
              </h3>
              <ul className="mt-2 space-y-1.5 pl-4 text-xs leading-5">
                {note.items.map((item, itemIndex) => (
                  <li key={itemIndex} className="list-disc break-words">
                    {item}
                  </li>
                ))}
              </ul>
              <ReleaseLink href={releaseUrl(note.version)}>
                {omitted === 0
                  ? "View release on GitHub"
                  : `${omitted} more ${omitted === 1 ? "change" : "changes"} on GitHub`}
              </ReleaseLink>
            </section>
          );
        })}
        {update.omittedReleaseCount > 0 ? (
          <div className="mt-3 border-t border-(--app-border) pt-1">
            <ReleaseLink href={RELEASES_URL}>
              {`${update.omittedReleaseCount} older ${update.omittedReleaseCount === 1 ? "release" : "releases"} on GitHub`}
            </ReleaseLink>
          </div>
        ) : null}
      </div>
    </div>
  );
}

const CLOSE_DELAY_MS = 150;

/**
 * The icon-only update control at the end of the sidebar's footer, out of the
 * way until there is something to do: it checks for updates (spinning while it does), shows a download's
 * progress as a ring, and restarts into an update once it has downloaded. On
 * macOS, which can't install the update itself, it opens the new version's
 * release page instead. While an update is available, downloads or waits,
 * hovering or focusing it shows what changed. Copies that don't look for
 * updates (development runs) show nothing.
 */
export function SidebarUpdateButton() {
  const status = useUpdateStatus();
  const check = useCheckForUpdates();
  const install = useInstallUpdate();
  const [notesOpen, setNotesOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(closeTimer.current), []);

  const update = status.data;
  const hasNotes =
    (update?.state === "available" ||
      update?.state === "downloading" ||
      update?.state === "ready") &&
    update.releaseNotes.length > 0;
  useEffect(() => {
    if (!hasNotes) setNotesOpen(false);
  }, [hasNotes]);

  if (!update || update.state === "unavailable") return null;

  const showNotes = () => {
    clearTimeout(closeTimer.current);
    if (hasNotes) setNotesOpen(true);
  };
  const hideNotes = () => {
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setNotesOpen(false), CLOSE_DELAY_MS);
  };
  const label = describe(update);
  const pending = update.state === "ready" ? install.isPending : check.isPending;
  // Not disabled or aria-disabled: both block pointer events, and hovering shows the changelog.
  const busy = update.state === "checking" || update.state === "downloading" || pending;

  return (
    <PopoverPrimitive.Root open={notesOpen} onOpenChange={setNotesOpen}>
      <PopoverPrimitive.Anchor asChild>
        <Button
          variant={
            update.state === "ready" || update.state === "available" ? "ghost" : "ghost-muted"
          }
          size="icon-sm"
          className={cn("ml-auto", busy && "cursor-default")}
          aria-label={label}
          title={hasNotes ? undefined : label}
          data-no-tooltip={hasNotes ? "" : undefined}
          data-testid="sidebar-update-button"
          data-state={update.state}
          onPointerEnter={showNotes}
          onPointerLeave={hideNotes}
          onFocus={(event) => {
            if (event.currentTarget.matches(":focus-visible")) showNotes();
          }}
          onBlur={hideNotes}
          onClick={() => {
            if (update.state === "available") return openReleasePage(update.version);
            if (busy) return;
            if (update.state === "ready") install.mutate();
            else check.mutate();
          }}
        >
          <StatusIcon update={update} />
        </Button>
      </PopoverPrimitive.Anchor>
      {hasNotes ? (
        <PopoverPrimitive.Portal>
          <PopoverContent
            side="top"
            align="end"
            className="p-3"
            aria-label="Update release notes"
            onOpenAutoFocus={(event) => event.preventDefault()}
            onCloseAutoFocus={(event) => event.preventDefault()}
            onPointerEnter={showNotes}
            onPointerLeave={hideNotes}
            onFocus={showNotes}
            onBlur={hideNotes}
          >
            <UpdateReleaseNotes update={update} />
          </PopoverContent>
        </PopoverPrimitive.Portal>
      ) : null}
    </PopoverPrimitive.Root>
  );
}
