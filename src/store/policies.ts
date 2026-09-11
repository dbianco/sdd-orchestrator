import { z } from 'zod';
import type { Queryable } from '../db/pool.js';
import type { Policy } from '../domain/types.js';
import { newId } from '../ids.js';
import type { PolicyRow } from './rows.js';

export const PolicySchema: z.ZodType<Policy, z.ZodTypeDef, unknown> = z.object({
  framework: z.string().min(1).nullable().default(null),
  path_rules: z.array(z.object({ glob: z.string().min(1), framework: z.string().min(1) })).default([]),
  risk_paths: z.array(z.string().min(1)).default([]),
});

export async function currentPolicy(q: Queryable, appId: string): Promise<PolicyRow | null> {
  const r = await q.query<PolicyRow>('SELECT * FROM app_policies WHERE app_id = $1 ORDER BY version DESC LIMIT 1', [appId]);
  return r.rows[0] ?? null;
}

export async function appendPolicy(q: Queryable, appId: string, policy: Policy, reason: string, actor: string): Promise<PolicyRow> {
  const r = await q.query<PolicyRow>(
    `INSERT INTO app_policies (id, app_id, version, policy, reason, created_by)
     VALUES ($1, $2, (SELECT COALESCE(max(version), 0) + 1 FROM app_policies WHERE app_id = $2), $3, $4, $5) RETURNING *`,
    [newId('pol'), appId, JSON.stringify(policy), reason, actor],
  );
  return r.rows[0]!;
}
