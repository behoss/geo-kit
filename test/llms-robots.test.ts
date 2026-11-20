import { describe, expect, it } from "vitest";
import { aiRobots, generateLlmsFullTxt, generateLlmsTxt, isAllowed, parseLlmsTxt, parseRobotsTxt, renderRobotsTxt, textResponse } from "../src/index.js";

const cfg = {
  name: "Example",
  summary: "Example sells handmade mugs in the UK from £12, delivered in 2 days.",
  facts: ["120 designs", "Free UK delivery over £30"],
  sections: [
    {
      title: "Shop",
      links: [
        { title: "Mugs", url: "https://example.com/mugs", description: "Every mug with prices", content: "# Mugs\n\nOur mugs cost £12.\n\n```\n# not a heading\n```" },
        { title: "Delivery", url: "https://example.com/delivery" },
      ],
    },
  ],
  optional: [{ title: "About", url: "https://example.com/about" }],
  updated: "2026-11-01",
};

describe("llms.txt", () => {
  it("follows the llmstxt.org shape", () => {
    const txt = generateLlmsTxt(cfg);
    expect(txt.startsWith("# Example\n\n> Example sells")).toBe(true);
    expect(txt).toContain("- [Mugs](https://example.com/mugs): Every mug with prices");
    expect(txt).toContain("## Optional");
    expect(txt).toContain("Last updated: 2026-11-01");
    const parsed = parseLlmsTxt(txt);
    expect(parsed).toMatchObject({ title: "Example", links: 3 });
    expect(parsed.sections.map((s) => s.title)).toEqual(["Shop", "Optional"]);
  });

  it("inlines page content in llms-full.txt and demotes headings outside code", () => {
    const full = generateLlmsFullTxt(cfg);
    expect(full).toContain("### Mugs\n\nSource: https://example.com/mugs");
    expect(full).toContain("#### Mugs");
    expect(full).toContain("# not a heading");
    expect(full).not.toContain("### Delivery");
  });

  it("serves plain text", async () => {
    const res = textResponse("# Hi\n");
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(await res.text()).toBe("# Hi\n");
  });
});

describe("robots", () => {
  it("welcomes AI crawlers by name and keeps disallowed paths", () => {
    const r = aiRobots({ sitemap: "https://example.com/sitemap.xml", disallow: ["/api/"] });
    const txt = renderRobotsTxt(r);
    expect(txt).toContain("User-agent: OAI-SearchBot");
    expect(txt).toContain("User-agent: ClaudeBot");
    expect(txt).toContain("Sitemap: https://example.com/sitemap.xml");
    expect(isAllowed(txt, "GPTBot", "/pricing").allowed).toBe(true);
    expect(isAllowed(txt, "GPTBot", "/api/x").allowed).toBe(false);
    expect(isAllowed(txt, "SomeOtherBot", "/api/x").allowed).toBe(false);
  });

  it("can opt out of training while staying quotable", () => {
    const txt = renderRobotsTxt(aiRobots({ allowTraining: false }));
    expect(isAllowed(txt, "GPTBot", "/").allowed).toBe(false);
    expect(isAllowed(txt, "ClaudeBot", "/").allowed).toBe(false);
    expect(isAllowed(txt, "Google-Extended", "/").allowed).toBe(false);
    expect(isAllowed(txt, "OAI-SearchBot", "/").allowed).toBe(true);
    expect(isAllowed(txt, "Claude-SearchBot", "/").allowed).toBe(true);
    expect(isAllowed(txt, "Googlebot", "/").allowed).toBe(true);
  });

  it("matches RFC 9309: longest rule wins, wildcards, $ and ties to Allow", () => {
    const txt = `User-agent: *\nDisallow: /private\nAllow: /private/open\nDisallow: /*.pdf$\n\nUser-agent: GPTBot\nUser-agent: ClaudeBot\nDisallow: /\nAllow: /$\n`;
    const p = parseRobotsTxt(txt);
    expect(p.groups).toHaveLength(2);
    expect(isAllowed(p, "Bingbot", "/private/x").allowed).toBe(false);
    expect(isAllowed(p, "Bingbot", "/private/open/y").allowed).toBe(true);
    expect(isAllowed(p, "Bingbot", "/doc.pdf").allowed).toBe(false);
    expect(isAllowed(p, "Bingbot", "/doc.pdf?x").allowed).toBe(true);
    expect(isAllowed(p, "gptbot", "/").allowed).toBe(true);
    expect(isAllowed(p, "ClaudeBot", "/blog").allowed).toBe(false);
    expect(isAllowed("User-agent: *\nDisallow:\n", "GPTBot", "/").allowed).toBe(true);
  });
});
