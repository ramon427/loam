/**
 * Shared toast adapter. Apps may wrap this with theme or loading icons.
 */

import type { CSSProperties } from "react";
import { CircleCheckIcon, InfoIcon, CircleAlertIcon, CircleXIcon } from "lucide-react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

const Toaster = ({ icons, toastOptions, ...props }: ToasterProps) => {
  return (
    <Sonner
      position="top-center"
      expand
      closeButton
      duration={4500}
      theme="system"
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <CircleAlertIcon className="size-4" />,
        error: <CircleXIcon className="size-4" />,
        ...icons,
      }}
      style={
        {
          "--normal-bg": "color-mix(in srgb, var(--app-surface) var(--glass-opacity), transparent)",
          "--normal-text": "var(--app-text)",
          "--normal-border": "var(--app-border)",
          "--border-radius": "var(--radius)",
          zIndex: 70,
        } as CSSProperties
      }
      toastOptions={{
        ...toastOptions,
        style: {
          ...toastOptions?.style,
          userSelect: "text",
          WebkitUserSelect: "text",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
