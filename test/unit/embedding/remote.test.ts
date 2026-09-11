import { describe, it, expect, vi } from 'vitest';
import { VoyageEmbeddingProvider } from '../../../src/embedding/voyage.js';
import { OllamaEmbeddingProvider } from '../../../src/embedding/ollama.js';
import { createEmbeddingProvider } from '../../../src/embedding/index.js';

const vec = () => new Array(1024).fill(0.1);

describe('VoyageEmbeddingProvider', () => {
  it('posts the documented payload with input_type and output_dimension', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body).toEqual({ input: ['a', 'b'], model: 'voyage-3.5', input_type: 'query', output_dimension: 1024 });
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer key');
      return new Response(JSON.stringify({ data: [{ embedding: vec(), index: 0 }, { embedding: vec(), index: 1 }] }), { status: 200 });
    });
    const p = new VoyageEmbeddingProvider('voyage-3.5', 'key', fetchImpl as unknown as typeof fetch);
    const out = await p.embed(['a', 'b'], 'query');
    expect(out).toHaveLength(2);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://api.voyageai.com/v1/embeddings');
  });
  it('throws on a non-2xx response', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 500 }));
    const p = new VoyageEmbeddingProvider('voyage-3.5', 'key', fetchImpl as unknown as typeof fetch);
    await expect(p.embed(['a'], 'document')).rejects.toThrow(/voyage.*500/i);
    expect(await p.healthy()).toBe(false);
  });
  it('batches at 128 inputs', async () => {
    const fetchImpl = vi.fn(async (_u: unknown, init?: RequestInit) => {
      const n = JSON.parse(String(init?.body)).input.length;
      return new Response(JSON.stringify({ data: Array.from({ length: n }, (_, i) => ({ embedding: vec(), index: i })) }), { status: 200 });
    });
    const p = new VoyageEmbeddingProvider('voyage-3.5', 'key', fetchImpl as unknown as typeof fetch);
    expect(await p.embed(Array.from({ length: 200 }, (_, i) => `t${i}`), 'document')).toHaveLength(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe('OllamaEmbeddingProvider', () => {
  it('posts to /api/embed and validates the dimension', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe('http://ollama:11434/api/embed');
      expect(JSON.parse(String(init?.body))).toEqual({ model: 'bge-m3', input: ['a'] });
      return new Response(JSON.stringify({ embeddings: [vec()] }), { status: 200 });
    });
    const p = new OllamaEmbeddingProvider('bge-m3', 'http://ollama:11434', fetchImpl as unknown as typeof fetch);
    expect(await p.embed(['a'], 'document')).toHaveLength(1);
  });
  it('rejects a wrong dimension', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ embeddings: [[1, 2, 3]] }), { status: 200 }));
    const p = new OllamaEmbeddingProvider('bge-m3', 'http://ollama:11434', fetchImpl as unknown as typeof fetch);
    await expect(p.embed(['a'], 'document')).rejects.toThrow(/dimension 3, expected 1024/);
  });
});

describe('createEmbeddingProvider', () => {
  it('builds each provider from config', () => {
    expect(createEmbeddingProvider({ provider: 'fake', model: 'fake-1024', ollamaUrl: 'x' }).provider).toBe('fake');
    expect(createEmbeddingProvider({ provider: 'ollama', model: 'bge-m3', ollamaUrl: 'http://o' }).provider).toBe('ollama');
    expect(createEmbeddingProvider({ provider: 'voyage', model: 'voyage-3', voyageApiKey: 'k', ollamaUrl: 'x' }).provider).toBe('voyage');
  });
});
