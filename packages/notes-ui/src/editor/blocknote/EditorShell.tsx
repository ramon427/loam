import type { ReactNode } from "react";
import { useLayoutEffect, useRef } from "react";
import { useReducedMotion } from "framer-motion";

import { cn } from "../../ui/cn";
import { FAST_MOTION_MS, STANDARD_EASING } from "../../styles/motion";
import { blockNoteEditorRootClassName, editorStyles as styles } from "./blockNoteStyles";
import { EditorPortal } from "./EditorPortal";

type EditorShellProps = {
  isActive: boolean;
  /** Names the tab in view; new content starts at its top and fades in. */
  contentKey: string;
  rootClassName?: string;
  containerClassName?: string;
  /** Shown above the content, inside the editor's frame (a host's title or tab row). */
  header?: ReactNode;
  children: ReactNode;
};

/** Frames the open tab's content and gives the editor's menus a styled portal. */
export const EditorShell = ({
  isActive,
  contentKey,
  rootClassName,
  containerClassName,
  header,
  children,
}: EditorShellProps) => {
  const prefersReducedMotion = useReducedMotion() ?? false;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const previousContentKeyRef = useRef(contentKey);

  // New content starts at its top.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root?.isConnected) return;
    for (let node: HTMLElement | null = root; node; node = node.parentElement) {
      node.scrollTop = 0;
      node.scrollLeft = 0;
    }
  }, [contentKey]);

  // A new tab fades in on this element, which stays mounted while the tabs
  // inside it change.
  useLayoutEffect(() => {
    const previousContentKey = previousContentKeyRef.current;
    previousContentKeyRef.current = contentKey;
    const content = contentRef.current;
    if (
      previousContentKey === contentKey ||
      prefersReducedMotion ||
      typeof content?.animate !== "function"
    ) {
      return;
    }
    const animation = content.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: FAST_MOTION_MS,
      easing: `cubic-bezier(${STANDARD_EASING.join(", ")})`,
    });
    return () => animation.cancel();
  }, [contentKey, prefersReducedMotion]);

  return (
    <div
      ref={rootRef}
      data-editor-active={isActive ? "true" : "false"}
      className={cn(
        "flex min-h-[360px] min-h-full w-full flex-col bg-transparent",
        styles.editorRoot,
        blockNoteEditorRootClassName,
        rootClassName,
      )}
    >
      {header}
      <div
        data-slot="editor-container"
        className={cn(styles.editorContainer, "px-0 pb-0", containerClassName)}
      >
        <div ref={contentRef} data-slot="editor-content-switch" className={styles.editorShell}>
          {/* Menus render under body, so the portal takes the editor's classes for its styles and theme. */}
          <EditorPortal
            className={cn(styles.editorRoot, blockNoteEditorRootClassName, rootClassName)}
            isActive={isActive}
          >
            {children}
          </EditorPortal>
        </div>
      </div>
    </div>
  );
};
