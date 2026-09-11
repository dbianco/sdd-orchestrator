import { describe, it, expect } from 'vitest';
import { loadConfig, ACCEPTED_MODELS } from '../../src/config.js';

const base = { SDD_DATABASE_URL: 'postgres://u:p@h/db' };

describe('loadConfig', () => {
  it('applies defaults', () => {
    const c = loadConfig({ ...base, VOYAGE_API_KEY: 'k' });
    expect(c.embedding.provider).toBe('voyage');
    expect(c.embedding.model).toBe('voyage-3.5');
    expect(c.listen).toEqual({ host: '127.0.0.1', port: 8080 });
    expect(c.allowedHosts).toEqual(['localhost', '127.0.0.1']);
    expect(c.tokenBudget).toBe(6000);
  });

  it('refuses an unknown model for the provider', () => {
    expect(() => loadConfig({ ...base, SDD_EMBEDDING_PROVIDER: 'ollama', SDD_EMBEDDING_MODEL: 'voyage-3' }))
      .toThrow(/model "voyage-3" is not accepted for provider "ollama"/);
  });

  it('requires VOYAGE_API_KEY for voyage', () => {
    expect(() => loadConfig({ ...base })).toThrow(/VOYAGE_API_KEY/);
  });

  it('parses listen and allowed hosts', () => {
    const c = loadConfig({ ...base, SDD_EMBEDDING_PROVIDER: 'fake', SDD_LISTEN: '0.0.0.0:9000', SDD_ALLOWED_HOSTS: 'sdd.internal, localhost' });
    expect(c.listen).toEqual({ host: '0.0.0.0', port: 9000 });
    expect(c.allowedHosts).toEqual(['sdd.internal', 'localhost']);
  });

  it('lists accepted models', () => {
    expect(ACCEPTED_MODELS.voyage).toEqual(['voyage-3', 'voyage-3-large', 'voyage-3.5', 'voyage-3.5-lite', 'voyage-code-3']);
    expect(ACCEPTED_MODELS.ollama).toEqual(['mxbai-embed-large', 'bge-m3']);
  });
});
