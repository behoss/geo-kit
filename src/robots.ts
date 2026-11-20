import { AI_CRAWLERS, crawlersFor } from "./crawlers.js";

/** Same shape as Next.js `MetadataRoute.Robots`, so `robots.ts` can return it directly. */
export interface RobotsRule {
  userAgent?: string | string[];
  allow?: string | string[];
  disallow?: string | string[];
  crawlDelay?: number;
}

export interface RobotsConfig {
  rules: RobotsRule | RobotsRule[];
  sitemap?: string | string[];
  host?: string;
}

export interface AiRobotsOptions {
  /** Absolute sitemap URL(s). */
  sitemap?: string | string[];
  host?: string;
  /** Paths no crawler should fetch, e.g. ["/api/", "/admin/"]. Applied to every group. */
  disallow?: string[];
  /**
   * Let model-training crawlers in (GPTBot, ClaudeBot, Google-Extended, CCBot…). Default true.
   * Set false to stay quotable in AI answers while opting out of training.
   */
  allowTraining?: boolean;
  /** Extra user-agent tokens to welcome explicitly. */
  alsoAllow?: string[];
  /** User-agent tokens to shut out entirely. */
  block?: string[];
}

const toArray = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

/**
 * robots rules with an explicit welcome for every AI answer engine.
 *
 * Use it as your Next.js App Router `app/robots.ts`:
 *
 *   import { aiRobots } from "geo-kit";
 *   export default function robots() {
 *     return aiRobots({ sitemap: "https://example.com/sitemap.xml", disallow: ["/api/"] });
 *   }
 */
export function aiRobots(opts: AiRobotsOptions = {}): RobotsConfig {
  const disallow = opts.disallow ?? [];
  const blocked = new Set((opts.block ?? []).map((b) => b.toLowerCase()));
  const training = new Set(crawlersFor("training").map((t) => t.toLowerCase()));
  const allowTraining = opts.allowTraining ?? true;

  const welcome = [...AI_CRAWLERS.map((c) => c.token), ...(opts.alsoAllow ?? [])].filter((t) => {
    const k = t.toLowerCase();
    return !blocked.has(k) && (allowTraining || !training.has(k));
  });
  const shutOut = [
    ...(opts.block ?? []),
    ...(allowTraining ? [] : AI_CRAWLERS.filter((c) => c.purpose === "training").map((c) => c.token)),
  ];

  const rules: RobotsRule[] = [];
  rules.push(compactRule({ userAgent: welcome, allow: "/", disallow: disallow.length ? disallow : undefined }));
  if (shutOut.length) rules.push({ userAgent: [...new Set(shutOut)], disallow: "/" });
  rules.push(compactRule({ userAgent: "*", allow: "/", disallow: disallow.length ? disallow : undefined }));

  const out: RobotsConfig = { rules };
  if (opts.sitemap) out.sitemap = opts.sitemap;
  if (opts.host) out.host = opts.host;
  return out;
}

function compactRule(r: RobotsRule): RobotsRule {
  const out: RobotsRule = {};
  for (const [k, v] of Object.entries(r)) if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  return out;
}

/** Render a RobotsConfig as robots.txt text (for frameworks other than Next.js, or a static file). */
export function renderRobotsTxt(cfg: RobotsConfig): string {
  const lines: string[] = [];
  for (const rule of toArray(cfg.rules)) {
    for (const ua of toArray(rule.userAgent ?? "*")) lines.push(`User-agent: ${ua}`);
    for (const a of toArray(rule.allow)) lines.push(`Allow: ${a}`);
    for (const d of toArray(rule.disallow)) lines.push(`Disallow: ${d}`);
    if (rule.crawlDelay !== undefined) lines.push(`Crawl-delay: ${rule.crawlDelay}`);
    lines.push("");
  }
  for (const s of toArray(cfg.sitemap)) lines.push(`Sitemap: ${s}`);
  if (cfg.host) lines.push(`Host: ${cfg.host}`);
  return lines.join("\n").replace(/\n+$/, "") + "\n";
}

// --------------------------------------------------------------------------------------------- //
// Parsing and matching (RFC 9309), used by the audit and handy in tests
// --------------------------------------------------------------------------------------------- //

export interface RobotsGroup {
  agents: string[];
  rules: Array<{ allow: boolean; path: string }>;
}

export interface ParsedRobots {
  groups: RobotsGroup[];
  sitemaps: string[];
}

export function parseRobotsTxt(text: string): ParsedRobots {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];
  let current: RobotsGroup | null = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    const value = m[2]!.trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (key === "sitemap") {
      sitemaps.push(value);
    } else if ((key === "allow" || key === "disallow") && current) {
      if (key === "disallow" && value === "") continue; // "Disallow:" with no path allows everything
      current.rules.push({ allow: key === "allow", path: value });
    }
  }
  return { groups, sitemaps };
}

function patternToRegExp(path: string): RegExp {
  const anchored = path.endsWith("$");
  const body = (anchored ? path.slice(0, -1) : path)
    .split("*")
    .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
}

export interface RobotsVerdict {
  allowed: boolean;
  /** The user-agent line that applied ("*" when the crawler has no group of its own). */
  group: string | null;
  /** The rule that decided it, if any. */
  rule: string | null;
}

/** Is `path` allowed for `userAgent` under these robots rules? Longest match wins; ties go to Allow. */
export function isAllowed(robots: ParsedRobots | string, userAgent: string, path = "/"): RobotsVerdict {
  const parsed = typeof robots === "string" ? parseRobotsTxt(robots) : robots;
  const ua = userAgent.toLowerCase();
  let groups = parsed.groups.filter((g) => g.agents.includes(ua));
  let group: string | null = userAgent;
  if (!groups.length) {
    groups = parsed.groups.filter((g) => g.agents.includes("*"));
    group = groups.length ? "*" : null;
  }
  if (path === "/robots.txt") return { allowed: true, group, rule: null };
  let best: { allow: boolean; path: string } | null = null;
  for (const g of groups) {
    for (const r of g.rules) {
      if (!patternToRegExp(r.path).test(path)) continue;
      const len = r.path.replace(/\*|\$$/g, "").length;
      const bestLen = best ? best.path.replace(/\*|\$$/g, "").length : -1;
      if (len > bestLen || (len === bestLen && r.allow && !best!.allow)) best = r;
    }
  }
  return {
    allowed: best ? best.allow : true,
    group,
    rule: best ? `${best.allow ? "Allow" : "Disallow"}: ${best.path}` : null,
  };
}
