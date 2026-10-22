import { createContext, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "../../ui/cn";
import styles from "./EditorPortal.module.css";

export const EditorPortalContext = createContext<HTMLElement | null>(null);

// Popup dismissal must not invalidate the long document's layout. Keep the
// editor's styling and React event ancestry while mounting its UI under body.
const subscribeToBody = () => () => {};
const getBody = () => document.body;
const getServerBody = () => null;

export const EditorPortal = ({
  className,
  isActive,
  children,
}: {
  className?: string;
  isActive: boolean;
  children: ReactNode;
}) => {
  const body = useSyncExternalStore(subscribeToBody, getBody, getServerBody);
  const [target, setTarget] = useState<HTMLDivElement | null>(null);

  return (
    <EditorPortalContext.Provider value={target}>
      {children}
      {body
        ? createPortal(
            <div
              ref={setTarget}
              className={cn(className, styles.host)}
              data-note-editor-portal=""
              data-editor-active={isActive ? "true" : "false"}
            />,
            body,
          )
        : null}
    </EditorPortalContext.Provider>
  );
};
