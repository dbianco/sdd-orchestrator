import { describe, it, expect } from 'vitest';
import { isFullTrack, isTinyChange, rightSizingSuggestion } from '../../../src/lifecycle/rightSizing.js';

describe('right-sizing rules', () => {
  it('treats few files and few requirements as tiny, and unknown size as not tiny', () => {
    expect(isTinyChange(1, 0)).toBe(true);
    expect(isTinyChange(3, 2)).toBe(true);
    expect(isTinyChange(4, 1)).toBe(false);
    expect(isTinyChange(2, 3)).toBe(false);
    expect(isTinyChange(0, 0)).toBe(false); // nothing recorded: do not guess
  });

  it('does not suggest a lighter path for tracks that are already light', () => {
    expect(isFullTrack('default')).toBe(true);
    expect(isFullTrack(null)).toBe(true);
    expect(isFullTrack('hotfix')).toBe(false);
    expect(isFullTrack('quick')).toBe(false);
  });

  it('words the suggestion with the numbers and the way to route', () => {
    const text = rightSizingSuggestion({ files: 2, requirements: 1, framework: 'openspec', track: 'default' });
    expect(text).toContain('touched 2 file(s) for 1 requirement(s)');
    expect(text).toContain('openspec:default');
    expect(text).toContain('workspace.intent "trivial"');
  });
});
