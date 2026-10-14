import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { XIcon } from "lucide-react";

import { cn } from "./cn";
import { Button } from "./Button";
import { raisedPanelClass } from "../styles/controlSurface";

const Dialog = DialogPrimitive.Root;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      className={cn(
        "fixed inset-0 top-[var(--app-viewport-top,0px)] z-50 bg-black/40 backdrop-blur-none dark:bg-black/55",
        className,
      )}
      {...props}
    />
  );
}

/**
 * Returns focus to whatever had it when the dialog opened. It mounts inside the portal, so it
 * reads that element on each open, before a child's autoFocus moves focus.
 */
function FocusReturningContent({
  onCloseAutoFocus,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>) {
  const [opener] = React.useState(() =>
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );
  return (
    <DialogPrimitive.Content
      {...props}
      onCloseAutoFocus={(event) => {
        onCloseAutoFocus?.(event);
        if (!event.defaultPrevented && opener?.isConnected) {
          event.preventDefault();
          opener.focus();
        }
      }}
    />
  );
}

function DialogContent({
  className,
  size = "default",
  onCloseAutoFocus,
  children,
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean;
  /** Large task dialogs share the settings workspace dimensions. */
  size?: "default" | "workspace";
}) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <FocusReturningContent
        aria-modal="true"
        data-slot="dialog-content"
        className={cn(
          raisedPanelClass,
          "fixed top-[calc(50%+var(--app-viewport-top,0px)/2)] left-[50%] z-50 grid w-[calc(100%-2rem)] max-w-sm translate-x-[-50%] translate-y-[-50%] gap-4 rounded-(--radius-dialog) p-5",
          size === "workspace" &&
            "h-[var(--app-viewport-height,100dvh)] max-h-[var(--app-viewport-height,100dvh)] w-full max-w-none md:h-[calc(var(--app-viewport-height,100dvh)*0.88)] md:max-h-[calc(var(--app-viewport-height,100dvh)*0.88)] md:w-[calc(100%-48px)] md:max-w-[1200px]",
          className,
        )}
        onCloseAutoFocus={onCloseAutoFocus}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close asChild>
            <Button type="button" variant="ghost" size="icon-sm" className="absolute top-4 right-4">
              <XIcon className="size-4" />
              <span className="sr-only">Close</span>
            </Button>
          </DialogPrimitive.Close>
        )}
      </FocusReturningContent>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-2 text-left", className)} {...props} />;
}

/** The dialog's actions, at its bottom right. */
function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div className={cn("mt-1 flex flex-row flex-wrap justify-end gap-2", className)} {...props} />
  );
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn("text-base leading-6 font-semibold text-(--app-text)", className)}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn(
        "text-[13px] leading-normal font-normal text-(--app-secondary-label)",
        className,
      )}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
};
