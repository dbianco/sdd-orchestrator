import { z } from 'zod';

export const ACCEPTED_MODELS = {
  voyage: ['voyage-3', 'voyage-3-large', 'voyage-3.5', 'voyage-3.5-lite', 'voyage-code-3'],
  ollama: ['mxbai-embed-large', 'bge-m3'],
  fake: ['fake-1024'],
} as const satisfies Record<string, readonly string[]>;

export type EmbeddingProviderName = keyof typeof ACCEPTED_MODELS;

export interface Config {
  databaseUrl: string;
  embedding: {
    provider: EmbeddingProviderName;
    model: string;
    voyageApiKey?: string;
    ollamaUrl: string;
  };
  listen: { host: string; port: number };
  allowedHosts: string[];
  tokenBudget: number;
}

const EnvSchema = z.object({
  SDD_DATABASE_URL: z.string().min(1, 'SDD_DATABASE_URL is required'),
  SDD_EMBEDDING_PROVIDER: z.enum(['voyage', 'ollama', 'fake']).default('voyage'),
  SDD_EMBEDDING_MODEL: z.string().optional(),
  VOYAGE_API_KEY: z.string().optional(),
  OLLAMA_URL: z.string().default('http://localhost:11434'),
  SDD_LISTEN: z.string().default('127.0.0.1:8080'),
  SDD_ALLOWED_HOSTS: z.string().default('localhost,127.0.0.1'),
  SDD_TOKEN_BUDGET: z.coerce.number().int().positive().default(6000),
});

const DEFAULT_MODEL: Record<EmbeddingProviderName, string> = {
  voyage: 'voyage-3.5',
  ollama: 'mxbai-embed-large',
  fake: 'fake-1024',
};

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const e = EnvSchema.parse(env);
  const provider = e.SDD_EMBEDDING_PROVIDER;
  const model = e.SDD_EMBEDDING_MODEL ?? DEFAULT_MODEL[provider];
  if (!(ACCEPTED_MODELS[provider] as readonly string[]).includes(model)) {
    throw new Error(`model "${model}" is not accepted for provider "${provider}"; accepted: ${ACCEPTED_MODELS[provider].join(', ')}`);
  }
  if (provider === 'voyage' && !e.VOYAGE_API_KEY) {
    throw new Error('VOYAGE_API_KEY is required when SDD_EMBEDDING_PROVIDER=voyage');
  }
  const [host, portText] = e.SDD_LISTEN.split(':');
  const port = Number(portText);
  if (!host || !Number.isInteger(port)) throw new Error(`SDD_LISTEN must be host:port, got "${e.SDD_LISTEN}"`);
  return {
    databaseUrl: e.SDD_DATABASE_URL,
    embedding: { provider, model, voyageApiKey: e.VOYAGE_API_KEY, ollamaUrl: e.OLLAMA_URL },
    listen: { host, port },
    allowedHosts: e.SDD_ALLOWED_HOSTS.split(',').map((s) => s.trim()).filter(Boolean),
    tokenBudget: e.SDD_TOKEN_BUDGET,
  };
}
