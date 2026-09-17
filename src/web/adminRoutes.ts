import { fileURLToPath } from 'node:url';
import express, { Router, type Request, type Response } from 'express';
import { z, ZodError } from 'zod';
import { isDomainError } from '../errors.js';
import type { Logger } from '../logging.js';
import type { ServiceDeps } from '../services/deps.js';
import { listFeaturesService } from '../services/listFeatures.js';
import { featureCounts, flowCounts, gateCheckStats, knowledgeCounts, proposalsSummary } from '../store/analytics.js';
import { listApps, requireApp } from '../store/apps.js';
import { requireFeature } from '../store/features.js';
import { listProposals } from '../store/proposals.js';
import { listTransitions } from '../store/transitions.js';
import { adminAuth } from './adminAuth.js';

const adminUiDist = fileURLToPath(new URL('../../admin-ui/dist', import.meta.url));

const AppQuery = z.object({ app: z.string().optional() });
const ProposalsQuery = z.object({ status: z.enum(['pending', 'approved', 'rejected']).optional() });

async function resolveAppId(deps: ServiceDeps, slug: string | undefined): Promise<string | null> {
  if (!slug) return null;
  return (await requireApp(deps.pool, slug)).id;
}

export function createAdminRouter(deps: ServiceDeps & { logger?: Logger }, token: string): Router {
  const router = Router();

  function handle(fn: (req: Request, res: Response) => Promise<void>) {
    return async (req: Request, res: Response): Promise<void> => {
      try {
        await fn(req, res);
      } catch (e) {
        if (isDomainError(e) && (e.code === 'APP_NOT_FOUND' || e.code === 'FEATURE_NOT_FOUND')) {
          res.status(404).json({ error: e.message });
          return;
        }
        if (e instanceof ZodError) {
          res.status(400).json({ error: e.message });
          return;
        }
        deps.logger?.error({ err: e }, 'admin route failed');
        res.status(503).json({ error: 'unreachable' });
      }
    };
  }

  router.use(adminAuth(token));

  router.get('/api/overview', handle(async (req, res) => {
    const { app } = AppQuery.parse(req.query);
    const appId = await resolveAppId(deps, app);
    const [features, checks, proposals, knowledge] = await Promise.all([
      featureCounts(deps.pool, appId),
      gateCheckStats(deps.pool, appId),
      proposalsSummary(deps.pool),
      knowledgeCounts(deps.pool),
    ]);
    res.json({ features, checks, proposals, knowledge });
  }));

  router.get('/api/apps', handle(async (_req, res) => {
    const apps = await listApps(deps.pool);
    const rows = await Promise.all(apps.map(async (a) => ({ id: a.id, slug: a.slug, name: a.name, features: await featureCounts(deps.pool, a.id) })));
    res.json({ apps: rows });
  }));

  router.get('/api/apps/:app/features', handle(async (req, res) => {
    const result = await listFeaturesService(deps, { app: req.params.app as string, status: ['active', 'blocked', 'archived'], limit: 200 });
    res.json(result);
  }));

  router.get('/api/features/:id', handle(async (req, res) => {
    const feature = await requireFeature(deps.pool, req.params.id as string);
    const transitions = await listTransitions(deps.pool, feature.id);
    res.json({
      feature: {
        feature_id: feature.id, slug: feature.slug, app_id: feature.app_id, framework: feature.framework, track: feature.track,
        current_phase: feature.current_phase, status: feature.status, blocked_reason: feature.blocked_reason, updated_at: feature.updated_at,
      },
      transitions,
    });
  }));

  router.get('/api/flow', handle(async (req, res) => {
    const { app } = AppQuery.parse(req.query);
    const appId = await resolveAppId(deps, app);
    res.json({ flow: await flowCounts(deps.pool, appId) });
  }));

  router.get('/api/proposals', handle(async (req, res) => {
    const { status } = ProposalsQuery.parse(req.query);
    res.json({ proposals: await listProposals(deps.pool, status ?? null) });
  }));

  router.use(express.static(adminUiDist));

  return router;
}
