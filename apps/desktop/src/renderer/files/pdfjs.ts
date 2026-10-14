import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import PdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?worker";

// One worker reads every PDF the window opens.
GlobalWorkerOptions.workerPort ??= new PdfWorker();

/** Opens a PDF's bytes; the worker takes the bytes it is given, so it gets a copy. */
export const openPdf = (bytes: Uint8Array) =>
  getDocument({ data: bytes.slice(), isEvalSupported: false });

/** A PDF's text, page after page, up to `maxChars`. */
export async function readPdfText(bytes: Uint8Array, maxChars: number) {
  const loading = openPdf(bytes);
  try {
    const document = await loading.promise;
    const pages: string[] = [];
    let length = 0;
    for (let number = 1; number <= document.numPages && length < maxChars; number++) {
      const content = await (await document.getPage(number)).getTextContent();
      const text = content.items.map((item) => ("str" in item ? item.str : "")).join(" ");
      pages.push(text);
      length += text.length;
    }
    return pages.join("\n\n").slice(0, maxChars);
  } finally {
    void loading.destroy();
  }
}
