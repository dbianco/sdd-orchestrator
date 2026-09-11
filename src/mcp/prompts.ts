import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { PHASES } from '../domain/types.js';
import { isDomainError } from '../errors.js';
import { getContext } from '../services/getContext.js';
import type { McpDeps } from './server.js';

export function registerPrompts(server: McpServer, deps: McpDeps): void {
  for (const phase of PHASES) {
    server.registerPrompt(`sdd.${phase}`, {
      title: `SDD ${phase} phase`,
      description: `Returns the context pack for the ${phase} phase of a feature, exactly as get_context would, persisted with created_by "prompt".`,
      argsSchema: { feature_id: z.string().min(1).describe('Feature id returned by start_feature') },
    }, async ({ feature_id }) => {
      try {
        const r = await getContext(deps, { feature_id, actor: 'prompt', phase, scope: 'app' });
        return { messages: [{ role: 'user', content: { type: 'text', text: r.context_pack } }] };
      } catch (e) {
        if (isDomainError(e)) throw new Error(`${e.code}: ${e.message}`);
        throw e;
      }
    });
  }
}
