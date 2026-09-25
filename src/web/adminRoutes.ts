import { fileURLToPath } from 'node:url';
import express, { Router, type Request, type Response } from 'express';
import { z, ZodError } from 'zod';
import type { Phase, PhaseOrArchived } from '../domain/types.js';
import { isDomainError, type ErrorCode } from '../errors.js';
import { gateFor } from '../lifecycle/track.js';
import { approveRequest, rejectRequest } from '../services/decideApproval.js';
import { loadTrack } from '../services/featureState.js';
import { requirementsFromGate } from '../services/requirements.js';
import { getApproval, listApprovals } from '../store/approvals.js';
import type { AdminIdentity } from './adminAuth.js';
import type { Logger } from '../logging.js';
import type { ServiceDeps } from '../services/deps.js';
import { listFeaturesService } from '../services/listFeatures.js';
import { featureCounts, flowCounts, gateCheckStats, knowledgeCounts, proposalsSummary } from '../store/analytics.js';
import { listApps, requireApp } from '../store/apps.js';
import { listCommitsForRouting } from '../store/commits.js';
import { requireFeature } from '../store/features.js';
import { listProposals } from '../store/proposals.js';
import { listRoutingEvents, requireRoutingEventDetail, routingSummary } from '../store/routingEvents.js';
import { rtmRows } from '../store/rtm.js';
import { listTransitions } from '../store/transitions.js';
import { requirementStatus } from '../services/requirements.js';
import { adminAuth } from './adminAuth.js';

const adminUiDist = fileURLToPath(new URL('../../admin-ui/dist', import.meta.url));

const AppQuery = z.object({ app: z.string().optional() });
const ApprovalsQuery = z.object({ app: z.string().optional(), status: z.enum(['pending', 'approved', 'rejected', 'superseded']).default('pending') });
const ApproveBody = z.object({ comment: z.string().trim().min(1).max(2000).optional() });
const RejectBody = z.object({ reason: z.string().trim().min(1, 'reason is required').max(2000) });

const STATUS_BY_CODE: Partial<Record<ErrorCode, number>> = {
  APP_NOT_FOUND: 404, FEATURE_NOT_FOUND: 404, ROUTING_EVENT_NOT_FOUND: 404, APPROVAL_NOT_FOUND: 404,
  FORBIDDEN: 403, APPROVAL_NOT_PENDING: 409, STALE_STATE: 409, FEATURE_ARCHIVED: 409,
};
const ProposalsQuery = z.object({ status: z.enum(['pending', 'approved', 'rejected']).optional() });
const DateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
const RoutingQuery = z.object({
  app: z.string().optional(),
  from: DateOnly.optional(),
  to: DateOnly.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
}).refine((v) => !v.from || !v.to || v.from <= v.to, { message: 'from must be on or before to', path: ['from'] });

function dayRange(from: string | undefined, to: string | undefined): { from: Date | null; to: Date | null } {
  return { from: from ? new Date(`${from}T00:00:00.000Z`) : null, to: to ? new Date(`${to}T23:59:59.999Z`) : null };
}

async function resolveAppId(deps: ServiceDeps, slug: string | undefined): Promise<string | null> {
  if (!slug) return null;
  return (await requireApp(deps.pool, slug)).id;
}

export function createAdminRouter(deps: ServiceDeps & { logger?: Logger }, legacyToken: string | null): Router {
  const router = Router();

  function handle(fn: (req: Request, res: Response) => Promise<void>) {
    return async (req: Request, res: Response): Promise<void> => {
      try {
        await fn(req, res);
      } catch (e) {
        if (isDomainError(e) && STATUS_BY_CODE[e.code]) {
          res.status(STATUS_BY_CODE[e.code]!).json({ error: e.message, code: e.code });
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

  router.use(adminAuth(deps, legacyToken));

  router.get('/api/me', (_req, res) => {
    const me = res.locals.admin as { actor: string; canApprove: boolean };
    res.json({ actor: me.actor, canApprove: me.canApprove });
  });

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
      requirements: await requirementStatus(deps.pool, feature.id),
    });
  }));

  router.get('/api/apps/:app/rtm', handle(async (req, res) => {
    const app = await requireApp(deps.pool, req.params.app as string);
    res.json({ app: app.slug, rows: await rtmRows(deps.pool, app.id) });
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

  router.get('/api/routing', handle(async (req, res) => {
    const { app, from, to, limit } = RoutingQuery.parse(req.query);
    const appId = await resolveAppId(deps, app);
    const range = dayRange(from, to);
    const [events, summary] = await Promise.all([
      listRoutingEvents(deps.pool, { appId, ...range, limit }),
      routingSummary(deps.pool, { appId, ...range }),
    ]);
    res.json({ events, summary });
  }));

  router.get('/api/routing/:id', handle(async (req, res) => {
    const event = await requireRoutingEventDetail(deps.pool, req.params.id as string);
    const commits = await listCommitsForRouting(deps.pool, event);
    res.json({ event, commits });
  }));

  const admin = (res: Response): AdminIdentity => res.locals.admin as AdminIdentity;
  const canApprove = (res: Response): boolean => {
    if (admin(res).canApprove) return true;
    res.status(403).json({ error: 'approver scope required' });
    return false;
  };

  router.get('/api/approvals', handle(async (req, res) => {
    const { app, status } = ApprovalsQuery.parse(req.query);
    res.json({ approvals: await listApprovals(deps.pool, { appId: await resolveAppId(deps, app), status, appIds: admin(res).apps }) });
  }));

  router.get('/api/approvals/:id', handle(async (req, res) => {
    const approval = await getApproval(deps.pool, req.params.id as string);
    if (!approval) { res.status(404).json({ error: `no approval request with id "${req.params.id as string}"` }); return; }
    const feature = await requireFeature(deps.pool, approval.feature_id);
    const scope = admin(res).apps;
    if (scope && !scope.includes(feature.app_id)) { res.status(403).json({ error: 'this token is not allowed for that app' }); return; }
    const transition = (await deps.pool.query('SELECT findings, evidence, created_by, created_at FROM phase_transitions WHERE id = $1', [approval.transition_id])).rows[0];
    const artifacts = (await deps.pool.query<{ name: string; byte_length: number; content: string | null }>(
      'SELECT name, byte_length, content FROM feature_artifacts WHERE transition_id = $1 ORDER BY name', [approval.transition_id],
    )).rows;
    const track = await loadTrack(deps.pool, feature);
    const texts = Object.fromEntries(artifacts.filter((a) => a.content !== null).map((a) => [a.name, a.content!]));
    const requirements = requirementsFromGate(gateFor(track, approval.from_phase as Phase, approval.to_phase as PhaseOrArchived), texts);
    res.json({
      approval, feature: { feature_id: feature.id, slug: feature.slug, framework: feature.framework, track: feature.track, high_risk: feature.high_risk },
      findings: transition.findings, evidence: transition.evidence, artifacts, requirements: requirements?.map((r) => r.id) ?? null,
    });
  }));

  router.post('/api/approvals/:id/approve', express.json(), handle(async (req, res) => {
    if (!canApprove(res)) return;
    const { comment } = ApproveBody.parse(req.body ?? {});
    const me = admin(res);
    res.json(await approveRequest(deps, { approval_id: req.params.id as string, actor: me.actor, comment: comment ?? null, apps: me.apps }));
  }));

  router.post('/api/approvals/:id/reject', express.json(), handle(async (req, res) => {
    if (!canApprove(res)) return;
    const { reason } = RejectBody.parse(req.body ?? {});
    const me = admin(res);
    res.json(await rejectRequest(deps, { approval_id: req.params.id as string, actor: me.actor, reason, apps: me.apps }));
  }));

  router.use(express.static(adminUiDist));

  return router;
}
