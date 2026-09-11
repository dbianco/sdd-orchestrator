export const EXACT_ID_PATTERN = /\b(ADR|REQ|US|INC)-\d+\b/g;

export function extractExactIds(...texts: (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of texts) {
    if (!t) continue;
    for (const m of t.matchAll(EXACT_ID_PATTERN)) {
      if (!seen.has(m[0])) { seen.add(m[0]); out.push(m[0]); }
    }
  }
  return out;
}
