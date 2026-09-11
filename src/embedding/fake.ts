import { EMBEDDING_DIMENSION, type EmbeddingProvider, type InputType } from './provider.js';

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

export function fakeEmbed(text: string): number[] {
  const v = new Array<number>(EMBEDDING_DIMENSION).fill(0);
  const words = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (words.length === 0) { v[0] = 1; return v; }
  for (let i = 0; i < words.length; i++) {
    v[fnv1a(words[i]!) % EMBEDDING_DIMENSION]! += 1;
    if (i + 1 < words.length) v[fnv1a(`${words[i]} ${words[i + 1]}`) % EMBEDDING_DIMENSION]! += 0.5;
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return v.map((x) => x / norm);
}

export class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly provider = 'fake' as const;
  readonly model = 'fake-1024';
  async embed(texts: string[], _inputType: InputType): Promise<number[][]> {
    return texts.map(fakeEmbed);
  }
  async healthy(): Promise<boolean> { return true; }
}
