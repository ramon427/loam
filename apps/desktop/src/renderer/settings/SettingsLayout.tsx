import { createContext, useContext, useEffect, useId, useState, type ReactNode } from "react";
import { ChevronRightIcon } from "lucide-react";

import { cn } from "@loam/notes-ui/ui/cn";
import { Notice, type NoticeProps } from "@loam/notes-ui/ui/Notice";

import styles from "./settings.module.css";

const SettingsBusyContext = createContext<(busy: boolean) => void>(() => undefined);

/** Settings stays on the current section until its operation finishes. */
export const SettingsBusyProvider = SettingsBusyContext.Provider;

export function useSettingsBusy(busy: boolean) {
  const setBusy = useContext(SettingsBusyContext);
  useEffect(() => {
    setBusy(busy);
    return () => setBusy(false);
  }, [busy, setBusy]);
}

/**
 * A titled card of rows, so a page of settings reads as groups: a quiet title
 * above, then rows apart by thin lines. Without a title it is the page's
 * first card, under the page's own title in the header.
 */
export function SettingsSection({
  title,
  description,
  children,
}: {
  title?: string;
  description?: string;
  children: ReactNode;
}) {
  const titleId = useId();
  return (
    <section className={styles.section} aria-labelledby={title ? titleId : undefined}>
      {title || description ? (
        <header className={styles.sectionHeader}>
          {title ? <h2 id={titleId}>{title}</h2> : null}
          {description ? <p>{description}</p> : null}
        </header>
      ) : null}
      <div className={styles.card}>{children}</div>
    </section>
  );
}

/**
 * One setting: what it is on the left, with how it stands under that, and
 * its control on the right. `children` run the full width below, such as a
 * list of backups.
 */
export function SettingsRow({
  title,
  description,
  status,
  control,
  children,
}: {
  title: string;
  description?: ReactNode;
  status?: ReactNode;
  control?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className={styles.row} data-slot="settings-row">
      <div className={styles.rowMain}>
        <div className={styles.rowText}>
          <h3>{title}</h3>
          {description ? <p className={styles.rowDescription}>{description}</p> : null}
          {status ? <div className={styles.rowStatus}>{status}</div> : null}
        </div>
        {control ? <div className={styles.rowControl}>{control}</div> : null}
      </div>
      {children ? <div className={styles.rowBody}>{children}</div> : null}
    </div>
  );
}

/** Secondary information stays available without crowding the primary rows. */
export function SettingsDetails({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const contentId = useId();
  return (
    <div>
      <button
        type="button"
        className={styles.detailsToggle}
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen(!open)}
      >
        <ChevronRightIcon
          className={cn("size-3.5 transition-transform", open && "rotate-90")}
          aria-hidden
        />
        {label}
      </button>
      <div id={contentId} className={styles.detailsContent} hidden={!open}>
        {children}
      </div>
    </div>
  );
}

/** Supporting copy, in a row of its own. */
export function SettingsNote({ children }: { children: ReactNode }) {
  return <p className={styles.note}>{children}</p>;
}

/** A notice that sits directly in a section's card, inset from its edges. */
export function SettingsNotice({ className, ...props }: NoticeProps) {
  return <Notice className={cn(styles.cardNotice, className)} {...props} />;
}
