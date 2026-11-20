/**
 * Shape checks for JSON-LD: the properties Google's rich results and AI assistants rely on.
 * Not a full schema.org validator; it catches the mistakes that cost citations.
 */

export type Severity = "error" | "warning";

export interface LdIssue {
  severity: Severity;
  type: string;
  message: string;
}

interface Spec {
  required: string[];
  recommended: string[];
  check?: (n: Record<string, unknown>) => LdIssue[];
}

const has = (n: Record<string, unknown>, k: string) => {
  const v = n[k];
  return v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0);
};

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const SPECS: Record<string, Spec> = {
  Organization: { required: ["name", "url"], recommended: ["logo", "sameAs", "description"] },
  WebSite: { required: ["name", "url"], recommended: ["publisher"] },
  WebPage: { required: ["name"], recommended: ["url", "description", "isPartOf"] },
  Person: { required: ["name"], recommended: ["url", "sameAs"] },
  BreadcrumbList: {
    required: ["itemListElement"],
    recommended: [],
    check: (n) => {
      const out: LdIssue[] = [];
      asArray(n.itemListElement).forEach((li, i) => {
        if (!isObj(li) || !has(li, "position") || !has(li, "name")) {
          out.push({ severity: "error", type: "BreadcrumbList", message: `item ${i + 1} needs position and name` });
        } else if (!has(li, "item") && i < asArray(n.itemListElement).length - 1) {
          out.push({ severity: "warning", type: "BreadcrumbList", message: `item ${i + 1} has no item URL` });
        }
      });
      return out;
    },
  },
  Article: {
    required: ["headline", "author", "datePublished"],
    recommended: ["dateModified", "image", "publisher"],
    check: (n) =>
      typeof n.headline === "string" && n.headline.length > 110
        ? [{ severity: "warning", type: "Article", message: "headline is over 110 characters" }]
        : [],
  },
  Product: {
    required: ["name"],
    recommended: ["image", "description", "brand"],
    check: (n) =>
      has(n, "offers") || has(n, "aggregateRating") || has(n, "review")
        ? asArray(n.offers).flatMap((o) =>
            isObj(o) && o["@type"] !== "AggregateOffer" && (!has(o, "price") || !has(o, "priceCurrency"))
              ? [{ severity: "error" as const, type: "Product", message: "offer needs price and priceCurrency" }]
              : [],
          )
        : [{ severity: "error", type: "Product", message: "needs offers, aggregateRating or review" }],
  },
  FAQPage: {
    required: ["mainEntity"],
    recommended: [],
    check: (n) =>
      asArray(n.mainEntity).flatMap((q, i) => {
        if (!isObj(q) || !has(q, "name")) return [{ severity: "error" as const, type: "FAQPage", message: `question ${i + 1} has no name` }];
        const a = q.acceptedAnswer;
        if (!isObj(a) || !has(a, "text")) return [{ severity: "error" as const, type: "FAQPage", message: `question ${i + 1} has no acceptedAnswer.text` }];
        return [];
      }),
  },
  SoftwareApplication: {
    required: ["name"],
    recommended: ["applicationCategory", "operatingSystem", "offers"],
  },
};

// Subtypes inherit their parent's checks.
const ALIASES: Record<string, string> = {
  BlogPosting: "Article",
  NewsArticle: "Article",
  TechArticle: "Article",
  AboutPage: "WebPage",
  ContactPage: "WebPage",
  CollectionPage: "WebPage",
  ItemPage: "WebPage",
  ProfilePage: "WebPage",
  SearchResultsPage: "WebPage",
  WebApplication: "SoftwareApplication",
  MobileApplication: "SoftwareApplication",
  VideoGame: "SoftwareApplication",
  LocalBusiness: "Organization",
  ProfessionalService: "Organization",
  Corporation: "Organization",
  OnlineStore: "Organization",
  NGO: "Organization",
};

export function canonicalType(t: string): string {
  const bare = t.replace(/^https?:\/\/schema\.org\//, "");
  return ALIASES[bare] ?? bare;
}

/** Every node in a JSON-LD document: @graph members, arrays, and nested typed objects. */
export function collectNodes(doc: unknown): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const walk = (v: unknown, depth: number) => {
    if (depth > 12) return;
    if (Array.isArray(v)) return v.forEach((x) => walk(x, depth + 1));
    if (!isObj(v)) return;
    if (v["@type"]) out.push(v);
    for (const [k, child] of Object.entries(v)) if (k !== "@context") walk(child, depth + 1);
  };
  walk(doc, 0);
  return out;
}

export function nodeTypes(n: Record<string, unknown>): string[] {
  return asArray(n["@type"]).filter((t): t is string => typeof t === "string");
}

/** Check one JSON-LD document. Only top-level and @graph nodes get required-property checks. */
export function validateJsonLd(doc: unknown): LdIssue[] {
  const issues: LdIssue[] = [];
  if (!isObj(doc) && !Array.isArray(doc)) return [{ severity: "error", type: "-", message: "not a JSON object" }];
  const roots = Array.isArray(doc) ? doc : isObj(doc) && Array.isArray(doc["@graph"]) ? doc["@graph"] : [doc];
  const ctxOk = (d: unknown) => isObj(d) && typeof d["@context"] === "string" && /schema\.org/.test(d["@context"] as string);
  const anyCtx = Array.isArray(doc) ? doc.every(ctxOk) : ctxOk(doc) || (isObj(doc) && isObj(doc["@context"]));
  if (!anyCtx) issues.push({ severity: "error", type: "-", message: '@context is missing or not "https://schema.org"' });

  for (const n of roots) {
    if (!isObj(n)) continue;
    const types = nodeTypes(n);
    if (!types.length) {
      if (!has(n, "@id")) issues.push({ severity: "error", type: "-", message: "node without @type" });
      continue;
    }
    for (const t of types) {
      const spec = SPECS[canonicalType(t)];
      if (!spec) continue;
      for (const k of spec.required) if (!has(n, k)) issues.push({ severity: "error", type: t, message: `missing ${k}` });
      for (const k of spec.recommended) if (!has(n, k)) issues.push({ severity: "warning", type: t, message: `add ${k}` });
      if (spec.check) issues.push(...spec.check(n).map((i) => ({ ...i, type: t })));
    }
  }
  return issues;
}
