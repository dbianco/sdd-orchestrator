import { describe, it, expect } from 'vitest';
import { formatHours, relativeTime, toCsv } from './ui';

describe('ui helpers', () => {
  it('quotes CSV cells that contain commas, quotes or newlines', () => {
    expect(toCsv(['a', 'b'], [['x,y', 'say "hi"'], [null, 3], ['line\nbreak', true]])).toBe('a,b\n"x,y","say ""hi"""\n,3\n"line\nbreak",true\n');
  });

  it('formats hours and relative times', () => {
    expect(formatHours(null)).toBe('—');
    expect(formatHours(0.25)).toBe('15m');
    expect(formatHours(3)).toBe('3h');
    expect(formatHours(72)).toBe('3d');
    expect(relativeTime('2026-11-03T09:00:00Z', Date.parse('2026-11-03T12:00:00Z'))).toBe('3h ago');
  });
});
