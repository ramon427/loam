/*
 * CSS snippets are the user's own stylesheets, laid over the app's. The window's policy lets
 * images load from any https address, so a snippet could otherwise make the app fetch from a
 * server as it draws (and say what it drew, through attribute selectors). These rules keep a
 * snippet to the window: no imports, and no addresses but data: ones.
 */

/** Escapes could spell `url(` or `@import` without those letters; snippets don't need them. */
const ESCAPE = /\\[0-9a-f]{1,6}\s?|\\./gi;
const IMPORT = /@import\b[^;]*;?/gi;
const URL_FUNCTION = /\burl\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi;
/** Functions that take a bare string as an address. */
const STRING_ADDRESS_FUNCTIONS = /\b(?:-webkit-)?(?:image-set|src)\(/gi;

export const sanitizeSnippetCss = (css: string): string =>
  css
    .replace(ESCAPE, "")
    .replace(IMPORT, "")
    .replace(URL_FUNCTION, (match, double?: string, single?: string, bare?: string) =>
      /^data:/i.test((double ?? single ?? bare ?? "").trim()) ? match : "none",
    )
    .replace(STRING_ADDRESS_FUNCTIONS, "blocked-address(");

/** The snippets switched on, in file order, as one sheet. */
export const compileSnippetsCss = (snippets: readonly { file: string; css: string }[]) =>
  snippets
    .map(({ file, css }) => `/* ${file.replace(/\*\//g, "")} */\n${sanitizeSnippetCss(css)}`)
    .join("\n");
