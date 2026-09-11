import type { Intent } from '../domain/types.js';

export type InferableIntent = 'incident' | 'remediation' | 'refactor' | 'spike' | 'product';
export type IntentPhraseLists = Record<InferableIntent, string[]>;

// Order matters: the first list with a match wins (spec §8.1).
export const INFERENCE_ORDER: InferableIntent[] = ['incident', 'remediation', 'refactor', 'spike', 'product'];

export const DEFAULT_PHRASE_LISTS: IntentPhraseLists = {
  incident: ['outage', 'production is down', 'hotfix', 'P1', 'INC-\\d+'],
  remediation: ['CVE-\\d+', 'vulnerability', 'Snyk', 'deprecated library'],
  refactor: ['refactor', 'no behaviour change', 'no behavior change', 'extract', 'untangle'],
  spike: ['can we', 'prototype', 'spike', 'is it possible'],
  product: ['whole product', 'new product', 'PRD'],
};

function toRegex(phrase: string): RegExp {
  // Phrases are regex fragments (some contain \d+). Wrap with word boundaries, case-insensitive.
  return new RegExp(`\\b(?:${phrase})\\b`, 'i');
}

export function inferIntent(
  text: string,
  lists: IntentPhraseLists = DEFAULT_PHRASE_LISTS,
): { intent: Intent; matched: string | null } {
  for (const intent of INFERENCE_ORDER) {
    for (const phrase of lists[intent]) {
      if (toRegex(phrase).test(text)) return { intent, matched: phrase };
    }
  }
  return { intent: 'feature', matched: null };
}
