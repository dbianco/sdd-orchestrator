import { ResourceTemplate, type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { isDomainError } from '../errors.js';
import { getFeatureStatus } from '../services/featureStatus.js';
import { requireApp } from '../store/apps.js';
import { currentFramework } from '../store/frameworks.js';
import { currentItem, itemVersion, listAlwaysOn } from '../store/knowledge.js';
import { currentPolicy } from '../store/policies.js';
import type { McpDeps } from './server.js';

function jsonContent(uri: URL, value: unknown) {
  return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(value, null, 2) }] };
}

async function wrap<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) {
    if (isDomainError(e)) throw new Error(`${e.code}: ${e.message}`);
    throw e;
  }
}

const one = (v: string | string[] | undefined): string => {
  if (v === undefined) throw new Error('missing URI template variable');
  return Array.isArray(v) ? v[0]! : v;
};

export function registerResources(server: McpServer, deps: McpDeps): void {
  const q = deps.pool;

  server.registerResource('app', new ResourceTemplate('sdd://apps/{slug}', { list: undefined }),
    { title: 'App profile', description: 'App profile, current policy version and always-on standards', mimeType: 'application/json' },
    async (uri, { slug }) => wrap(async () => {
      const app = await requireApp(q, one(slug));
      const policy = await currentPolicy(q, app.id);
      const alwaysOn = (await listAlwaysOn(q, app.id)).map((i) => ({ stable_id: i.stable_id, version: i.version, title: i.title, app_scoped: i.app_id !== null }));
      return jsonContent(uri, { slug: app.slug, name: app.name, default_stack: app.default_stack, compliance: app.compliance, token_budget: app.token_budget, min_similarity: app.min_similarity, stop_conditions: app.stop_conditions, policy_version: policy?.version ?? null, policy: policy?.policy ?? null, always_on: alwaysOn });
    }));

  server.registerResource('feature', new ResourceTemplate('sdd://features/{id}', { list: undefined }),
    { title: 'Feature state', description: 'Feature state and transition summaries', mimeType: 'application/json' },
    async (uri, { id }) => wrap(async () => jsonContent(uri, await getFeatureStatus(deps, one(id)))));

  server.registerResource('framework', new ResourceTemplate('sdd://frameworks/{name}', { list: undefined }),
    { title: 'Framework', description: 'Current framework version: tracks, phases, artifacts and gates', mimeType: 'application/json' },
    async (uri, { name }) => wrap(async () => {
      const fw = await currentFramework(q, one(name));
      if (!fw) throw new Error(`UNKNOWN_FRAMEWORK: framework "${one(name)}" has no current version`);
      return jsonContent(uri, { name: fw.name, pack_version: fw.pack_version, gate_library_version: fw.gate_library_version, status: fw.status, tracks: fw.tracks });
    }));

  server.registerResource('knowledge-version', new ResourceTemplate('sdd://knowledge/{stable_id}/v/{version}', { list: undefined }),
    { title: 'Knowledge item version', description: 'A specific version of one knowledge item', mimeType: 'application/json' },
    async (uri, { stable_id, version }) => wrap(async () => {
      const item = await itemVersion(q, one(stable_id), Number(one(version)));
      if (!item) throw new Error(`knowledge item "${one(stable_id)}" version ${one(version)} not found`);
      return jsonContent(uri, item);
    }));

  server.registerResource('knowledge-current', new ResourceTemplate('sdd://knowledge/{stable_id}', { list: undefined }),
    { title: 'Knowledge item', description: 'Current version of one knowledge item', mimeType: 'application/json' },
    async (uri, { stable_id }) => wrap(async () => {
      const item = await currentItem(q, one(stable_id));
      if (!item) throw new Error(`knowledge item "${one(stable_id)}" not found or not current`);
      return jsonContent(uri, item);
    }));
}
