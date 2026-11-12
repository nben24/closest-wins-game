import "server-only";
import dns from "node:dns/promises";
import net from "node:net";

/**
 * Independent source check: fetch the cited page ourselves and confirm that
 * the quoted excerpt is really on it and that it contains the answer number.
 *
 * Fetched content is untrusted data. It is never executed, never rendered as
 * HTML, and never passed to a model as instructions. Requests are limited to
 * public http(s) hosts (SSRF guard), small bodies and short timeouts.
 * A pass means "the quote exists and mentions the number" — not that the
 * question is correct. Pages we can't read (paywalls, JS-only sites) are
 * reported as inaccessible so a human reviews them.
 */

export type SourceCheckStatus = "supported" | "excerpt_not_found" | "number_not_in_excerpt" | "inaccessible" | "invalid_url";

export interface SourceCheck {
  status: SourceCheckStatus;
  detail: string;
  checkedAt: string;
  finalUrl?: string;
  pageTitle?: string;
}

const MAX_BYTES = 3_000_000;
const TIMEOUT_MS = 12_000;

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80") || v.startsWith("::ffff:127.") || v.startsWith("::ffff:10.") || v.startsWith("::ffff:192.168.");
}

async function assertPublicUrl(raw: string): Promise<URL> {
  const url = new URL(raw);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("only http(s) URLs are allowed");
  if (url.username || url.password) throw new Error("credentials in URL are not allowed");
  if (url.port && !["80", "443"].includes(url.port)) throw new Error("non-standard ports are not allowed");
  const host = url.hostname;
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) throw new Error("private host");
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  if (addrs.some((a) => isPrivateIp(a.address))) throw new Error("private address");
  return url;
}

export function htmlToText(html: string): { text: string; title: string } {
  const title = (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "").trim();
  const text = html
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d|td|th|section|article)>/gi, "\n")
    .replace(/<\/?(a|b|i|em|strong|span|sup|sub|abbr|small|mark|code|u|s|cite|q|time|data)\b[^>]*>/gi, "")
    .replace(/<[^>]+>/g, " ");
  return { text: decodeEntities(text), title: decodeEntities(title) };
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;|&rsquo;|&#8217;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&ndash;|&#8211;/g, "–")
    .replace(/&mdash;|&#8212;/g, "—")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

/** Normalize for quote matching: case, whitespace, quotes, dashes, footnote markers. */
export function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKC")
    .replace(/\[\d+\]|\[citation needed\]/g, "")
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/ ([,.;:!?)])/g, "$1")
    .trim();
}

/** Does `excerpt` appear in `page`? Allows "…"-separated fragments, each ≥ 20 chars (a bare number is not evidence). */
export function excerptInText(excerpt: string, page: string): boolean {
  const hay = normalizeForMatch(page);
  const parts = normalizeForMatch(excerpt)
    .split(/\.\.\.|…/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length === 0) return false;
  return parts.every((p) => p.length >= 20 && hay.includes(p));
}

/** Does the text mention the number in any common written form? */
export function textMentionsNumber(text: string, n: number): boolean {
  const t = normalizeForMatch(text).replace(/(\d),(?=\d{3}\b)/g, "$1").replace(/(\d) (?=\d{3}\b)/g, "$1");
  const candidates = new Set<string>();
  const abs = Math.abs(n);
  candidates.add(String(abs));
  if (!Number.isInteger(abs)) {
    candidates.add(abs.toFixed(1));
    candidates.add(abs.toFixed(2));
  }
  const words: [number, string[]][] = [[1e9, ["billion", "bn"]], [1e6, ["million", "m"]], [1e3, ["thousand"]]];
  for (const [v, names] of words) {
    if (abs >= v) {
      const x = abs / v;
      for (const s of [String(Number(x.toFixed(1))), String(Number(x.toFixed(2))), String(Number(x.toFixed(3)))]) {
        for (const w of names) candidates.add(`${s} ${w}`);
      }
    }
  }
  const small = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
  if (Number.isInteger(abs) && abs <= 12) candidates.add(small[abs]);
  return [...candidates].some((c) => new RegExp(`(^|[^0-9.])${c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![0-9])`, "i").test(t));
}

export async function fetchSourceText(rawUrl: string): Promise<{ text: string; title: string; finalUrl: string }> {
  let url = await assertPublicUrl(rawUrl);
  for (let hop = 0; hop < 4; hop++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        redirect: "manual",
        signal: ctrl.signal,
        headers: { "User-Agent": "ClosestWinsSourceCheck/1.0 (+fact verification)", Accept: "text/html,text/plain;q=0.9" },
      });
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        url = await assertPublicUrl(new URL(res.headers.get("location")!, url).toString());
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const type = res.headers.get("content-type") ?? "";
      if (!/text\/html|text\/plain|application\/xhtml/i.test(type)) throw new Error(`unsupported content type ${type.split(";")[0]}`);
      const reader = res.body?.getReader();
      if (!reader) throw new Error("empty body");
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_BYTES) {
          await reader.cancel();
          break;
        }
        chunks.push(value);
      }
      const body = new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks));
      const { text, title } = /html/i.test(type) ? htmlToText(body) : { text: body, title: "" };
      return { text, title, finalUrl: url.toString() };
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("too many redirects");
}

export async function checkSource(sourceUrl: string | null, excerpt: string | null, answer: number): Promise<SourceCheck> {
  const checkedAt = new Date().toISOString();
  if (!sourceUrl || !excerpt) return { status: "invalid_url", detail: "Source URL and excerpt are required.", checkedAt };
  try {
    new URL(sourceUrl);
  } catch {
    return { status: "invalid_url", detail: "Source URL is not a valid URL.", checkedAt };
  }
  let page: Awaited<ReturnType<typeof fetchSourceText>>;
  try {
    page = await fetchSourceText(sourceUrl);
  } catch (e) {
    return { status: "inaccessible", detail: `Could not fetch the source independently (${e instanceof Error ? e.message : "error"}). Review manually.`, checkedAt };
  }
  const base = { checkedAt, finalUrl: page.finalUrl, pageTitle: page.title.slice(0, 200) };
  if (!excerptInText(excerpt, page.text)) {
    return { ...base, status: "excerpt_not_found", detail: "The quoted excerpt was not found on the fetched page." };
  }
  if (!textMentionsNumber(excerpt, answer)) {
    return { ...base, status: "number_not_in_excerpt", detail: "The excerpt is on the page but does not contain the answer number." };
  }
  return { ...base, status: "supported", detail: "Excerpt found on the page and it contains the answer number." };
}
