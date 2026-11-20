/**
 * AI and search crawlers, by what they do with your pages.
 *
 * - `search`   indexes pages so an assistant can find and cite them in answers (the one that gets you quoted).
 * - `user`     fetches a page live because a person asked an assistant about it.
 * - `training` collects pages to train future models. Blocking it does not stop you being cited.
 *
 * Names are the robots.txt user-agent tokens each vendor documents. `Google-Extended` and
 * `Applebot-Extended` are control tokens only: they never fetch pages themselves, but robots.txt
 * rules for them decide whether Gemini and Apple Intelligence may use what Googlebot and Applebot fetched.
 */

export type CrawlerPurpose = "search" | "user" | "training";

export interface Crawler {
  /** The robots.txt user-agent token. */
  token: string;
  vendor: string;
  /** The product it feeds. */
  product: string;
  purpose: CrawlerPurpose;
  docs?: string;
}

export const AI_CRAWLERS: readonly Crawler[] = [
  // OpenAI
  { token: "OAI-SearchBot", vendor: "OpenAI", product: "ChatGPT search", purpose: "search", docs: "https://platform.openai.com/docs/bots" },
  { token: "ChatGPT-User", vendor: "OpenAI", product: "ChatGPT (live fetch)", purpose: "user", docs: "https://platform.openai.com/docs/bots" },
  { token: "GPTBot", vendor: "OpenAI", product: "OpenAI model training", purpose: "training", docs: "https://platform.openai.com/docs/bots" },
  // Anthropic
  { token: "Claude-SearchBot", vendor: "Anthropic", product: "Claude search", purpose: "search", docs: "https://support.anthropic.com/en/articles/8896518" },
  { token: "Claude-User", vendor: "Anthropic", product: "Claude (live fetch)", purpose: "user", docs: "https://support.anthropic.com/en/articles/8896518" },
  { token: "ClaudeBot", vendor: "Anthropic", product: "Anthropic model training", purpose: "training", docs: "https://support.anthropic.com/en/articles/8896518" },
  // Perplexity
  { token: "PerplexityBot", vendor: "Perplexity", product: "Perplexity search", purpose: "search", docs: "https://docs.perplexity.ai/guides/bots" },
  { token: "Perplexity-User", vendor: "Perplexity", product: "Perplexity (live fetch)", purpose: "user", docs: "https://docs.perplexity.ai/guides/bots" },
  // Google
  { token: "Googlebot", vendor: "Google", product: "Google Search, AI Overviews and AI Mode", purpose: "search", docs: "https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers" },
  { token: "Google-Extended", vendor: "Google", product: "Gemini apps and grounding (control token)", purpose: "training", docs: "https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers" },
  // Microsoft
  { token: "Bingbot", vendor: "Microsoft", product: "Bing and Copilot", purpose: "search", docs: "https://www.bing.com/webmasters/help/which-crawlers-does-bing-use-8c184ec0" },
  // Apple
  { token: "Applebot", vendor: "Apple", product: "Siri and Spotlight", purpose: "search", docs: "https://support.apple.com/en-gb/119829" },
  { token: "Applebot-Extended", vendor: "Apple", product: "Apple Intelligence (control token)", purpose: "training", docs: "https://support.apple.com/en-gb/119829" },
  // DuckDuckGo
  { token: "DuckAssistBot", vendor: "DuckDuckGo", product: "DuckAssist answers", purpose: "user", docs: "https://duckduckgo.com/duckduckgo-help-pages/results/duckassistbot" },
  // Meta
  { token: "Meta-ExternalFetcher", vendor: "Meta", product: "Meta AI (live fetch)", purpose: "user", docs: "https://developers.facebook.com/docs/sharing/webmasters/web-crawlers" },
  { token: "meta-externalagent", vendor: "Meta", product: "Meta AI training", purpose: "training", docs: "https://developers.facebook.com/docs/sharing/webmasters/web-crawlers" },
  // Amazon
  { token: "Amazonbot", vendor: "Amazon", product: "Alexa and Rufus answers", purpose: "search", docs: "https://developer.amazon.com/amazonbot" },
  // Mistral
  { token: "MistralAI-Index", vendor: "Mistral", product: "Le Chat search index", purpose: "search", docs: "https://docs.mistral.ai/robots" },
  { token: "MistralAI-User", vendor: "Mistral", product: "Le Chat (live fetch)", purpose: "user", docs: "https://docs.mistral.ai/robots" },
  { token: "MistralAI-Training", vendor: "Mistral", product: "Mistral model training", purpose: "training", docs: "https://docs.mistral.ai/robots" },
  // Others that train models
  { token: "CCBot", vendor: "Common Crawl", product: "Open web dataset used by many models", purpose: "training", docs: "https://commoncrawl.org/ccbot" },
  { token: "cohere-ai", vendor: "Cohere", product: "Cohere models", purpose: "training" },
  { token: "Bytespider", vendor: "ByteDance", product: "ByteDance models", purpose: "training" },
] as const;

/** The crawlers that decide whether you can be found and quoted in AI answers today. */
export const ANSWER_ENGINE_CRAWLERS = AI_CRAWLERS.filter((c) => c.purpose !== "training");

export function crawlersFor(...purposes: CrawlerPurpose[]): string[] {
  return AI_CRAWLERS.filter((c) => purposes.includes(c.purpose)).map((c) => c.token);
}
