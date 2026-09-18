import type { RoutingEvent } from '../types';

export function typeBadge(e: RoutingEvent): string {
  if (e.feature_id) return 'feature';
  if (e.lite) return 'lite';
  if (e.intent === 'feature' || e.intent === 'product') return `${e.intent} · not started`;
  return e.intent;
}
