import { onTestFinished, vi } from "vitest";

/**
 * Gives the current test a clipboard that keeps what the app writes to it, for as long as the
 * test runs. `copiedLink` reads the last item as a link: its plain text and its HTML link.
 */
export function stubClipboard() {
  const written: Record<string, Blob>[] = [];
  vi.stubGlobal(
    "ClipboardItem",
    class {
      constructor(readonly items: Record<string, Blob>) {}
    },
  );
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      write: async (items: { items: Record<string, Blob> }[]) => {
        written.push(...items.map((item) => item.items));
      },
    },
  });
  onTestFinished(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, "clipboard");
  });

  return {
    written,
    copiedLink: async () => {
      const item = written.at(-1);
      if (!item?.["text/plain"] || !item["text/html"]) return null;
      const html = await item["text/html"].text();
      const link = new DOMParser().parseFromString(html, "text/html").querySelector("a");
      return {
        plainText: await item["text/plain"].text(),
        href: link?.getAttribute("href") ?? null,
        text: link?.textContent ?? null,
      };
    },
  };
}
