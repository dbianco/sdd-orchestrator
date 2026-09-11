export interface Line { n: number; text: string; inFence: boolean }
export interface Section { heading: string; level: number; startLine: number; endLine: number; body: Line[] }

const FENCE = /^\s*(`{3,}|~{3,})/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;

export function lines(md: string): Line[] {
  const out: Line[] = [];
  let fenceChar: string | null = null;
  let fenceLen = 0;
  md.split(/\r?\n/).forEach((text, i) => {
    const m = FENCE.exec(text);
    if (fenceChar === null) {
      // not currently in a fence
      if (m) {
        // opening a fence
        fenceChar = m[1]![0]!;
        fenceLen = m[1]!.length;
        out.push({ n: i + 1, text, inFence: true });
        return;
      }
      // regular line outside fence
      out.push({ n: i + 1, text, inFence: false });
      return;
    }
    // currently in a fence
    const closes = m && m[1]![0] === fenceChar && m[1]!.length >= fenceLen;
    out.push({ n: i + 1, text, inFence: true });
    if (closes) {
      fenceChar = null;
      fenceLen = 0;
    }
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
