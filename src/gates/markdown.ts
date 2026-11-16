/** `fence` marks the delimiter lines of a fenced block: the line that opens it and the line that closes it. */
export interface Line { n: number; text: string; inFence: boolean; fence?: 'open' | 'close' }
export interface Section { heading: string; level: number; startLine: number; endLine: number; body: Line[] }

const FENCE = /^\s*(`{3,}|~{3,})(.*)$/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;

interface FenceMark { char: string; len: number; info: string }

function fenceMark(text: string): FenceMark | null {
  const m = FENCE.exec(text);
  if (!m) return null;
  const char = m[1]![0]!;
  const info = m[2]!.trim();
  // an info string after backticks may not contain a backtick (that is inline code, not a fence)
  if (char === '`' && info.includes('`')) return null;
  return { char, len: m[1]!.length, info };
}

/**
 * Index of the line that closes the fence opened at `open`, or null when it never closes.
 * Only lines of the opener's character and at least its length matter: shorter or other-character
 * fences can never close it, so they are plain content.
 * - nested: agents often show a fenced sample inside a fence of the same length (```md ... ```bash ...
 *   ``` ... ```). A line with an info string opens a nested level and the next bare line closes it,
 *   so the outer fence closes at the bare line that balances it.
 * - strict (CommonMark): the first bare line closes the fence; a line with an info string is content.
 */
function fenceEnd(texts: string[], open: number, opener: FenceMark, nested: boolean): number | null {
  const depth: number[] = [];
  for (let i = open + 1; i < texts.length; i++) {
    const f = fenceMark(texts[i]!);
    if (!f || f.char !== opener.char || f.len < opener.len) continue;
    if (f.info !== '') { if (nested) depth.push(f.len); continue; }
    if (depth.length === 0) return i;
    if (f.len >= depth[depth.length - 1]!) depth.pop();
  }
  return null;
}

/**
 * Splits markdown into numbered lines and marks fenced code blocks. A fence closes on a bare line of
 * the same character, at least as long as the opener; ``` inside a ```` fence and ~~~ inside a ```
 * fence are content. Same-length nested samples pair up (see fenceEnd); when pairing leaves the
 * outer fence unclosed, the strict CommonMark reading is used instead, and a fence that closes under
 * neither reading runs to the end of the document.
 */
export function lines(md: string): Line[] {
  const texts = md.split(/\r?\n/);
  const out: Line[] = [];
  for (let i = 0; i < texts.length; i++) {
    const opener = fenceMark(texts[i]!);
    if (!opener) { out.push({ n: i + 1, text: texts[i]!, inFence: false }); continue; }
    const end = fenceEnd(texts, i, opener, true) ?? fenceEnd(texts, i, opener, false);
    const last = end ?? texts.length - 1;
    out.push({ n: i + 1, text: texts[i]!, inFence: true, fence: 'open' });
    for (let j = i + 1; j <= last; j++) {
      out.push(j === end ? { n: j + 1, text: texts[j]!, inFence: true, fence: 'close' } : { n: j + 1, text: texts[j]!, inFence: true });
    }
    i = last;
  }
  return out;
}

export function normalizeHeading(text: string): string {
  return text
    .replace(/^#{1,6}\s+/, '')
    .replace(/\s*#+\s*$/, '')
    .replace(/^\d+(\.\d+)*\.?\s+/, '')
    .trim()
    .toLowerCase();
}

export function isHeadingLine(line: Line): boolean {
  return !line.inFence && HEADING.test(line.text);
}

export function parseSections(md: string): Section[] {
  const ls = lines(md);
  const sections: Section[] = [];
  for (let i = 0; i < ls.length; i++) {
    const line = ls[i]!;
    if (!isHeadingLine(line)) continue;
    const m = HEADING.exec(line.text)!;
    const level = m[1]!.length;
    const body: Line[] = [];
    let end = ls.length;
    for (let j = i + 1; j < ls.length; j++) {
      const next = ls[j]!;
      if (isHeadingLine(next) && HEADING.exec(next.text)![1]!.length <= level) { end = next.n - 1; break; }
      body.push(next);
    }
    sections.push({ heading: m[2]!.replace(/\s*#+$/, '').trim(), level, startLine: line.n, endLine: end, body });
  }
  return sections;
}

export function findSection(sections: Section[], name: string): Section | undefined {
  const wanted = normalizeHeading(name);
  return sections.find((s) => normalizeHeading(s.heading) === wanted);
}

export function isNonEmpty(section: Section): boolean {
  return section.body.some((l) => l.text.trim() !== '' && !isHeadingLine(l));
}

/** Lines of `section` that are not sub-headings (used by measurable_criteria). */
export function contentLines(section: Section): Line[] {
  return section.body.filter((l) => l.text.trim() !== '' && !isHeadingLine(l));
}
