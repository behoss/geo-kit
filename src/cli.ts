#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { auditUrl, formatReport } from "./audit/index.js";
import { AI_CRAWLERS } from "./crawlers.js";
import { aiRobots, renderRobotsTxt } from "./robots.js";

const VERSION: string = (() => {
  try {
    return JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
  } catch {
    return "0.0.0";
  }
})();

const HELP = `geo-kit ${VERSION}: make a site quotable by ChatGPT, Gemini, Perplexity and Claude

Usage
  geo-kit audit <url> [options]   Score a page for AI search: JSON-LD, head, raw HTML, crawler access, quotability
  geo-kit robots [options]        Print a robots.txt that welcomes AI crawlers
  geo-kit crawlers                List the AI crawlers geo-kit knows

Audit options
  --json              Machine-readable result
  --min-score <n>     Exit 1 when the score is below n (for CI)
  --no-bots           Skip the extra fetches as AI user agents
  --user-agent <ua>   User agent for the main fetch
  --timeout <ms>      Per request (default 15000)
  --no-color          Plain output

Robots options
  --sitemap <url>     Add a Sitemap line
  --disallow <path>   Keep every crawler out of a path (repeatable)
  --no-training       Allow AI search and live fetches, block model-training crawlers
`;

function parseArgs(argv: string[]) {
  const positional: string[] = [];
  const flags: Record<string, string[] | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) {
      positional.push(a);
      continue;
    }
    const [key, inline] = a.slice(2).split("=", 2) as [string, string | undefined];
    const takesValue = ["min-score", "user-agent", "timeout", "sitemap", "disallow"].includes(key);
    if (!takesValue) flags[key] = true;
    else {
      const value = inline ?? argv[++i];
      if (value === undefined) throw new Error(`--${key} needs a value`);
      const prev = flags[key];
      flags[key] = [...(Array.isArray(prev) ? prev : []), value];
    }
  }
  const one = (k: string) => {
    const v = flags[k];
    return Array.isArray(v) ? v[v.length - 1] : undefined;
  };
  const many = (k: string) => {
    const v = flags[k];
    return Array.isArray(v) ? v : [];
  };
  return { positional, has: (k: string) => flags[k] === true, one, many };
}

async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  const [cmd, target] = args.positional;
  if (args.has("version") || cmd === "version") {
    console.log(VERSION);
    return 0;
  }
  if (!cmd || args.has("help") || cmd === "help") {
    console.log(HELP);
    return cmd ? 0 : 1;
  }
  if (cmd === "crawlers") {
    const w = Math.max(...AI_CRAWLERS.map((c) => c.token.length)) + 2;
    for (const c of AI_CRAWLERS) console.log(`${c.token.padEnd(w)}${c.purpose.padEnd(10)}${c.vendor}: ${c.product}`);
    return 0;
  }
  if (cmd === "robots") {
    const cfg = aiRobots({
      sitemap: args.one("sitemap"),
      disallow: args.many("disallow"),
      allowTraining: !args.has("no-training"),
    });
    process.stdout.write(renderRobotsTxt(cfg));
    return 0;
  }
  if (cmd === "audit") {
    if (!target) {
      console.error("Usage: geo-kit audit <url>");
      return 2;
    }
    const color = !args.has("no-color") && !process.env.NO_COLOR && process.stdout.isTTY === true;
    const run = await auditUrl(target, {
      timeout: args.one("timeout") ? Number(args.one("timeout")) : undefined,
      userAgent: args.one("user-agent"),
      probeBots: !args.has("no-bots"),
    });
    if (args.has("json")) console.log(JSON.stringify(run, null, 2));
    else console.log(formatReport(run, { color }));
    const min = args.one("min-score");
    return min !== undefined && run.score < Number(min) ? 1 : 0;
  }
  console.error(`Unknown command "${cmd}".\n`);
  console.log(HELP);
  return 2;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(`geo-kit: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  },
);
