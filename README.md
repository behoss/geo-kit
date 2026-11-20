# geo-kit

**Make your Next.js site the page ChatGPT, Gemini, Perplexity and Claude quote.**

[![CI](https://github.com/behoss/geo-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/behoss/geo-kit/actions/workflows/ci.yml)
[![MIT licence](https://img.shields.io/badge/licence-MIT-blue.svg)](LICENSE)

geo-kit is a GEO (generative engine optimisation) toolkit in one TypeScript package:

- **Typed JSON-LD builders** for Organization, WebSite, WebPage, BreadcrumbList, Article, Product, FAQPage, SoftwareApplication and Person, plus a `<JsonLd>` component for the App Router.
- **`llms.txt` and `llms-full.txt`** generated from one small site config.
- **`robots.ts` rules** that welcome every AI search crawler by name, with a one-flag opt-out from model training.
- **`geo-kit audit <url>`**, a CLI that scores any page for AI search in seconds and tells you what to fix first.

Website and docs: **[behoss.github.io/geo-kit](https://behoss.github.io/geo-kit/)**

## Why AI assistants need this

When someone asks ChatGPT or Perplexity a question, the assistant searches, fetches a handful of pages and quotes the ones it can read fastest. Those fetchers do not run JavaScript, they lean on structured data to know who is speaking, and they lift the plain sentence that answers the question. A page that renders in the browser, hides its answer under a hero banner, or sits behind a CDN rule that turns away `OAI-SearchBot` simply never gets quoted.

geo-kit gives you the building blocks to get each of those right, and an audit that proves it.

## Install

```bash
npm install github:behoss/geo-kit
```

Works with Next.js 14, 15 and 16 (App Router), React 18 and 19, and Node 18.17 or later. One runtime dependency (`node-html-parser`, used only by the audit).

## Quick start for Next.js

### 1. JSON-LD on every page

```tsx
// app/layout.tsx
import { graph, organization, webSite, ref, idFor } from "geo-kit";
import { JsonLd } from "geo-kit/react";

const url = "https://example.com";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body>
        <JsonLd
          data={graph(
            organization({
              name: "Example",
              url,
              logo: `${url}/logo.png`,
              description: "Example builds booking software for UK dental practices.",
              sameAs: ["https://www.linkedin.com/company/example", "https://github.com/example"],
            }),
            webSite({ name: "Example", url, publisher: ref(idFor(url, "organization")) }),
          )}
        />
        {children}
      </body>
    </html>
  );
}
```

```tsx
// app/pricing/page.tsx
import { graph, webPage, breadcrumbList, faqPage, ref, idFor } from "geo-kit";
import { JsonLd } from "geo-kit/react";

const faqs = [
  { question: "How much does Example cost?", answer: "Example costs £49 a month per practice, with a 14-day free trial." },
];

export default function Pricing() {
  const url = "https://example.com/pricing";
  return (
    <main>
      <JsonLd
        data={graph(
          webPage({ url, name: "Pricing", dateModified: "2026-11-01", isPartOf: ref(idFor("https://example.com", "website")) }),
          breadcrumbList([
            { name: "Home", url: "https://example.com" },
            { name: "Pricing", url },
          ]),
          faqPage(faqs, { url }),
        )}
      />
      <h1>Example pricing</h1>
      <p>Example costs £49 a month per practice, with a 14-day free trial and no setup fee.</p>
      {/* … */}
    </main>
  );
}
```

`<JsonLd>` is a server component: the script lands in the raw HTML, and `serializeJsonLd()` escapes it so content can never break out of the tag.

### 2. robots.ts that welcomes AI crawlers

```ts
// app/robots.ts
import { aiRobots } from "geo-kit";

export default function robots() {
  return aiRobots({
    sitemap: "https://example.com/sitemap.xml",
    disallow: ["/api/", "/admin/"],
    // allowTraining: false, // stay quotable in AI answers, opt out of model training
  });
}
```

### 3. llms.txt and llms-full.txt

```ts
// lib/llms.ts
import type { LlmsConfig } from "geo-kit";

export const llms: LlmsConfig = {
  name: "Example",
  summary: "Example is booking software for UK dental practices: online booking, reminders and payments from £49 a month.",
  facts: ["Used across England, Scotland and Wales", "14-day free trial", "Set up in one afternoon"],
  sections: [
    {
      title: "Product",
      links: [
        { title: "Pricing", url: "https://example.com/pricing", description: "Plans, prices and what each includes" },
        { title: "Features", url: "https://example.com/features", description: "Booking, reminders, payments" },
      ],
    },
  ],
  optional: [{ title: "About", url: "https://example.com/about" }],
};
```

```ts
// app/llms.txt/route.ts
import { generateLlmsTxt, textResponse } from "geo-kit";
import { llms } from "@/lib/llms";

export const dynamic = "force-static";
export function GET() {
  return textResponse(generateLlmsTxt(llms));
}
```

Add `content` (Markdown) to any link and serve `generateLlmsFullTxt(llms)` from `app/llms-full.txt/route.ts` to hand assistants the full text in one request.

## The audit CLI

```bash
npx geo-kit audit https://your-site.com
```

It fetches the page, its `robots.txt` and `llms.txt`, refetches the page as three AI crawlers to catch CDN blocks, and scores five areas. Here is a trimmed run against [softgen.co.uk](https://softgen.co.uk):

```text
geo-kit audit  https://softgen.co.uk/
200 · 261 KB HTML · 108 ms

Structured data
  ✓ JSON-LD present           2 blocks: Organization, Person, WebSite, WebPage, DefinedTerm, FAQPage
  ✓ JSON-LD shape             required properties in place
  ✓ Who and what              publisher, page and breadcrumb are all described

Raw HTML
  ✓ One H1                    "Softgen · UK software & AI development agency"
  ✓ Text without JavaScript   1993 words in the main column of the server HTML
  ✓ Headings and lists        48 subheadings, 4 lists or tables

AI crawler access
  ✓ robots.txt lets AI in     all 14 answer-engine crawlers may fetch this page
  ✓ Served to AI user agents  OAI-SearchBot 200, ClaudeBot 200, PerplexityBot 200
  ✓ llms.txt                  "Softgen", 47 links in 13 sections; llms-full.txt found

Quotability
  ✓ Direct answer up top      "Softgen is the UK's #1 software development agency, specialising in AI applications — we s…" (24 words)
  ✓ Specific facts            8 checkable facts (prices, numbers, dates, durations) in the first 300 words
  ✓ Questions answered        5 question-style headings, FAQ in JSON-LD
  ! Dated                     no dateModified, <time> or visible updated date

Score  99/100  Excellent: ready to be quoted

Fix first
  1. Show an 'Updated' date in a <time datetime> and set dateModified in JSON-LD.
```

Every check that is not a pass comes with a plain fix, and the top three are listed under **Fix first** (the Head group is trimmed above).

| Option | What it does |
| --- | --- |
| `--json` | Full result as JSON |
| `--min-score <n>` | Exit 1 below `n`: drop it into CI to stop regressions |
| `--no-bots` | Skip the extra fetches as AI user agents |
| `--user-agent <ua>` | User agent for the main fetch |
| `--timeout <ms>` | Per request (default 15000) |

Two more commands: `geo-kit robots [--sitemap <url>] [--disallow <path>] [--no-training]` prints a ready robots.txt, and `geo-kit crawlers` lists every AI crawler geo-kit knows and what it feeds.

Use it in GitHub Actions after a preview deploy:

```yaml
- run: npx geo-kit audit "$PREVIEW_URL/pricing" --min-score 80
```

Or from code: `import { auditUrl, analyse, formatReport } from "geo-kit/audit"`.

## The GEO checklist

What the audit checks, and what gets a page quoted:

**Structured data**
- [ ] JSON-LD in the server HTML, valid JSON, `@context` set to `https://schema.org`
- [ ] Organization (or Person) says who publishes the page, with `sameAs` links that prove it
- [ ] A page node (WebPage, Article, Product, SoftwareApplication…) and a BreadcrumbList
- [ ] FAQPage that mirrors the questions visible on the page, word for word

**Head**
- [ ] A title that leads with the words people search for
- [ ] A 120–160 character meta description that answers the main question
- [ ] One absolute, self-referencing canonical
- [ ] No `noindex` or `nosnippet` on pages you want quoted; `lang` on `<html>`

**Raw HTML**
- [ ] One H1 that says what the page answers
- [ ] The full text in the HTML the server sends: no JavaScript needed to read it
- [ ] H2 sections with lists and tables assistants can lift whole

**AI crawler access**
- [ ] `robots.txt` names and allows the search and live-fetch crawlers (OAI-SearchBot, ChatGPT-User, Claude-SearchBot, Claude-User, PerplexityBot, Googlebot, Bingbot…)
- [ ] Your CDN or firewall serves those user agents, not a 403 challenge
- [ ] `/llms.txt` with a `#` title, a `>` summary and links to your key pages

**Quotability**
- [ ] The first sentence under the H1 answers the question in under 45 words
- [ ] Specific, checkable facts near the top: prices, timelines, counts, dates
- [ ] Headings phrased as the questions people ask, answered in the sentence below
- [ ] A visible, machine-readable updated date

## API

| Import | Exports |
| --- | --- |
| `geo-kit` | `organization`, `webSite`, `webPage`, `breadcrumbList`, `article`, `product`, `faqPage`, `softwareApplication`, `person`, `graph`, `ref`, `idFor`, `serializeJsonLd`, `validateJsonLd` · `generateLlmsTxt`, `generateLlmsFullTxt`, `parseLlmsTxt`, `textResponse` · `aiRobots`, `renderRobotsTxt`, `parseRobotsTxt`, `isAllowed` · `AI_CRAWLERS`, `ANSWER_ENGINE_CRAWLERS`, `crawlersFor` |
| `geo-kit/react` | `JsonLd` |
| `geo-kit/audit` | `auditUrl`, `analyse`, `formatReport`, `countFacts` |

Every builder is fully typed, drops empty values, and gives each node a stable `@id` (`https://example.com/#organization`) so nodes link up across pages.

## AI crawlers

| Purpose | User agents |
| --- | --- |
| Search: indexes pages to cite in answers | OAI-SearchBot, Claude-SearchBot, PerplexityBot, Googlebot, Bingbot, Applebot, Amazonbot, MistralAI-Index |
| Live fetch: reads a page because a person asked | ChatGPT-User, Claude-User, Perplexity-User, DuckAssistBot, Meta-ExternalFetcher, MistralAI-User |
| Training: collects pages for future models | GPTBot, ClaudeBot, Google-Extended, Applebot-Extended, meta-externalagent, MistralAI-Training, CCBot, cohere-ai, Bytespider |

Blocking training crawlers does not stop you being quoted; blocking the first two rows does. `Google-Extended` and `Applebot-Extended` are control tokens: they never fetch, but they decide whether Gemini and Apple Intelligence may use what Googlebot and Applebot collected. Names come from each vendor's own crawler documentation, linked in [`src/crawlers.ts`](src/crawlers.ts).

## Contributing

Issues and pull requests are welcome, especially new crawler tokens as vendors publish them.

```bash
npm install
npm test
npm run build && node dist/cli.js audit https://your-site.com
```

## Licence

MIT © Bez

---

Need an AI product or an AI-search-ready site built? Softgen builds them: the [AI app development agency](https://softgen.co.uk) behind AI apps, SaaS platforms, MVPs and mobile apps that ship in weeks.
