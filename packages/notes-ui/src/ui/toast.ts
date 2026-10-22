import { toast as sonnerToast, type ExternalToast } from "sonner";

type ToastMessage = Parameters<typeof sonnerToast>[0];
type ToastOptions = Pick<ExternalToast, "id" | "description" | "action" | "duration">;
type ToastKind = "success" | "error" | "warning" | "info" | "message";

const DEFAULT_DURATION = 4500;

// A toast that reuses an id replaces the earlier one, so its description and action are cleared
// unless given again.
const show = (kind: ToastKind, message: ToastMessage, options: ToastOptions = {}) =>
  sonnerToast[kind](message, {
    description: undefined,
    action: undefined,
    ...options,
    duration: options.duration ?? DEFAULT_DURATION,
  });

export const toastSuccess = (message: ToastMessage, options?: ToastOptions) =>
  show("success", message, options);
export const toastError = (message: ToastMessage, options?: ToastOptions) =>
  show("error", message, options);
export const toastWarning = (message: ToastMessage, options?: ToastOptions) =>
  show("warning", message, options);
export const toastInfo = (message: ToastMessage, options?: ToastOptions) =>
  show("info", message, options);
export const toastMessage = (message: ToastMessage, options?: ToastOptions) =>
  show("message", message, options);
export const dismissToast = (id?: string | number) => sonnerToast.dismiss(id);
