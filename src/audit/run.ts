import { analyse, type AuditResult, type Fetched } from "./analyse.js";

export interface AuditOptions {
  /** Milliseconds per request. Default 15000. */
  timeout?: number;
  /** User agent for the main fetch. */
  userAgent?: string;
  /** Also fetch the page as AI crawlers to spot CDN or firewall blocks. Default true. */
  probeBots?: boolean;
  /** Custom fetch (for tests or proxies). */
  fetch?: typeof fetch;
}

export const DEFAULT_UA = "Mozilla/5.0 (compatible; geo-kit-audit/0.1; +https://github.com/behoss/geo-kit)";

// The user agents the vendors publish; we only borrow them to see how your server answers.
const BOT_UAS: Array<{ token: string; ua: string }> = [
  { token: "OAI-SearchBot", ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot" },
  { token: "ClaudeBot", ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)" },
  { token: "PerplexityBot", ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)" },
];

async function get(f: typeof fetch, url: string, ua: string, timeout: number): Promise<Fetched & { headers: Record<string, string>; finalUrl: string }> {
  try {
    const res = await f(url, {
      headers: { "User-Agent": ua, Accept: "text/html,text/plain;q=0.9,*/*;q=0.8", "Accept-Language": "en-GB,en;q=0.8" },
      redirect: "follow",
      signal: AbortSignal.timeout(timeout),
    });
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => (headers[k.toLowerCase()] = v));
    const text = await res.text();
    return { status: res.status, text, contentType: res.headers.get("content-type"), headers, finalUrl: res.url || url };
  } catch {
    return { status: 0, text: null, headers: {}, finalUrl: url };
  }
}

export interface AuditRun extends AuditResult {
  fetch: { status: number; finalUrl: string; bytes: number; ms: number };
}

/** Fetch a URL, its robots.txt and llms.txt, and score how quotable it is for AI assistants. */
export async function auditUrl(url: string, opts: AuditOptions = {}): Promise<AuditRun> {
  const f = opts.fetch ?? fetch;
  const timeout = opts.timeout ?? 15000;
  const ua = opts.userAgent ?? DEFAULT_UA;
  const target = /^https?:\/\//i.test(url) ? url : `https://${url}`;

  const started = Date.now();
  const page = await get(f, target, ua, timeout);
  const ms = Date.now() - started;
  if (page.status === 0) throw new Error(`Could not fetch ${target} (network error or timeout)`);
  const origin = new URL(page.finalUrl).origin;

  const [robots, llms, llmsFull, ...probes] = await Promise.all([
    get(f, `${origin}/robots.txt`, ua, timeout),
    get(f, `${origin}/llms.txt`, ua, timeout),
    get(f, `${origin}/llms-full.txt`, ua, timeout),
    ...(opts.probeBots === false ? [] : BOT_UAS.map((b) => get(f, page.finalUrl, b.ua, timeout))),
  ]);

  const result = analyse({
    url: page.finalUrl,
    page,
    robots,
    llms,
    llmsFull,
    botProbes: opts.probeBots === false ? undefined : BOT_UAS.map((b, i) => ({ token: b.token, status: probes[i]?.status ?? 0 })),
  });
  return { ...result, fetch: { status: page.status, finalUrl: page.finalUrl, bytes: Buffer.byteLength(page.text ?? ""), ms } };
}
