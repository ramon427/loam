import { lookup } from "node:dns";
import http, { type IncomingMessage } from "node:http";
import https from "node:https";
import { isIP, type LookupFunction } from "node:net";

import { z } from "zod";

import { StoreError } from "@loam/storage/storeError";

import type { ChatTool } from "./chatTools";
import { isPublicAddress } from "./publicAddress";

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_TEXT = 60_000;
const TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 5;

const notPublic = () =>
  new StoreError(
    "Loam reads only public web pages, not this computer or its local network.",
    "FORBIDDEN",
    403,
  );

/**
 * Looks a host up as the system does, but refuses it when any of its
 * addresses isn't public. The connection uses the addresses checked here, so
 * a name that resolves differently a moment later can't slip through.
 */
const publicLookup: LookupFunction = (hostname, options, callback) => {
  lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, "");
    if (addresses.length === 0 || !addresses.every(({ address }) => isPublicAddress(address)))
      return callback(notPublic(), "");
    if (options.all) return callback(null, addresses);
    callback(null, addresses[0]!.address, addresses[0]!.family);
  });
};

/** Requests `url` once, without following a redirect. */
const request = (url: URL, signal: AbortSignal) => {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  // An address in the URL is connected to without a lookup.
  if (isIP(host) && !isPublicAddress(host)) throw notPublic();
  return new Promise<IncomingMessage>((resolve, reject) => {
    (url.protocol === "https:" ? https : http)
      .get(
        url,
        {
          lookup: publicLookup,
          signal,
          headers: {
            Accept: "text/html,text/plain;q=0.9,*/*;q=0.5",
            "Accept-Encoding": "identity",
          },
        },
        resolve,
      )
      .on("error", reject);
  });
};

/** The page's first `MAX_BYTES`; the rest is never read. */
const readCapped = async (response: IncomingMessage) => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of response) {
    const part = chunk as Buffer;
    chunks.push(part.subarray(0, MAX_BYTES - size));
    size += part.length;
    if (size >= MAX_BYTES) break;
  }
  response.destroy();
  return Buffer.concat(chunks).toString("utf8");
};

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** A page's readable text: no scripts, styles or tags, one line per block. */
export const htmlToText = (html: string) =>
  html
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (entity, code: string) => {
      if (code[0] !== "#") return ENTITIES[code.toLowerCase()] ?? entity;
      const value =
        code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return Number.isFinite(value) && value > 0 && value < 0x110000
        ? String.fromCodePoint(value)
        : entity;
    })
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/**
 * Reads a web page as text, for providers without a web tool of their own.
 * It fetches the page without the user's cookies or sign-ins.
 */
export const webReadTool: ChatTool = {
  name: "loam_web_read",
  description:
    "Fetch a public web page and return its title and readable text. For pages that need JavaScript or a sign-in, use loam_browser_open instead.",
  inputSchema: z.strictObject({ url: z.string().max(4000) }),
  access: "web",
  describe: async (input) => {
    try {
      return { label: `Read ${new URL(String(input.url)).host}`, noteId: null };
    } catch {
      return { label: "Read a web page", noteId: null };
    }
  },
  async run(input) {
    const signal = AbortSignal.timeout(TIMEOUT_MS);
    let url = new URL(String(input.url));
    let response: IncomingMessage;
    // Redirects are followed here, so each address they lead to is checked too.
    for (let hops = 0; ; hops++) {
      if (url.protocol !== "https:" && url.protocol !== "http:")
        throw new StoreError("Only http and https pages can be read.", "VALIDATION_ERROR", 400);
      response = await request(url, signal);
      const status = response.statusCode ?? 0;
      const location = response.headers.location;
      if (status < 300 || status >= 400 || !location) break;
      response.destroy();
      if (hops >= MAX_REDIRECTS)
        throw new StoreError("The page redirects too many times.", "UNAVAILABLE", 502);
      url = new URL(location, url);
    }
    const status = response.statusCode ?? 0;
    if (status < 200 || status >= 300) {
      response.destroy();
      throw new StoreError(`The page answered ${status}.`, "UNAVAILABLE", 502);
    }
    const type = response.headers["content-type"] ?? "";
    if (!/text|html|json|xml/.test(type)) {
      response.destroy();
      throw new StoreError(
        `That address is a ${type || "file"}, not a page.`,
        "VALIDATION_ERROR",
        415,
      );
    }
    const raw = await readCapped(response);
    const isHtml = /html/.test(type);
    const text = isHtml ? htmlToText(raw) : raw;
    const title = isHtml ? htmlToText(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(raw)?.[1] ?? "") : "";
    return {
      result: {
        url: url.href,
        title,
        text: text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}\n… (cut off)` : text,
      },
      undo: null,
    };
  },
};
