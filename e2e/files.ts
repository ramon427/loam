import { writeFileSync } from "node:fs";
import { join } from "node:path";

import JSZip from "jszip";

/** A PDF with one page per string, each showing its text. */
export const buildPdf = (pages: readonly string[]) => {
  const objects: string[] = [];
  const add = (body: string) => objects.push(body) - 1 + 1;
  const catalog = add("<< /Type /Catalog /Pages 2 0 R >>");
  add(""); // The page tree, written once the pages have numbers.
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const pageIds = pages.map((text) => {
    const stream = `BT /F1 24 Tf 72 720 Td (${text.replace(/[()\\]/g, "\\$&")}) Tj ET`;
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    return add(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`,
    );
  });
  objects[1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

  let pdf = "%PDF-1.4\n";
  const offsets = objects.map((body, index) => {
    const offset = pdf.length;
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
    return offset;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return pdf;
};

/** A Word document holding one paragraph per string. */
export const buildDocx = async (paragraphs: readonly string[]) => {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${paragraphs.map((text) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`).join("")}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body>
</w:document>`,
  );
  return zip.generateAsync({ type: "uint8array" });
};

/** Writes `content` to `name` in `directory` and returns its path. */
export const writeFile = (directory: string, name: string, content: string | Uint8Array) => {
  const path = join(directory, name);
  writeFileSync(path, content);
  return path;
};
