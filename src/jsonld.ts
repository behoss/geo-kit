/**
 * Typed schema.org JSON-LD builders.
 *
 * Every builder takes a small, typed input and returns a plain JSON-LD node. Combine nodes with
 * `graph()` so one <script type="application/ld+json"> carries a linked @graph, and render it
 * with `serializeJsonLd()` or the `<JsonLd>` React component (`geo-kit/react`).
 *
 * Builders drop empty values, so optional fields never ship as `undefined` or `[]`.
 */

export const SCHEMA_CONTEXT = "https://schema.org" as const;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

/** A single JSON-LD node: always has an @type, often an @id. */
export interface JsonLdNode {
  "@type": string | string[];
  "@id"?: string;
  "@context"?: typeof SCHEMA_CONTEXT;
  [key: string]: JsonValue | undefined;
}

/** A JSON-LD document: one node with @context, or a @graph of nodes. */
export interface JsonLdGraph {
  "@context": typeof SCHEMA_CONTEXT;
  "@graph": JsonLdNode[];
}

export type JsonLdDocument = JsonLdNode | JsonLdGraph;

/** A reference to another node in the graph by @id, optionally with a name for parsers that don't resolve refs. */
export interface Ref {
  "@id": string;
  "@type"?: string;
  name?: string;
}

type Maybe<T> = T | undefined | null;

/** Remove undefined, null, empty strings and empty arrays (recursively) so nodes stay clean. */
export function compact<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => compact(v)).filter((v) => !isEmpty(v)) as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const c = compact(v);
      if (!isEmpty(c)) out[k] = c;
    }
    return out as T;
  }
  return value;
}

function isEmpty(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === "string" && v.trim() === "") return true;
  if (Array.isArray(v) && v.length === 0) return true;
  if (typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length === 0) return true;
  return false;
}

function node(type: string | string[], fields: Record<string, unknown>): JsonLdNode {
  return compact({ "@type": type, ...fields }) as JsonLdNode;
}

/** Build a stable @id from a canonical URL and a fragment, e.g. idFor("https://example.com", "organization"). */
export function idFor(url: string, fragment: string): string {
  return `${url.replace(/#.*$/, "").replace(/\/$/, "")}/#${fragment.replace(/^#/, "")}`;
}

/** Reference a node by @id. */
export function ref(id: string, extra: Omit<Ref, "@id"> = {}): Ref {
  return compact({ "@id": id, ...extra });
}

// --------------------------------------------------------------------------------------------- //
// Builders
// --------------------------------------------------------------------------------------------- //

export interface ImageInput {
  url: string;
  width?: number;
  height?: number;
  caption?: string;
}

function image(i: Maybe<string | ImageInput>) {
  if (!i) return undefined;
  if (typeof i === "string") return i;
  return { "@type": "ImageObject", url: i.url, width: i.width, height: i.height, caption: i.caption };
}

export interface PostalAddressInput {
  streetAddress?: string;
  addressLocality?: string;
  addressRegion?: string;
  postalCode?: string;
  /** ISO 3166-1 alpha-2, e.g. "GB". */
  addressCountry?: string;
}

export interface OrganizationInput {
  name: string;
  url: string;
  id?: string;
  /** Type override, e.g. "LocalBusiness" or "ProfessionalService". Defaults to "Organization". */
  type?: string;
  alternateName?: string | string[];
  description?: string;
  /** One line that tells assistants who you are and who you are not. */
  disambiguatingDescription?: string;
  logo?: string | ImageInput;
  image?: string | ImageInput;
  email?: string;
  telephone?: string;
  /** Profiles that prove identity: LinkedIn, GitHub, Wikipedia, Crunchbase, review sites. */
  sameAs?: string[];
  knowsAbout?: string[];
  areaServed?: string | string[];
  address?: PostalAddressInput;
  founder?: Ref | PersonInput;
  foundingDate?: string;
  slogan?: string;
}

export function organization(i: OrganizationInput): JsonLdNode {
  return node(i.type ?? "Organization", {
    "@id": i.id ?? idFor(i.url, "organization"),
    name: i.name,
    alternateName: i.alternateName,
    url: i.url,
    description: i.description,
    disambiguatingDescription: i.disambiguatingDescription,
    logo: image(i.logo),
    image: image(i.image),
    email: i.email,
    telephone: i.telephone,
    sameAs: i.sameAs,
    knowsAbout: i.knowsAbout,
    areaServed: i.areaServed,
    slogan: i.slogan,
    foundingDate: i.foundingDate,
    address: i.address ? { "@type": "PostalAddress", ...i.address } : undefined,
    founder: i.founder ? personOrRef(i.founder) : undefined,
  });
}

export interface PersonInput {
  name: string;
  url?: string;
  id?: string;
  jobTitle?: string;
  description?: string;
  image?: string | ImageInput;
  sameAs?: string[];
  knowsAbout?: string[];
  worksFor?: Ref;
}

export function person(i: PersonInput): JsonLdNode {
  return node("Person", {
    "@id": i.id ?? (i.url ? idFor(i.url, "person") : undefined),
    name: i.name,
    url: i.url,
    jobTitle: i.jobTitle,
    description: i.description,
    image: image(i.image),
    sameAs: i.sameAs,
    knowsAbout: i.knowsAbout,
    worksFor: i.worksFor,
  });
}

function isRef(x: object): x is Ref {
  return "@id" in x;
}

function personOrRef(p: Ref | PersonInput) {
  return isRef(p) ? p : person(p);
}

function authorValue(a: Ref | PersonInput | Array<Ref | PersonInput>) {
  return Array.isArray(a) ? a.map(personOrRef) : personOrRef(a);
}

export interface WebSiteInput {
  name: string;
  url: string;
  id?: string;
  description?: string;
  /** en-GB, en-US… */
  inLanguage?: string;
  publisher?: Ref;
  /**
   * Site search URL with `{search_term_string}` where the query goes, e.g.
   * "https://example.com/search?q={search_term_string}". Adds a SearchAction.
   */
  searchUrlTemplate?: string;
}

export function webSite(i: WebSiteInput): JsonLdNode {
  return node("WebSite", {
    "@id": i.id ?? idFor(i.url, "website"),
    name: i.name,
    url: i.url,
    description: i.description,
    inLanguage: i.inLanguage,
    publisher: i.publisher,
    potentialAction: i.searchUrlTemplate
      ? {
          "@type": "SearchAction",
          target: { "@type": "EntryPoint", urlTemplate: i.searchUrlTemplate },
          "query-input": "required name=search_term_string",
        }
      : undefined,
  });
}

export interface WebPageInput {
  url: string;
  name: string;
  id?: string;
  /** Type override: "AboutPage", "ContactPage", "CollectionPage", "FAQPage"… Defaults to "WebPage". */
  type?: string;
  description?: string;
  inLanguage?: string;
  isPartOf?: Ref;
  about?: Ref;
  primaryImage?: string | ImageInput;
  datePublished?: string;
  dateModified?: string;
  breadcrumb?: Ref;
  /** CSS selectors for the parts an assistant should read aloud or quote (speakable). */
  speakableSelectors?: string[];
}

export function webPage(i: WebPageInput): JsonLdNode {
  return node(i.type ?? "WebPage", {
    "@id": i.id ?? idFor(i.url, "webpage"),
    url: i.url,
    name: i.name,
    description: i.description,
    inLanguage: i.inLanguage,
    isPartOf: i.isPartOf,
    about: i.about,
    primaryImageOfPage: image(i.primaryImage),
    datePublished: i.datePublished,
    dateModified: i.dateModified,
    breadcrumb: i.breadcrumb,
    speakable: i.speakableSelectors?.length
      ? { "@type": "SpeakableSpecification", cssSelector: i.speakableSelectors }
      : undefined,
  });
}

export interface BreadcrumbItem {
  name: string;
  url: string;
}

/** BreadcrumbList from ordered crumbs, home first. Positions are filled in for you. */
export function breadcrumbList(items: BreadcrumbItem[], opts: { id?: string } = {}): JsonLdNode {
  const last = items[items.length - 1];
  return node("BreadcrumbList", {
    "@id": opts.id ?? (last ? idFor(last.url, "breadcrumb") : undefined),
    itemListElement: items.map((c, idx) => ({
      "@type": "ListItem",
      position: idx + 1,
      name: c.name,
      item: c.url,
    })),
  });
}

export interface ArticleInput {
  url: string;
  headline: string;
  id?: string;
  /** "Article", "BlogPosting", "NewsArticle", "TechArticle"… Defaults to "Article". */
  type?: string;
  description?: string;
  image?: string | ImageInput | Array<string | ImageInput>;
  /** ISO 8601. */
  datePublished: string;
  /** ISO 8601. Only move it when the content genuinely changes. */
  dateModified?: string;
  author: Ref | PersonInput | Array<Ref | PersonInput>;
  publisher?: Ref | OrganizationInput;
  inLanguage?: string;
  wordCount?: number;
  keywords?: string[];
  articleSection?: string;
  isPartOf?: Ref;
}

export function article(i: ArticleInput): JsonLdNode {
  const images = Array.isArray(i.image) ? i.image.map(image) : image(i.image);
  return node(i.type ?? "Article", {
    "@id": i.id ?? idFor(i.url, "article"),
    mainEntityOfPage: i.url,
    headline: i.headline,
    description: i.description,
    image: images,
    datePublished: i.datePublished,
    dateModified: i.dateModified ?? i.datePublished,
    author: authorValue(i.author),
    publisher: i.publisher ? (isRef(i.publisher) ? i.publisher : organization(i.publisher)) : undefined,
    inLanguage: i.inLanguage,
    wordCount: i.wordCount,
    keywords: i.keywords?.join(", "),
    articleSection: i.articleSection,
    isPartOf: i.isPartOf,
  });
}

export interface OfferInput {
  price: number | string;
  /** ISO 4217, e.g. "GBP". */
  priceCurrency: string;
  url?: string;
  availability?: "InStock" | "OutOfStock" | "PreOrder" | "BackOrder" | "OnlineOnly" | "Discontinued";
  priceValidUntil?: string;
  seller?: Ref;
}

function offer(o: OfferInput) {
  return {
    "@type": "Offer",
    price: typeof o.price === "number" ? o.price.toFixed(2) : o.price,
    priceCurrency: o.priceCurrency,
    url: o.url,
    availability: o.availability ? `https://schema.org/${o.availability}` : undefined,
    priceValidUntil: o.priceValidUntil,
    seller: o.seller,
  };
}

export interface RatingInput {
  ratingValue: number;
  reviewCount: number;
  bestRating?: number;
}

function rating(r: Maybe<RatingInput>) {
  if (!r) return undefined;
  return { "@type": "AggregateRating", ratingValue: r.ratingValue, reviewCount: r.reviewCount, bestRating: r.bestRating ?? 5 };
}

export interface ProductInput {
  name: string;
  url: string;
  id?: string;
  description?: string;
  image?: string | string[];
  sku?: string;
  gtin?: string;
  mpn?: string;
  brand?: string;
  category?: string;
  offers?: OfferInput | OfferInput[];
  /** Only real ratings from real customers. */
  aggregateRating?: RatingInput;
}

export function product(i: ProductInput): JsonLdNode {
  const offers = Array.isArray(i.offers) ? i.offers.map(offer) : i.offers ? offer(i.offers) : undefined;
  return node("Product", {
    "@id": i.id ?? idFor(i.url, "product"),
    name: i.name,
    url: i.url,
    description: i.description,
    image: i.image,
    sku: i.sku,
    gtin: i.gtin,
    mpn: i.mpn,
    brand: i.brand ? { "@type": "Brand", name: i.brand } : undefined,
    category: i.category,
    offers,
    aggregateRating: rating(i.aggregateRating),
  });
}

export interface FaqItem {
  question: string;
  /** Plain text or simple HTML. Mirror exactly what the page shows. */
  answer: string;
}

export function faqPage(items: FaqItem[], opts: { url?: string; id?: string } = {}): JsonLdNode {
  return node("FAQPage", {
    "@id": opts.id ?? (opts.url ? idFor(opts.url, "faq") : undefined),
    url: opts.url,
    mainEntity: items.map((q) => ({
      "@type": "Question",
      name: q.question,
      acceptedAnswer: { "@type": "Answer", text: q.answer },
    })),
  });
}

export interface SoftwareApplicationInput {
  name: string;
  url: string;
  id?: string;
  /** "SoftwareApplication", "WebApplication" or "MobileApplication". */
  type?: "SoftwareApplication" | "WebApplication" | "MobileApplication";
  description?: string;
  /** e.g. "BusinessApplication", "DeveloperApplication", "GameApplication". */
  applicationCategory: string;
  operatingSystem?: string;
  softwareVersion?: string;
  downloadUrl?: string;
  screenshot?: string | string[];
  offers?: OfferInput | OfferInput[];
  aggregateRating?: RatingInput;
  author?: Ref | PersonInput;
  publisher?: Ref;
}

export function softwareApplication(i: SoftwareApplicationInput): JsonLdNode {
  const offers = Array.isArray(i.offers) ? i.offers.map(offer) : i.offers ? offer(i.offers) : undefined;
  return node(i.type ?? "SoftwareApplication", {
    "@id": i.id ?? idFor(i.url, "software"),
    name: i.name,
    url: i.url,
    description: i.description,
    applicationCategory: i.applicationCategory,
    operatingSystem: i.operatingSystem,
    softwareVersion: i.softwareVersion,
    downloadUrl: i.downloadUrl,
    screenshot: i.screenshot,
    offers,
    aggregateRating: rating(i.aggregateRating),
    author: i.author ? authorValue(i.author) : undefined,
    publisher: i.publisher,
  });
}

// --------------------------------------------------------------------------------------------- //
// Documents and serialisation
// --------------------------------------------------------------------------------------------- //

/** Wrap nodes in one linked @graph document. Falsy entries are skipped, so conditional nodes are easy. */
export function graph(...nodes: Array<Maybe<JsonLdNode | false>>): JsonLdGraph {
  return {
    "@context": SCHEMA_CONTEXT,
    "@graph": nodes.filter((n): n is JsonLdNode => Boolean(n)).map(({ "@context": _drop, ...rest }) => rest as JsonLdNode),
  };
}

/** Add @context to a single node so it can stand alone in a script tag. */
export function withContext(n: JsonLdNode): JsonLdNode {
  return { "@context": SCHEMA_CONTEXT, ...n };
}

/**
 * Serialise for a <script type="application/ld+json"> tag. Escapes `<`, `>`, `&` and the two
 * JavaScript line separators so user content can never close the script tag early.
 */
export function serializeJsonLd(doc: JsonLdDocument | JsonLdNode[]): string {
  const value = Array.isArray(doc) ? graph(...doc) : "@context" in doc ? doc : withContext(doc);
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
