import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { analyse, auditUrl, countFacts, formatReport } from "../src/audit/index.js";
import { aiRobots, generateLlmsTxt, renderRobotsTxt } from "../src/index.js";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const robotsTxt = renderRobotsTxt(aiRobots({ sitemap: "https://example.com/sitemap.xml" }));
const llmsTxt = generateLlmsTxt({ name: "Example", summary: "Handmade mugs.", sections: [{ title: "Shop", links: [{ title: "Mugs", url: "https://example.com/mugs" }] }] });

const byId = (r: ReturnType<typeof analyse>, id: string) => r.checks.find((c) => c.id === id)!;

describe("analyse", () => {
  it("scores a well-built page highly", () => {
    const r = analyse({
      url: "https://example.com/mugs",
      page: { status: 200, text: fixture("good.html") },
      robots: { status: 200, text: robotsTxt },
      llms: { status: 200, text: llmsTxt },
      botProbes: [{ token: "OAI-SearchBot", status: 200 }],
    });
    const failing = r.checks.filter((c) => c.status !== "pass").map((c) => `${c.id}: ${c.detail}`);
    expect(failing).toEqual([]);
    expect(r.score).toBe(100);
    expect(r.summary.leadSentence).toMatch(/^Example mugs are handmade/);
    expect(r.summary.jsonLdTypes).toEqual(["Organization", "WebPage", "BreadcrumbList", "FAQPage"]);
  });

  it("fails a client-rendered, noindexed shell", () => {
    const r = analyse({
      url: "https://example.com/app",
      page: { status: 200, text: fixture("spa.html") },
      robots: { status: 200, text: "User-agent: GPTBot\nDisallow: /\n\nUser-agent: OAI-SearchBot\nDisallow: /\n" },
      llms: { status: 200, text: "<!doctype html><html>Not found</html>" },
      botProbes: [{ token: "ClaudeBot", status: 403 }],
    });
    for (const id of ["jsonld-present", "canonical", "indexable", "h1", "raw-text", "robots-ai", "llms-txt", "answer-first"]) {
      expect(byId(r, id).status, id).toBe("fail");
    }
    expect(byId(r, "robots-ai").detail).toContain("OAI-SearchBot");
    expect(byId(r, "bot-served").status).toBe("warn");
    expect(r.score).toBeLessThan(30);
  });

  it("counts checkable facts, not adjectives", () => {
    expect(countFacts("World-class, award-winning, best-in-class quality")).toBe(0);
    expect(countFacts("From £12, 2 working days, 98% on time, since 2019")).toBe(4);
  });
});

describe("auditUrl", () => {
  it("fetches the page, robots.txt and llms.txt and formats a report", async () => {
    const files: Record<string, string> = {
      "https://example.com/mugs": fixture("good.html"),
      "https://example.com/robots.txt": robotsTxt,
      "https://example.com/llms.txt": llmsTxt,
    };
    const fakeFetch = (async (input: string | URL | Request) => {
      const url = String(input);
      const body = files[url];
      return new Response(body ?? "Not found", { status: body ? 200 : 404 });
    }) as typeof fetch;
    const run = await auditUrl("https://example.com/mugs", { fetch: fakeFetch });
    expect(run.score).toBe(100);
    expect(run.checks.find((c) => c.id === "bot-served")?.status).toBe("pass");
    const report = formatReport(run);
    expect(report).toContain("Score  100/100  Excellent");
    expect(report).toContain("✓ llms.txt");
    expect(report).not.toContain("\x1b[");
  });
});

describe("countFacts", () => {
  it("counts a number followed by a noun", () => {
    expect(countFacts("9 typed builders and 23 AI crawlers, plus 1,200 happy users")).toBe(3);
  });
});
