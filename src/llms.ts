/**
 * llms.txt and llms-full.txt from one site config (format: https://llmstxt.org).
 *
 *   # Name
 *   > One-paragraph summary an assistant can quote as-is.
 *   Key facts and notes
 *   ## Section
 *   - [Page title](https://example.com/page): what the page answers
 *   ## Optional
 *   - [Nice to have](https://example.com/extra)
 *
 * llms-full.txt carries the same header followed by the full Markdown of every page that has `content`.
 */

export interface LlmsLink {
  title: string;
  url: string;
  /** What this page answers, in one line. */
  description?: string;
  /** The page as Markdown, for llms-full.txt. Pages without content are listed but not inlined. */
  content?: string;
}

export interface LlmsSection {
  title: string;
  links: LlmsLink[];
}

export interface LlmsConfig {
  /** Site or product name: the H1. */
  name: string;
  /** The blockquote: who you are, what you offer, for whom. Write it as the sentence you want quoted. */
  summary: string;
  /** Short checkable facts shown as a bullet list under the summary (prices, coverage, update cadence). */
  facts?: string[];
  /** Free-text paragraphs after the facts. */
  details?: string | string[];
  sections: LlmsSection[];
  /** Links an assistant may skip when its context is short (the spec's "Optional" section). */
  optional?: LlmsLink[];
  /** ISO date shown as "Last updated" so assistants can judge freshness. */
  updated?: string;
}

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

function header(cfg: LlmsConfig): string[] {
  const out = [`# ${oneLine(cfg.name)}`, "", `> ${oneLine(cfg.summary)}`, ""];
  if (cfg.facts?.length) {
    for (const f of cfg.facts) out.push(`- ${oneLine(f)}`);
    out.push("");
  }
  const details = typeof cfg.details === "string" ? [cfg.details] : (cfg.details ?? []);
  for (const d of details) out.push(d.trim(), "");
  if (cfg.updated) out.push(`Last updated: ${cfg.updated}`, "");
  return out;
}

function linkLine(l: LlmsLink): string {
  const desc = l.description ? `: ${oneLine(l.description)}` : "";
  return `- [${oneLine(l.title).replace(/[[\]]/g, "")}](${l.url})${desc}`;
}

function sectionLines(title: string, links: LlmsLink[]): string[] {
  if (!links.length) return [];
  return [`## ${oneLine(title)}`, "", ...links.map(linkLine), ""];
}

export function generateLlmsTxt(cfg: LlmsConfig): string {
  const lines = header(cfg);
  for (const s of cfg.sections) lines.push(...sectionLines(s.title, s.links));
  if (cfg.optional?.length) lines.push(...sectionLines("Optional", cfg.optional));
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

/** Shift Markdown headings down so a page's own "# Title" sits under the file's sections. */
function demoteHeadings(md: string, by: number): string {
  let inFence = false;
  return md
    .split("\n")
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
      if (inFence) return line;
      return line.replace(/^(#{1,6})(\s)/, (_m, h: string, sp: string) => "#".repeat(Math.min(6, h.length + by)) + sp);
    })
    .join("\n");
}

export function generateLlmsFullTxt(cfg: LlmsConfig): string {
  const lines = header(cfg);
  const all = [...cfg.sections.map((s) => ({ title: s.title, links: s.links })), { title: "Optional", links: cfg.optional ?? [] }];
  for (const s of all) {
    const pages = s.links.filter((l) => l.content?.trim());
    if (!pages.length) continue;
    lines.push(`## ${oneLine(s.title)}`, "");
    for (const p of pages) {
      lines.push(`### ${oneLine(p.title)}`, "", `Source: ${p.url}`, "");
      if (p.description) lines.push(`> ${oneLine(p.description)}`, "");
      lines.push(demoteHeadings(p.content!.trim(), 3), "");
    }
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

/**
 * A plain-text Response for an App Router route handler:
 *
 *   // app/llms.txt/route.ts
 *   export const dynamic = "force-static";
 *   export function GET() { return textResponse(generateLlmsTxt(site)); }
 */
export function textResponse(body: string, init: { maxAge?: number } = {}): Response {
  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": `public, max-age=${init.maxAge ?? 3600}, s-maxage=${init.maxAge ?? 3600}`,
    },
  });
}

export interface ParsedLlmsTxt {
  title: string | null;
  summary: string | null;
  sections: Array<{ title: string; links: number }>;
  links: number;
}

/** Light parser used by the audit: does this look like a real llms.txt? */
export function parseLlmsTxt(text: string): ParsedLlmsTxt {
  const lines = text.split(/\r?\n/);
  const title = lines.find((l) => /^#\s+\S/.test(l))?.replace(/^#\s+/, "").trim() ?? null;
  const summary = lines.find((l) => /^>\s*\S/.test(l))?.replace(/^>\s*/, "").trim() ?? null;
  const sections: Array<{ title: string; links: number }> = [];
  let links = 0;
  for (const l of lines) {
    const h = /^##\s+(.+)$/.exec(l);
    if (h) sections.push({ title: h[1]!.trim(), links: 0 });
    if (/^\s*[-*]\s*\[[^\]]+\]\([^)]+\)/.test(l)) {
      links++;
      const last = sections[sections.length - 1];
      if (last) last.links++;
    }
  }
  return { title, summary, sections, links };
}
