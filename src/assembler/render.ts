import type { RetrievedChunk } from '../store/retrieval.js';
import { DEFAULT_STOP_CONDITIONS } from './stopConditions.js';

export interface PackSections { header: string; alwaysOn: string; template: string; retrieved: string; stack: string; footer: string }

export function renderPack(s: PackSections): string {
  return [
    '# Context pack',
    '## 1. Header', s.header,
    '## 2. Always-on standards', s.alwaysOn || '(none)',
    '## 3. Phase template', s.template || '(none)',
    '## 4. Retrieved knowledge', s.retrieved || '(none)',
    '## 5. Stack guides', s.stack || '(none)',
    '## 6. Stop conditions and next gate', s.footer,
  ].join('\n\n');
}

function attr(v: string): string { return v.replace(/&/g, '&amp;').replace(/"/g, '&quot;'); }

// Neutralizes any closing-tag sequence a chunk's body might contain so it cannot prematurely
// terminate our own <retrieved> wrapper and forge a fake, differently-attributed block after it.
function escapeBody(v: string): string { return v.replace(/<\/retrieved/gi, '&lt;/retrieved'); }

export function renderChunk(c: RetrievedChunk): string {
  return `<retrieved id="${attr(c.stable_id)}" version="${c.version}" path="${attr(c.heading_path)}" match="${c.match}">\n${escapeBody(c.text)}\n</retrieved>`;
}

export function renderAlwaysOn(items: { stable_id: string; version: number; title: string; body: string }[]): string {
  return items.map((i) => `### ${i.title} [${i.stable_id} v${i.version}]\n${i.body.trim()}`).join('\n\n');
}

export function renderStopConditions(appConditions: string[]): string {
  return ['Stop and ask a human when:', ...[...DEFAULT_STOP_CONDITIONS, ...appConditions].map((s) => `- ${s}`)].join('\n');
}
