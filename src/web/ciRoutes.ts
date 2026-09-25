import express, { Router, type Request, type Response } from 'express';
import type pg from 'pg';
import { z, ZodError } from 'zod';
import { hasScope } from '../auth/tokens.js';
import { VerifyEvidenceSchema } from '../gates/evidence.js';
import type { Logger } from '../logging.js';
import type { MetricsHooks } from '../services/deps.js';
import { getAppBySlug } from '../store/apps.js';
import { insertCiEvidence } from '../store/ciEvidence.js';
import { upsertCommit } from '../store/commits.js';
import { getFeature } from '../store/features.js';
import { resolveBearer } from './mcpAuth.js';

const Body = z.object({
  app: z.string().min(1),
  feature_id: z.string().min(1),
  commit_sha: z.string().regex(/^[0-9a-fA-F]{7,64}$/, 'commit_sha must be 7-64 hex characters'),
  branch: z.string().min(1).max(512).optional(),
  run_url: z.string().url().max(2048).optional(),
  evidence: VerifyEvidenceSchema.deepPartial(),
});

interface Deps { pool: pg.Pool; logger?: Logger; metrics?: MetricsHooks }

// CI evidence always needs an identity, whatever SDD_AUTH_MODE says; the router is only mounted when auth is on.
export function createCiRouter(deps: Deps): Router {
  const router = Router();
  router.post('/evidence', express.json({ limit: '1mb' }), async (req: Request, res: Response) => {
    try {
      const auth = await resolveBearer(deps, req.headers.authorization);
      if (auth === null || auth === 'invalid' || auth.kind !== 'token') {
        res.setHeader('WWW-Authenticate', 'Bearer realm="sdd"');
        res.status(401).json({ error: 'a ci token is required' });
        return;
      }
      if (!hasScope(auth.scopes, 'ci')) { res.status(403).json({ error: 'this token lacks the ci scope' }); return; }
      const body = Body.parse(req.body);
      const app = await getAppBySlug(deps.pool, body.app);
      if (!app) { res.status(404).json({ error: `no app "${body.app}"` }); return; }
      if (auth.app_ids && !auth.app_ids.includes(app.id)) { res.status(403).json({ error: `this token is not allowed for app ${body.app}` }); return; }
      const feature = await getFeature(deps.pool, body.feature_id);
      if (!feature) { res.status(404).json({ error: `no feature with id "${body.feature_id}"` }); return; }
      if (feature.app_id !== app.id) { res.status(403).json({ error: `feature ${feature.id} does not belong to app ${body.app}` }); return; }
      const routing = (await deps.pool.query<{ id: string }>('SELECT id FROM routing_events WHERE feature_id = $1', [feature.id])).rows[0];
      const row = await insertCiEvidence(deps.pool, {
        app_id: app.id, feature_id: feature.id, commit_sha: body.commit_sha, branch: body.branch ?? null, run_url: body.run_url ?? null,
        evidence: body.evidence as Record<string, unknown>, token_id: auth.token_id,
      }, auth.actor);
      const { row: commit } = await upsertCommit(deps.pool, {
        app_id: app.id, sha: body.commit_sha, branch: body.branch ?? null, message: `CI run ${body.run_url ?? row.id}`, files_changed: body.evidence.files_changed?.filter((f): f is string => typeof f === 'string') ?? [],
        committed_at: null, routing_id: routing?.id ?? null, feature_id: feature.id, source: 'ci',
      }, auth.actor);
      deps.metrics?.ciEvidence(body.app);
      res.status(201).json({ ci_evidence_id: row.id, commit_id: commit.id });
    } catch (e) {
      if (e instanceof ZodError) { res.status(400).json({ error: e.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }); return; }
      deps.logger?.error({ err: e }, 'ci evidence failed');
      res.status(503).json({ error: 'unavailable' });
    }
  });
  return router;
}
