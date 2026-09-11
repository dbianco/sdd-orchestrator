import { describe, it, expect } from 'vitest';
import { FakeEmbeddingProvider } from '../../../src/embedding/fake.js';
import { EMBEDDING_DIMENSION } from '../../../src/embedding/provider.js';

function cosine(a: number[], b: number[]): number {
  return a.reduce((s, x, i) => s + x * (b[i] ?? 0), 0);
}

describe('FakeEmbeddingProvider', () => {
  const p = new FakeEmbeddingProvider();
  it('returns unit vectors of the fixed dimension, deterministically', async () => {
    const [a] = await p.embed(['csv export streaming'], 'document');
    const [b] = await p.embed(['csv export streaming'], 'query');
    expect(a).toHaveLength(EMBEDDING_DIMENSION);
    expect(a).toEqual(b);
    expect(Math.abs(cosine(a!, a!) - 1)).toBeLessThan(1e-6);
  });
  it('ranks similar text closer than unrelated text', async () => {
    const [q, near, far] = await p.embed(['csv export of orders', 'orders csv export streaming', 'kubernetes ingress tls'], 'document');
    expect(cosine(q!, near!)).toBeGreaterThan(cosine(q!, far!));
  });
  it('handles empty text', async () => {
    const [v] = await p.embed([''], 'document');
    expect(v).toHaveLength(EMBEDDING_DIMENSION);
  });
  it('is healthy', async () => {
    expect(await p.healthy()).toBe(true);
    expect(p.provider).toBe('fake');
    expect(p.model).toBe('fake-1024');
  });
});
