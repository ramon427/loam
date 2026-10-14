/**
 * Parses CSV as RFC 4180 describes: quoted fields may hold commas, quotes
 * (doubled) and line breaks; rows end with LF or CRLF; a leading BOM is ignored.
 */
export const parseCsv = (text: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };
  const input = text.replace(/^\uFEFF/, "");
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]!;
    if (quoted) {
      // A doubled quote is a quote; a single one ends the quoted part.
      if (character !== '"') field += character;
      else if (input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else quoted = false;
      continue;
    }
    if (character === '"' && field === "") quoted = true;
    else if (character === ",") endField();
    else if (character === "\n" || character === "\r") {
      if (character === "\r" && input[index + 1] === "\n") index += 1;
      endRow();
    } else field += character;
  }
  if (field !== "" || row.length > 0) endRow();
  return rows;
};
