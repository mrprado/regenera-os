// Name matching against sanctions entries. Deliberately conservative and explainable: an exact normalized name, or
// a strong token overlap. A hit is "possible": a person reviews it. Single-word names only match exactly.
import { normalizeAlias } from "@/lib/ontology/identity";
import type { SanctionsEntry } from "./parse";

export type Indexed = { e: SanctionsEntry; list: string; norm: string; tokens: Set<string> };
export type Hit = { list: string; listId: string; name: string; kind: string; programme: string; country: string; score: number; how: string };

const tokensOf = (norm: string) => new Set(norm.split(" ").filter(t => t.length >= 2));

export function indexEntries(list: string, entries: SanctionsEntry[]): Indexed[] {
  return entries.map(e => { const norm = normalizeAlias("name", e[1]); return { e, list, norm, tokens: tokensOf(norm) }; }).filter(x => x.norm.length >= 2);
}

export function matchName(name: string, index: Indexed[], limit = 10): Hit[] {
  const qn = normalizeAlias("name", name);
  const q = tokensOf(qn);
  if (!qn) return [];
  const hits: Hit[] = [];
  for (const x of index) {
    let score = 0, how = "";
    if (x.norm === qn) { score = 1; how = "Exact name (after removing punctuation, accents and legal suffixes)"; }
    else if (q.size >= 2 && x.tokens.size >= 2) {
      let common = 0;
      for (const t of q) if (x.tokens.has(t)) common++;
      const overlap = common / Math.max(q.size, x.tokens.size);
      if (overlap >= 0.75) { score = Math.round(overlap * 100) / 100; how = `${common} of ${Math.max(q.size, x.tokens.size)} name words in common`; }
      else if (common === q.size && x.tokens.size <= q.size + 1) { score = 0.7; how = "Every word of the name appears in the listed name"; }
    }
    if (score) hits.push({ list: x.list, listId: x.e[0], name: x.e[1], kind: x.e[2], programme: x.e[3], country: x.e[4], score, how });
  }
  const best = new Map<string, Hit>();
  for (const h of hits.sort((a, b) => b.score - a.score)) if (!best.has(`${h.list}|${h.listId}`)) best.set(`${h.list}|${h.listId}`, h);
  return [...best.values()].slice(0, limit);
}
