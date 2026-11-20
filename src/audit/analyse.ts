import { parse, type HTMLElement } from "node-html-parser";
import { ANSWER_ENGINE_CRAWLERS, AI_CRAWLERS } from "../crawlers.js";
import { parseLlmsTxt } from "../llms.js";
import { isAllowed, parseRobotsTxt } from "../robots.js";
import { collectNodes, nodeTypes, validateJsonLd } from "../validate.js";

export type Status = "pass" | "warn" | "fail";

export type Group = "Structured data" | "Head" | "Raw HTML" | "AI crawler access" | "Quotability";

export interface Check {
  id: string;
  group: Group;
  label: string;
  status: Status;
  detail: string;
  /** What to do about it, when it is not a pass. */
  fix?: string;
  weight: number;
}

export interface Fetched {
  status: number;
  text: string | null;
  contentType?: string | null;
}

export interface AuditInput {
  url: string;
  page: Fetched & { headers?: Record<string, string> };
  robots?: Fetched | null;
  llms?: Fetched | null;
  llmsFull?: Fetched | null;
  /** Status codes when the page was fetched with AI crawler user agents. */
  botProbes?: Array<{ token: string; status: number }>;
}

export interface AuditResult {
  url: string;
  score: number;
  grade: string;
  checks: Check[];
  summary: {
    title: string | null;
    h1: string | null;
    words: number;
    jsonLdTypes: string[];
    leadSentence: string | null;
  };
}

const WEIGHTS = { high: 3, medium: 2, low: 1 } as const;

const STRIP = "script, style, noscript, template, svg, iframe, nav, header, footer, aside, form, [aria-hidden=true], [hidden]";

const words = (s: string) => s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

function decode(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)));
}

function text(el: HTMLElement | null | undefined): string {
  return el ? clean(decode(el.structuredText)) : "";
}

function mainColumn(root: HTMLElement): HTMLElement | null {
  const body = root.querySelector("body") ?? root;
  const pick = body.querySelector("main") ?? body.querySelector("[role=main]") ?? body.querySelector("article") ?? body;
  const copy = parse(pick.toString(), { comment: false });
  copy.querySelectorAll(STRIP).forEach((n) => n.remove());
  return copy;
}

// Signals of a specific, checkable fact: money, percentages, dates, counts with units, versions.
const FACT_PATTERNS: RegExp[] = [
  /[£$€¥₹]\s?\d[\d,.]*(?:\s?(?:k|m|bn|million|billion))?/gi,
  /\b\d+(?:\.\d+)?\s?%/g,
  /\b(?:19|20)\d{2}\b/g,
  /\b\d{1,2}(?:st|nd|rd|th)?\s(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\b/gi,
  /\b\d[\d,.]*\s?(?:working\s|business\s|calendar\s)?(?:days?|weeks?|months?|years?|hours?|minutes?|mins?|seconds?|ms|kg|g|km|miles?|mph|GB|MB|TB|users?|customers?|clients?|projects?|apps?|countries|languages|reviews?|stars?|products?|pages?|sites?|teams?|people|steps?|x)\b/gi,
  /\bv?\d+\.\d+(?:\.\d+)?\b/g,
  /#\d+\b/g,
  /\b(?:day|week|month|step|phase|sprint|stage|level|tier)\s\d+\b/gi,
];

export function countFacts(s: string): number {
  const found = new Set<string>();
  for (const re of FACT_PATTERNS) for (const m of s.matchAll(re)) found.add(`${m.index}:${m[0]}`);
  // Overlapping matches (e.g. "£20" and "20") count once per start position.
  return new Set([...found].map((k) => k.split(":")[0])).size;
}

const DEFINITION = /\b(is|are|was|were|means|helps|lets|gives|offers|builds|provides|costs|takes|makes|turns|works|runs|includes|delivers|has|have|can)\b/i;

function firstSentence(p: string): string {
  const m = /^(.+?[.!?])(\s|$)/.exec(p);
  return clean(m ? m[1]! : p);
}

export function analyse(input: AuditInput): AuditResult {
  const checks: Check[] = [];
  const add = (c: Omit<Check, "weight"> & { weight?: number }) => checks.push({ weight: WEIGHTS.medium, ...c });
  const html = input.page.text ?? "";
  const root = parse(html, { comment: false, blockTextElements: { script: true, style: true, noscript: true, pre: true } });
  const head = root.querySelector("head") ?? root;
  const pageUrl = new URL(input.url);

  // ------------------------------------------------------------------ Structured data
  const blocks = root.querySelectorAll('script[type="application/ld+json"]');
  const docs: unknown[] = [];
  let parseErrors = 0;
  for (const b of blocks) {
    try {
      docs.push(JSON.parse(b.rawText.trim()));
    } catch {
      parseErrors++;
    }
  }
  const nodes = docs.flatMap((d) => collectNodes(d));
  const types = [...new Set(nodes.flatMap(nodeTypes))];
  const rootNodes = docs.flatMap((d) =>
    Array.isArray(d) ? d : d && typeof d === "object" && Array.isArray((d as { "@graph"?: unknown[] })["@graph"]) ? (d as { "@graph": unknown[] })["@graph"] : [d],
  );
  const topTypes = [...new Set(rootNodes.flatMap((n) => (n && typeof n === "object" ? nodeTypes(n as Record<string, unknown>) : [])))];
  if (!blocks.length) {
    add({
      id: "jsonld-present",
      group: "Structured data",
      label: "JSON-LD present",
      status: "fail",
      detail: "no <script type=\"application/ld+json\"> in the raw HTML",
      fix: "Add Organization, WebSite, WebPage and BreadcrumbList JSON-LD (geo-kit builders + <JsonLd>).",
      weight: WEIGHTS.high,
    });
  } else {
    add({
      id: "jsonld-present",
      group: "Structured data",
      label: "JSON-LD present",
      status: parseErrors ? "fail" : "pass",
      detail: `${plural(blocks.length, "block")}${parseErrors ? `, ${parseErrors} not valid JSON` : ""}: ${topTypes.slice(0, 8).join(", ") || "no @type"}${topTypes.length > 8 ? "…" : ""}`,
      fix: parseErrors ? "Fix the JSON syntax; serialise with serializeJsonLd() instead of hand-written strings." : undefined,
      weight: WEIGHTS.high,
    });
    const issues = docs.flatMap((d) => validateJsonLd(d));
    const errors = issues.filter((i) => i.severity === "error");
    const warnings = issues.filter((i) => i.severity === "warning");
    add({
      id: "jsonld-shape",
      group: "Structured data",
      label: "JSON-LD shape",
      status: errors.length ? "fail" : warnings.length > 2 ? "warn" : "pass",
      detail: errors.length
        ? errors.slice(0, 3).map((e) => `${e.type}: ${e.message}`).join("; ")
        : warnings.length
          ? `no errors; ${plural(warnings.length, "suggestion")} (${warnings.slice(0, 2).map((w) => `${w.type}: ${w.message}`).join("; ")})`
          : "required properties in place",
      fix: errors.length || warnings.length > 2 ? "Fill the missing properties; the typed builders make them hard to forget." : undefined,
      weight: WEIGHTS.medium,
    });
    const identity = types.some((t) => /Organization|Person|LocalBusiness|ProfessionalService|Corporation/.test(t));
    const pageNode = types.some((t) => /WebPage|AboutPage|ContactPage|CollectionPage|ItemPage|FAQPage|Article|BlogPosting|NewsArticle|Product|SoftwareApplication/.test(t));
    // The home page is the root of every trail, so it needs no BreadcrumbList of its own.
    const crumbs = types.includes("BreadcrumbList") || pageUrl.pathname === "/" || pageUrl.pathname === "";
    const missing = [!identity && "Organization or Person", !pageNode && "a page node (WebPage, Article, Product…)", !crumbs && "BreadcrumbList"].filter(Boolean);
    add({
      id: "jsonld-entities",
      group: "Structured data",
      label: "Who and what",
      status: missing.length === 0 ? "pass" : missing.length === 1 ? "warn" : "fail",
      detail: missing.length ? `missing ${missing.join(", ")}` : "publisher, page and breadcrumb are all described",
      fix: missing.length
        ? `Add ${missing.join(", ")}: assistants use them to tell who publishes the page, what it is and where it sits.`
        : undefined,
    });
  }

  // ------------------------------------------------------------------ Head
  const title = text(head.querySelector("title")) || null;
  add({
    id: "title",
    group: "Head",
    label: "Title",
    status: !title ? "fail" : title.length < 15 || title.length > 70 ? "warn" : "pass",
    detail: title ? `"${title}" (${title.length} chars)` : "no <title>",
    fix: !title ? "Add a <title> that leads with what people search for." : title.length > 70 ? "Front-load the search words; Google shows about 60 characters." : title.length < 15 ? "Say what the page is about in the words people search for." : undefined,
  });
  const desc = clean(decode(head.querySelector('meta[name="description"]')?.getAttribute("content") ?? "")) || null;
  add({
    id: "meta-description",
    group: "Head",
    label: "Meta description",
    status: !desc ? "fail" : desc.length < 50 || desc.length > 170 ? "warn" : "pass",
    detail: desc ? `${desc.length} chars` : "missing",
    fix: !desc ? "Add a 120–160 character description that answers the page's main question." : desc.length < 50 || desc.length > 170 ? "Aim for 120–160 characters." : undefined,
    weight: WEIGHTS.low,
  });
  const canonicalHref = head.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? null;
  let canonicalStatus: Status = "pass";
  let canonicalDetail = canonicalHref ?? "missing";
  if (!canonicalHref) canonicalStatus = "fail";
  else {
    try {
      const c = new URL(canonicalHref, pageUrl);
      if (!/^https?:\/\//.test(canonicalHref)) {
        canonicalStatus = "warn";
        canonicalDetail = `${canonicalHref} (relative; use an absolute URL)`;
      } else if (c.host !== pageUrl.host || c.pathname.replace(/\/$/, "") !== pageUrl.pathname.replace(/\/$/, "")) {
        canonicalStatus = "warn";
        canonicalDetail = `${canonicalHref} (points elsewhere)`;
      }
    } catch {
      canonicalStatus = "fail";
      canonicalDetail = `${canonicalHref} (not a valid URL)`;
    }
  }
  add({
    id: "canonical",
    group: "Head",
    label: "Canonical",
    status: canonicalStatus,
    detail: canonicalDetail,
    fix: canonicalStatus !== "pass" ? "Add one absolute self-referencing <link rel=\"canonical\">." : undefined,
  });
  const metaRobots = (head.querySelector('meta[name="robots"]')?.getAttribute("content") ?? "").toLowerCase();
  const headerRobots = (input.page.headers?.["x-robots-tag"] ?? "").toLowerCase();
  const noindex = /noindex|none/.test(metaRobots) || /noindex|none/.test(headerRobots);
  const nosnippet = /nosnippet|max-snippet:\s*0/.test(metaRobots + " " + headerRobots);
  add({
    id: "indexable",
    group: "Head",
    label: "Indexable",
    status: noindex ? "fail" : nosnippet ? "warn" : "pass",
    detail: noindex ? "noindex is set: search and AI answers will drop this page" : nosnippet ? "nosnippet limits what AI Overviews can quote" : "no noindex or nosnippet",
    fix: noindex ? "Remove noindex from pages you want quoted." : nosnippet ? "Remove nosnippet / max-snippet:0 so the page can be quoted." : undefined,
    weight: WEIGHTS.high,
  });
  const lang = root.querySelector("html")?.getAttribute("lang") ?? null;
  add({
    id: "lang",
    group: "Head",
    label: "Language",
    status: lang ? "pass" : "warn",
    detail: lang ? `lang="${lang}"` : "no lang on <html>",
    fix: lang ? undefined : 'Set <html lang="en-GB"> (or your locale).',
    weight: WEIGHTS.low,
  });

  // ------------------------------------------------------------------ Raw HTML
  const h1s = root.querySelectorAll("h1").map((h) => text(h)).filter(Boolean);
  add({
    id: "h1",
    group: "Raw HTML",
    label: "One H1",
    status: h1s.length === 1 ? "pass" : h1s.length === 0 ? "fail" : "warn",
    detail: h1s.length === 1 ? `"${h1s[0]!.slice(0, 80)}"` : h1s.length === 0 ? "no H1 in the raw HTML" : `${h1s.length} H1s`,
    fix: h1s.length === 1 ? undefined : "Use exactly one H1 that states what the page answers.",
  });
  const main = mainColumn(root);
  const mainText = text(main);
  const mainWords = words(mainText);
  const shell = /<div id="(root|app|__next|__nuxt)"[^>]*>\s*<\/div>/i.test(html);
  add({
    id: "raw-text",
    group: "Raw HTML",
    label: "Text without JavaScript",
    status: mainWords.length >= 200 ? "pass" : mainWords.length >= 60 ? "warn" : "fail",
    detail: `${mainWords.length} words in the main column of the server HTML${shell && mainWords.length < 60 ? " (looks like a client-rendered shell)" : ""}`,
    fix:
      mainWords.length >= 200
        ? undefined
        : "AI crawlers don't run JavaScript. Render the content on the server (Next.js server components, SSG or SSR).",
    weight: WEIGHTS.high,
  });
  const h2s = (main?.querySelectorAll("h2, h3") ?? []).map((h) => text(h)).filter(Boolean);
  const lists = main?.querySelectorAll("ol, ul, table, dl").filter((l) => words(text(l)).length >= 6).length ?? 0;
  add({
    id: "structure",
    group: "Raw HTML",
    label: "Headings and lists",
    status: h2s.length >= 2 && lists >= 1 ? "pass" : h2s.length >= 1 || lists >= 1 ? "warn" : "fail",
    detail: `${plural(h2s.length, "subheading")}, ${lists} ${lists === 1 ? "list or table" : "lists or tables"}`,
    fix: h2s.length >= 2 && lists >= 1 ? undefined : "Break the page into H2 sections with lists or tables: assistants lift them whole.",
    weight: WEIGHTS.low,
  });

  // ------------------------------------------------------------------ AI crawler access
  const path = pageUrl.pathname + pageUrl.search;
  if (input.robots === undefined) {
    // not fetched (offline analysis)
  } else if (!input.robots || input.robots.status === 404 || input.robots.status === 410) {
    add({
      id: "robots-ai",
      group: "AI crawler access",
      label: "robots.txt lets AI in",
      status: "warn",
      detail: "no robots.txt: crawlers are allowed by default, but nothing names them or points to a sitemap",
      fix: "Ship a robots.txt that welcomes AI crawlers by name and lists your sitemap (aiRobots()).",
      weight: WEIGHTS.high,
    });
  } else if (input.robots.status >= 400 || !input.robots.text) {
    add({
      id: "robots-ai",
      group: "AI crawler access",
      label: "robots.txt lets AI in",
      status: input.robots.status >= 500 ? "fail" : "warn",
      detail: `robots.txt returned ${input.robots.status}${input.robots.status >= 500 ? ": crawlers treat that as 'keep out'" : ""}`,
      fix: "Serve robots.txt with a 200.",
      weight: WEIGHTS.high,
    });
  } else {
    const parsed = parseRobotsTxt(input.robots.text);
    const blocked = ANSWER_ENGINE_CRAWLERS.filter((c) => !isAllowed(parsed, c.token, path).allowed);
    add({
      id: "robots-ai",
      group: "AI crawler access",
      label: "robots.txt lets AI in",
      status: blocked.length === 0 ? "pass" : blocked.some((b) => /OAI-SearchBot|Googlebot|Bingbot|PerplexityBot|Claude-SearchBot/.test(b.token)) ? "fail" : "warn",
      detail: blocked.length
        ? `blocked for this page: ${blocked.map((b) => b.token).join(", ")}`
        : `all ${ANSWER_ENGINE_CRAWLERS.length} answer-engine crawlers may fetch this page`,
      fix: blocked.length ? "Allow the search and user-fetch crawlers; you can still block training bots." : undefined,
      weight: WEIGHTS.high,
    });
    const training = AI_CRAWLERS.filter((c) => c.purpose === "training");
    const blockedTraining = training.filter((c) => !isAllowed(parsed, c.token, path).allowed);
    const named = AI_CRAWLERS.filter((c) => parsed.groups.some((g) => g.agents.includes(c.token.toLowerCase())));
    add({
      id: "robots-explicit",
      group: "AI crawler access",
      label: "AI crawlers named",
      status: named.length >= 4 ? "pass" : "warn",
      detail: `${named.length} of ${AI_CRAWLERS.length} named in robots.txt${blockedTraining.length ? `; training opt-out: ${blockedTraining.map((c) => c.token).join(", ")}` : ""}${parsed.sitemaps.length ? "; sitemap listed" : "; no Sitemap line"}`,
      fix: named.length >= 4 ? undefined : "Name the AI crawlers you welcome, so a later blanket rule can't shut them out by accident.",
      weight: WEIGHTS.low,
    });
  }
  if (input.botProbes?.length) {
    const refused = input.botProbes.filter((p) => p.status === 401 || p.status === 403 || p.status === 429 || p.status >= 500);
    add({
      id: "bot-served",
      group: "AI crawler access",
      label: "Served to AI user agents",
      status: refused.length ? "warn" : "pass",
      detail: input.botProbes.map((p) => `${p.token} ${p.status || "error"}`).join(", "),
      fix: refused.length ? "Your server or CDN refuses AI user agents. Check its bot settings (e.g. Cloudflare's AI bot block)." : undefined,
      weight: WEIGHTS.medium,
    });
  }
  if (input.llms !== undefined) {
    const l = input.llms;
    const isHtml = !!l?.text && /^\s*<(!doctype|html)/i.test(l.text);
    const parsedL = l?.text && !isHtml ? parseLlmsTxt(l.text) : null;
    const good = l?.status === 200 && parsedL?.title && parsedL.links > 0;
    const full = input.llmsFull?.status === 200 && !!input.llmsFull.text && !/^\s*<(!doctype|html)/i.test(input.llmsFull.text);
    add({
      id: "llms-txt",
      group: "AI crawler access",
      label: "llms.txt",
      status: good ? (parsedL!.summary ? "pass" : "warn") : l?.status === 200 && isHtml ? "fail" : "warn",
      detail: good
        ? `"${parsedL!.title}", ${plural(parsedL!.links, "link")} in ${plural(parsedL!.sections.length, "section")}${parsedL!.summary ? "" : ", no > summary"}${full ? "; llms-full.txt found" : ""}`
        : l?.status === 200 && isHtml
          ? "/llms.txt returns an HTML page (soft 404)"
          : l?.status === 200
            ? "/llms.txt has no # title or no links"
            : `/llms.txt ${l?.status ? `returned ${l.status}` : "not found"}`,
      fix: good && parsedL!.summary ? undefined : "Publish /llms.txt: a # title, a > summary and links to your key pages (generateLlmsTxt()).",
      weight: WEIGHTS.medium,
    });
  }

  // ------------------------------------------------------------------ Quotability
  const paras = (main?.querySelectorAll("p, li, dd") ?? [])
    .map((p) => ({ el: p, t: text(p) }))
    .filter((p) => p.el.tagName === "P" && words(p.t).length >= 8);
  const h1Text = h1s[0] ?? "";
  const h1Pos = h1Text ? mainText.indexOf(h1Text) : 0;
  const lead = paras.find((p) => mainText.indexOf(p.t) >= Math.max(0, h1Pos)) ?? paras[0];
  const leadOffset = lead ? words(mainText.slice(Math.max(0, h1Pos + h1Text.length), Math.max(0, mainText.indexOf(lead.t)))).length : -1;
  const sentence = lead ? firstSentence(lead.t) : null;
  const sentenceWords = sentence ? words(sentence).length : 0;
  let answerStatus: Status = "fail";
  let answerDetail = "no paragraph near the top of the main column";
  if (lead && sentence) {
    const direct = DEFINITION.test(sentence);
    const early = leadOffset <= 80;
    const tight = sentenceWords >= 6 && sentenceWords <= 45;
    answerStatus = direct && early && tight ? "pass" : early && (direct || tight) ? "warn" : "fail";
    answerDetail = `"${sentence.slice(0, 90)}${sentence.length > 90 ? "…" : ""}" (${sentenceWords} words${early ? "" : `, ${leadOffset} words below the H1`})`;
  }
  add({
    id: "answer-first",
    group: "Quotability",
    label: "Direct answer up top",
    status: answerStatus,
    detail: answerDetail,
    fix:
      answerStatus === "pass"
        ? undefined
        : "Open with one plain sentence (under 45 words) that answers the page's question: what it is, what you get, the price or the result.",
    weight: WEIGHTS.high,
  });
  const top = mainWords.slice(0, 300).join(" ");
  const facts = countFacts(top);
  add({
    id: "specific-facts",
    group: "Quotability",
    label: "Specific facts",
    status: facts >= 4 ? "pass" : facts >= 2 ? "warn" : "fail",
    detail: `${plural(facts, "checkable fact")} (prices, numbers, dates, durations) in the first 300 words`,
    fix: facts >= 4 ? undefined : "Swap adjectives for facts: a price, a timeline, a count, a date. Assistants quote numbers.",
    weight: WEIGHTS.medium,
  });
  const questionHeads = h2s.filter((h) => /\?$/.test(h) || /^(how|what|why|when|which|who|can|is|are|do|does|should)\b/i.test(h));
  const faqLd = types.includes("FAQPage") || nodes.some((n) => nodeTypes(n).includes("Question"));
  add({
    id: "questions",
    group: "Quotability",
    label: "Questions answered",
    status: questionHeads.length >= 2 || faqLd ? "pass" : "warn",
    detail: `${plural(questionHeads.length, "question-style heading")}${faqLd ? ", FAQ in JSON-LD" : ""}`,
    fix: questionHeads.length >= 2 || faqLd ? undefined : "Phrase H2s as the questions people ask an assistant and answer each in the sentence below.",
    weight: WEIGHTS.medium,
  });
  const dated =
    nodes.some((n) => typeof n.dateModified === "string" || typeof n.datePublished === "string") ||
    !!root.querySelector("time[datetime]") ||
    !!head.querySelector('meta[property="article:modified_time"]') ||
    /\b(updated|last reviewed|last checked|published)\b[^.]{0,30}\b(19|20)\d{2}\b/i.test(mainText);
  add({
    id: "freshness",
    group: "Quotability",
    label: "Dated",
    status: dated ? "pass" : "warn",
    detail: dated ? "a published or updated date is machine-readable" : "no dateModified, <time> or visible updated date",
    fix: dated ? undefined : "Show an 'Updated' date in a <time datetime> and set dateModified in JSON-LD.",
    weight: WEIGHTS.low,
  });

  // ------------------------------------------------------------------ Score
  const total = checks.reduce((s, c) => s + c.weight, 0);
  const got = checks.reduce((s, c) => s + c.weight * (c.status === "pass" ? 1 : c.status === "warn" ? 0.5 : 0), 0);
  const score = total ? Math.round((got / total) * 100) : 0;
  return {
    url: input.url,
    score,
    grade: gradeFor(score),
    checks,
    summary: { title, h1: h1s[0] ?? null, words: mainWords.length, jsonLdTypes: topTypes, leadSentence: sentence },
  };
}

export function gradeFor(score: number): string {
  if (score >= 90) return "Excellent: ready to be quoted";
  if (score >= 75) return "Good: a few gaps to close";
  if (score >= 55) return "Fair: assistants will struggle to quote this";
  return "Poor: mostly invisible to AI answers";
}
