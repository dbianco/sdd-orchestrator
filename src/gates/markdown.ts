export interface Line { n: number; text: string; inFence: boolean }
export interface Section { heading: string; level: number; startLine: number; endLine: number; body: Line[] }

const FENCE = /^\s*(```|~~~)/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;

export function lines(md: string): Line[] {
  const out: Line[] = [];
  let inFence = false;
  md.split(/\r?\n/).forEach((text, i) => {
    if (FENCE.test(text)) {
      out.push({ n: i + 1, text, inFence: true });
      inFence = !inFence;
      return;
    }
    out.push({ n: i + 1, text, inFence });
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
