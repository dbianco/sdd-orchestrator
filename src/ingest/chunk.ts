import { lines, type Line } from '../gates/markdown.js';
import { countTokens } from '../tokens.js';

export const CHUNK_TOKEN_CAP = 512;
export interface Chunk { ordinal: number; heading_path: string; text: string; token_count: number }

interface Section { path: string; lines: Line[] }

function splitByHeading(ls: Line[], level: number, basePath: string): Section[] {
  const re = new RegExp(`^#{${level}}\\s+(.+?)\\s*#*\\s*$`);
  const out: Section[] = [];
  let current: Section = { path: basePath, lines: [] };
  for (const line of ls) {
    const m = line.inFence ? null : re.exec(line.text);
    if (m) {
      if (current.lines.some((l) => l.text.trim() !== '')) out.push(current);
      current = { path: basePath ? `${basePath} > ${m[1]!.trim()}` : m[1]!.trim(), lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  if (current.lines.some((l) => l.text.trim() !== '')) out.push(current);
  return out;
}

/** Atomic blocks: fenced code, tables (consecutive `|` lines), otherwise paragraphs separated by blank lines. */
function blocks(ls: Line[]): string[] {
  const out: string[] = [];
  let buf: string[] = [];
  let mode: 'para' | 'fence' | 'table' = 'para';
  const flush = () => { if (buf.length > 0) { out.push(buf.join('\n')); buf = []; } };
  for (const line of ls) {
    const isFenceLine = /^\s*(```|~~~)/.test(line.text);
    const isTableLine = /^\s*\|/.test(line.text);
    if (mode === 'fence') { buf.push(line.text); if (isFenceLine) { flush(); mode = 'para'; } continue; }
    if (isFenceLine) { flush(); mode = 'fence'; buf.push(line.text); continue; }
    if (mode === 'table' && !isTableLine) { flush(); mode = 'para'; }
    if (isTableLine) { if (mode !== 'table') { flush(); mode = 'table'; } buf.push(line.text); continue; }
    if (line.text.trim() === '') { flush(); continue; }
    buf.push(line.text);
  }
  flush();
  return out;
}

function packBlocks(bs: string[], cap: number): string[] {
  const out: string[] = [];
  let cur = '';
  for (const b of bs) {
    const candidate = cur ? `${cur}\n\n${b}` : b;
    if (cur && countTokens(candidate) > cap) { out.push(cur); cur = b; } else cur = candidate;
  }
  if (cur) out.push(cur);
  return out;
}

export function chunkMarkdown(body: string, cap = CHUNK_TOKEN_CAP): Chunk[] {
  const texts: { path: string; text: string }[] = [];
  for (const h2 of splitByHeading(lines(body), 2, '')) {
    const whole = blocks(h2.lines).join('\n\n');
    if (!whole.trim()) continue;
    if (countTokens(whole) <= cap) { texts.push({ path: h2.path, text: whole }); continue; }
    for (const h3 of splitByHeading(h2.lines, 3, h2.path)) {
      const bs = blocks(h3.lines);
      for (const text of packBlocks(bs, cap)) texts.push({ path: h3.path, text });
    }
  }
  return texts.map((t, i) => ({ ordinal: i, heading_path: t.path, text: t.text, token_count: countTokens(t.text) }));
}

export function embedText(title: string, chunk: Pick<Chunk, 'heading_path' | 'text'>): string {
  return chunk.heading_path ? `${title} > ${chunk.heading_path}\n\n${chunk.text}` : `${title}\n\n${chunk.text}`;
}
