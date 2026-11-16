/** `fence` marks the delimiter lines of a fenced block: the line that opens it and the line that closes it. */
export interface Line { n: number; text: string; inFence: boolean; fence?: 'open' | 'close' }
export interface Section { heading: string; level: number; startLine: number; endLine: number; body: Line[] }

const FENCE = /^\s*(`{3,}|~{3,})(.*)$/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;

/**
 * Splits markdown into numbered lines and tracks fenced code blocks as CommonMark does: a fence closes only
 * on a line of the same character, at least as long as the opener, with nothing but whitespace after it.
 * So a ```` fence can show ``` lines, a ``` fence can show ~~~ lines, and a ```ts line never closes a fence.
 * An unclosed fence runs to the end of the document.
 */
export function lines(md: string): Line[] {
  const out: Line[] = [];
  let fenceChar: string | null = null;
  let fenceLen = 0;
  md.split(/\r?\n/).forEach((text, i) => {
    const m = FENCE.exec(text);
    const n = i + 1;
    if (fenceChar === null) {
      // an info string after backticks may not contain a backtick (that is inline code, not a fence)
      if (m && !(m[1]![0] === '`' && m[2]!.includes('`'))) {
        fenceChar = m[1]![0]!;
        fenceLen = m[1]!.length;
        out.push({ n, text, inFence: true, fence: 'open' });
        return;
      }
      out.push({ n, text, inFence: false });
      return;
    }
    const closes = m !== null && m[1]![0] === fenceChar && m[1]!.length >= fenceLen && m[2]!.trim() === '';
    if (closes) {
      out.push({ n, text, inFence: true, fence: 'close' });
      fenceChar = null;
      fenceLen = 0;
      return;
    }
    out.push({ n, text, inFence: true });
  });
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
