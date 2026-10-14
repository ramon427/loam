import { toastError, toastSuccess } from "../ui/toast";

const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!,
  );

/**
 * Puts a link on the clipboard: as an HTML link named `text`, which a note's editor pastes as
 * that link, and as the bare href for plain text.
 */
export async function copyLink(href: string, text: string) {
  const html = `<a href="${escapeHtml(href)}">${escapeHtml(text)}</a>`;
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([href], { type: "text/plain" }),
      }),
    ]);
    toastSuccess("Link copied");
  } catch {
    toastError("Link not copied");
  }
}
