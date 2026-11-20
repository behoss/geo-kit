import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { JsonLd } from "../src/react.js";
import { graph, organization } from "../src/index.js";

describe("<JsonLd>", () => {
  it("renders a server-side ld+json script", () => {
    const html = renderToStaticMarkup(<JsonLd data={graph(organization({ name: "Example <Shop>", url: "https://example.com" }))} nonce="abc" />);
    expect(html.startsWith('<script type="application/ld+json" nonce="abc">')).toBe(true);
    expect(html).toContain("\\u003cShop\\u003e");
    const json = html.replace(/^<script[^>]*>/, "").replace(/<\/script>$/, "");
    expect(JSON.parse(json)["@graph"][0].name).toBe("Example <Shop>");
  });
});
