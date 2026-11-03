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

  it('leaves adminToken null by default and passes it through when set', () => {
    expect(loadConfig({ ...base, VOYAGE_API_KEY: 'k' }).adminToken).toBeNull();
    expect(loadConfig({ ...base, VOYAGE_API_KEY: 'k', SDD_ADMIN_TOKEN: 's3cret' }).adminToken).toBe('s3cret');
    expect(loadConfig({ ...base, VOYAGE_API_KEY: 'k', SDD_ADMIN_TOKEN: '' }).adminToken).toBeNull();
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

  it('defaults SDD_AUTH_MODE to warn and refuses unknown modes', () => {
    expect(loadConfig({ ...base, VOYAGE_API_KEY: 'k' }).authMode).toBe('warn');
    expect(loadConfig({ ...base, VOYAGE_API_KEY: 'k', SDD_AUTH_MODE: 'enforce' }).authMode).toBe('enforce');
    expect(() => loadConfig({ ...base, VOYAGE_API_KEY: 'k', SDD_AUTH_MODE: 'strict' })).toThrow();
  });

  it('explains a missing SDD_DATABASE_URL in one readable message (issue #9)', () => {
    let message = '';
    try { loadConfig({}); } catch (e) { message = (e as Error).message; }
    expect(message).toMatch(/^SDD_DATABASE_URL is not set\./);
    expect(message).toMatch(/SDD_URL and SDD_TOKEN are different/);
    expect(message).not.toContain('invalid_type');
    expect(message).not.toContain('[');
  });

  it('names the variable for other invalid values', () => {
    expect(() => loadConfig({ ...base, VOYAGE_API_KEY: 'k', SDD_TOKEN_BUDGET: 'lots' })).toThrow(/^SDD_TOKEN_BUDGET: /);
  });
});

