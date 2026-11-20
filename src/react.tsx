import { serializeJsonLd, type JsonLdDocument, type JsonLdNode } from "./jsonld.js";

export interface JsonLdProps {
  /** One node, a list of nodes (wrapped in a @graph for you) or a finished document from `graph()`. */
  data: JsonLdDocument | JsonLdNode[];
  /** Optional id for the script tag. */
  id?: string;
  /** CSP nonce, if your site uses one for inline scripts. */
  nonce?: string;
}

/**
 * Renders JSON-LD as a server-rendered <script type="application/ld+json"> tag.
 * Works in Next.js App Router server components (no "use client" needed), so the
 * structured data is in the raw HTML that AI crawlers read.
 */
export function JsonLd({ data, id, nonce }: JsonLdProps) {
  return (
    <script
      type="application/ld+json"
      id={id}
      nonce={nonce}
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  );
}

export default JsonLd;
