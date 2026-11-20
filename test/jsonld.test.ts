import { describe, expect, it } from "vitest";
import {
  article,
  breadcrumbList,
  faqPage,
  graph,
  idFor,
  organization,
  person,
  product,
  ref,
  serializeJsonLd,
  softwareApplication,
  webPage,
  webSite,
} from "../src/index.js";
import { validateJsonLd } from "../src/validate.js";

const site = "https://example.com";

describe("builders", () => {
  it("builds a linked graph that validates cleanly", () => {
    const org = organization({ name: "Example", url: site, logo: `${site}/logo.png`, sameAs: ["https://github.com/example"], description: "Example builds things." });
    const doc = graph(
      org,
      webSite({ name: "Example", url: site, publisher: ref(org["@id"]!) }),
      webPage({ url: `${site}/pricing`, name: "Pricing", description: "Plans and prices", isPartOf: ref(idFor(site, "website")) }),
      breadcrumbList([
        { name: "Home", url: site },
        { name: "Pricing", url: `${site}/pricing` },
      ]),
    );
    expect(doc["@context"]).toBe("https://schema.org");
    expect(doc["@graph"]).toHaveLength(4);
    expect(validateJsonLd(doc).filter((i) => i.severity === "error")).toEqual([]);
  });

  it("drops empty values", () => {
    const n = organization({ name: "X", url: site, sameAs: [], description: "" });
    expect(n).not.toHaveProperty("sameAs");
    expect(n).not.toHaveProperty("description");
    expect(n["@id"]).toBe("https://example.com/#organization");
  });

  it("numbers breadcrumbs from 1", () => {
    const b = breadcrumbList([
      { name: "Home", url: site },
      { name: "Blog", url: `${site}/blog` },
    ]);
    const items = b.itemListElement as Array<{ position: number }>;
    expect(items.map((i) => i.position)).toEqual([1, 2]);
  });

  it("builds Article with a Person author and defaults dateModified", () => {
    const a = article({ url: `${site}/blog/geo`, headline: "What is GEO?", datePublished: "2026-01-10", author: { name: "Bez", url: "https://behoss.github.io" } });
    expect(a.dateModified).toBe("2026-01-10");
    expect((a.author as { "@type": string })["@type"]).toBe("Person");
    expect(validateJsonLd({ "@context": "https://schema.org", ...a })).toEqual(expect.not.arrayContaining([expect.objectContaining({ severity: "error" })]));
  });

  it("formats Product offers", () => {
    const p = product({ name: "Mug", url: `${site}/mug`, offers: { price: 12, priceCurrency: "GBP", availability: "InStock" } });
    expect(p.offers).toMatchObject({ price: "12.00", priceCurrency: "GBP", availability: "https://schema.org/InStock" });
  });

  it("builds FAQPage, SoftwareApplication and Person", () => {
    const f = faqPage([{ question: "What is llms.txt?", answer: "A Markdown file that lists a site's key pages for AI assistants." }]);
    expect((f.mainEntity as unknown[])[0]).toMatchObject({ "@type": "Question", acceptedAnswer: { "@type": "Answer" } });
    const s = softwareApplication({ name: "geo-kit", url: site, applicationCategory: "DeveloperApplication", offers: { price: 0, priceCurrency: "GBP" } });
    expect(s["@type"]).toBe("SoftwareApplication");
    expect(person({ name: "Bez", url: "https://behoss.github.io" })["@id"]).toBe("https://behoss.github.io/#person");
  });
});

describe("serializeJsonLd", () => {
  it("cannot be broken out of a script tag", () => {
    const out = serializeJsonLd(organization({ name: "</script><script>alert(1)</script>", url: site }));
    expect(out).not.toContain("</script>");
    expect(JSON.parse(out).name).toBe("</script><script>alert(1)</script>");
  });

  it("adds @context to a single node and wraps arrays in a graph", () => {
    expect(JSON.parse(serializeJsonLd(person({ name: "Bez" })))["@context"]).toBe("https://schema.org");
    expect(JSON.parse(serializeJsonLd([person({ name: "A" }), person({ name: "B" })]))["@graph"]).toHaveLength(2);
  });
});

describe("validateJsonLd", () => {
  it("flags missing context and required fields", () => {
    const issues = validateJsonLd({ "@type": "Article", headline: "Hi" });
    const msgs = issues.map((i) => i.message);
    expect(msgs).toContain('@context is missing or not "https://schema.org"');
    expect(msgs).toContain("missing author");
    expect(msgs).toContain("missing datePublished");
  });

  it("checks FAQ answers and product offers", () => {
    const faq = validateJsonLd({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: [{ "@type": "Question", name: "Q?" }] });
    expect(faq.some((i) => /acceptedAnswer/.test(i.message))).toBe(true);
    const prod = validateJsonLd({ "@context": "https://schema.org", "@type": "Product", name: "X" });
    expect(prod.some((i) => /offers/.test(i.message) && i.severity === "error")).toBe(true);
  });
});
