import type { Check, Group, Status } from "./analyse.js";
import type { AuditRun } from "./run.js";

const GROUPS: Group[] = ["Structured data", "Head", "Raw HTML", "AI crawler access", "Quotability"];

export interface FormatOptions {
  color?: boolean;
  /** Show the detail line for passing checks too. Default true. */
  verbose?: boolean;
}

export function formatReport(r: AuditRun, opts: FormatOptions = {}): string {
  const c = palette(opts.color ?? false);
  const icon: Record<Status, string> = { pass: c.green("✓"), warn: c.yellow("!"), fail: c.red("✗") };
  const width = Math.max(...r.checks.map((k) => k.label.length)) + 2;
  const out: string[] = [];
  out.push(`${c.bold("geo-kit audit")}  ${r.fetch.finalUrl}`);
  out.push(c.dim(`${r.fetch.status} · ${(r.fetch.bytes / 1024).toFixed(0)} KB HTML · ${r.fetch.ms} ms`));
  for (const g of GROUPS) {
    const rows = r.checks.filter((k) => k.group === g);
    if (!rows.length) continue;
    out.push("", c.bold(g));
    for (const k of rows) out.push(`  ${icon[k.status]} ${k.label.padEnd(width)}${c.dim(k.detail)}`);
  }
  const colourScore = r.score >= 75 ? c.green : r.score >= 55 ? c.yellow : c.red;
  out.push("", `${c.bold("Score")}  ${colourScore(c.bold(`${r.score}/100`))}  ${r.grade}`);
  const fixes = topFixes(r.checks);
  if (fixes.length) {
    out.push("", c.bold("Fix first"));
    fixes.forEach((k, i) => out.push(`  ${i + 1}. ${k.fix}`));
  }
  return out.join("\n");
}

export function topFixes(checks: Check[], n = 3): Check[] {
  return checks
    .filter((k) => k.status !== "pass" && k.fix)
    .sort((a, b) => (b.status === "fail" ? 2 : 1) * b.weight - (a.status === "fail" ? 2 : 1) * a.weight)
    .slice(0, n);
}

function palette(on: boolean) {
  const wrap = (code: string) => (s: string) => (on ? `\x1b[${code}m${s}\x1b[0m` : s);
  return { bold: wrap("1"), dim: wrap("2"), red: wrap("31"), green: wrap("32"), yellow: wrap("33") };
}
