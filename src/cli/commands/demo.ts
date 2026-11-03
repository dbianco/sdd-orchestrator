import { Command } from 'commander';
import type pg from 'pg';
import { newId } from '../../ids.js';
import { createApp, getAppBySlug } from '../../store/apps.js';
import { withTransaction } from '../../db/pool.js';
import { openCli, print } from '../context.js';

const DAY = 86_400_000;
const ago = (days: number, hours = 0): Date => new Date(Date.now() - days * DAY - hours * 3_600_000);
const DECISION = (framework: string, track: string, rule: string, reasons: string[]) => ({ intent: 'feature', framework, track, confidence: 'high', rule, reasons, high_risk: false, policy_version: null, framework_pack_version: '1.0.0' });

interface Step { from: string; to: string; result: 'pass' | 'fail' | 'awaiting_approval'; at: Date; by: string; findings?: { check: string; severity: 'blocker' | 'warning'; location: string | null; message: string }[]; approved?: boolean }
interface Demo {
  slug: string; intent: string; framework: string; track: string; phase: string; status: 'active' | 'blocked' | 'archived'; ref: string | null; blocked?: string;
  steps: Step[]; requirements?: string[]; commits?: { sha: string; message: string; files: string[]; at: Date }[]; pendingApproval?: { by: string; at: Date };
}

const FEATURES: Demo[] = [
  {
    slug: 'add-csv-export', intent: 'Add CSV export to the orders page', framework: 'openspec', track: 'default', phase: 'verify', status: 'active', ref: 'DEMO-101',
    requirements: ['FR-001', 'FR-002', 'FR-003'],
    steps: [
      { from: 'specify', to: 'plan', result: 'fail', at: ago(9), by: 'dana', findings: [{ check: 'measurable_criteria', severity: 'blocker', location: 'proposal.md:14', message: '"export is fast" has no threshold' }] },
      { from: 'specify', to: 'plan', result: 'pass', at: ago(9, -2), by: 'dana' },
      { from: 'plan', to: 'implement', result: 'pass', at: ago(8), by: 'dana', approved: true },
      { from: 'implement', to: 'verify', result: 'pass', at: ago(5), by: 'dana' },
      { from: 'verify', to: 'integrate', result: 'fail', at: ago(1), by: 'dana', findings: [{ check: 'requirement_coverage', severity: 'blocker', location: 'FR-003', message: 'FR-003 is not covered by evidence.implements' }] },
    ],
    commits: [{ sha: 'a1b2c3d4e5f6', message: 'feat(orders): stream CSV export', files: ['src/orders/export.ts', 'src/orders/export.test.ts'], at: ago(6) }],
  },
  {
    slug: 'fix-checkout-timeout', intent: 'Hotfix: checkout times out on slow cards', framework: 'openspec', track: 'hotfix', phase: 'learn', status: 'active', ref: 'DEMO-102',
    requirements: ['R1'],
    steps: [
      { from: 'specify', to: 'implement', result: 'pass', at: ago(3), by: 'erin' },
      { from: 'implement', to: 'verify', result: 'pass', at: ago(2, 6), by: 'erin' },
      { from: 'verify', to: 'learn', result: 'pass', at: ago(2), by: 'erin', approved: true },
    ],
    commits: [{ sha: 'b2c3d4e5f6a7', message: 'fix(checkout): raise gateway timeout to 20s', files: ['src/checkout/gateway.ts'], at: ago(2, 8) }],
  },
  {
    slug: 'refund-policy-page', intent: 'Publish the refund policy page', framework: 'openspec', track: 'default', phase: 'archived', status: 'archived', ref: 'DEMO-097',
    requirements: ['FR-001', 'FR-002'],
    steps: [
      { from: 'specify', to: 'plan', result: 'pass', at: ago(20), by: 'dana' },
      { from: 'plan', to: 'implement', result: 'pass', at: ago(19), by: 'dana', approved: true },
      { from: 'implement', to: 'verify', result: 'pass', at: ago(15), by: 'dana' },
      { from: 'verify', to: 'integrate', result: 'pass', at: ago(14), by: 'dana', approved: true },
      { from: 'integrate', to: 'archived', result: 'pass', at: ago(2), by: 'dana' },
    ],
  },
  {
    slug: 'saved-cards', intent: 'Let returning customers reuse saved cards', framework: 'bmad', track: 'default', phase: 'specify', status: 'active', ref: 'DEMO-110',
    requirements: ['FR1', 'FR2'],
    steps: [{ from: 'specify', to: 'implement', result: 'awaiting_approval', at: ago(0, 5), by: 'dana' }],
    pendingApproval: { by: 'dana', at: ago(0, 5) },
  },
  {
    slug: 'webhook-retries', intent: 'Retry failed webhooks with backoff', framework: 'spec-kit', track: 'default', phase: 'plan', status: 'blocked', ref: null,
    blocked: 'Three failed gate attempts; needs a person to unblock with a backward move.',
    steps: [
      { from: 'plan', to: 'tasks', result: 'fail', at: ago(4), by: 'erin', findings: [{ check: 'placeholder_scan', severity: 'blocker', location: 'plan.md:22', message: 'marker TODO' }, { check: 'required_sections', severity: 'blocker', location: 'plan.md', message: 'section "Files" is missing' }] },
      { from: 'plan', to: 'tasks', result: 'fail', at: ago(3), by: 'erin', findings: [{ check: 'required_sections', severity: 'blocker', location: 'plan.md', message: 'section "Files" is missing' }] },
      { from: 'plan', to: 'tasks', result: 'fail', at: ago(3, -3), by: 'erin', findings: [{ check: 'task_ordering', severity: 'blocker', location: 'tasks.md:8', message: 'task T3 depends on T5 which does not appear earlier' }] },
    ],
  },
];

async function insert(pool: pg.Pool, appId: string, actor: string): Promise<{ features: number; transitions: number }> {
  let transitions = 0;
  await withTransaction(pool, async (c) => {
    for (const d of FEATURES) {
      const fid = newId('f');
      const last = d.steps.at(-1)!;
      await c.query(
        `INSERT INTO features (id, app_id, slug, intent, framework, framework_pack_version, track, current_phase, status, blocked_reason, source_task, external_ref, decision, created_at, updated_at, created_by)
         VALUES ($1,$2,$3,$4,$5,'1.0.0',$6,$7,$8,$9,$4,$10,$11,$12,$13,$14)`,
        [fid, appId, d.slug, d.intent, d.framework, d.track, d.phase, d.status, d.blocked ?? null, d.ref, JSON.stringify(DECISION(d.framework, d.track, 'demo', ['demo data'])), d.steps[0]!.at, last.at, d.steps[0]!.by]);
      const transitionIds: string[] = [];
      for (const s of d.steps) {
        const tid = newId('t');
        transitionIds.push(tid);
        transitions += 1;
        await c.query(
          `INSERT INTO phase_transitions (id, feature_id, from_phase, to_phase, direction, result, findings, evidence, human_approved, approved_by, created_at, updated_at, created_by)
           VALUES ($1,$2,$3,$4,'forward',$5,$6,$7,$8,$9,$10,$10,$11)`,
          [tid, fid, s.from, s.to, s.result, JSON.stringify(s.findings ?? []),
            s.from === 'verify' && s.result === 'pass' ? JSON.stringify({ tests: { passed: 18, failed: 0 }, files_changed: d.commits?.[0]?.files ?? [], implements: d.requirements ?? [] }) : null,
            Boolean(s.approved), s.approved ? 'erin' : null, s.at, s.by]);
        if (s.approved) {
          await c.query(`INSERT INTO approval_requests (id, feature_id, transition_id, from_phase, to_phase, status, requested_by, decided_by, decided_at, comment, created_at, updated_at, created_by)
            VALUES ($1,$2,$3,$4,$5,'approved',$6,'erin',$7,'Looks good',$8,$7,$6)`, [newId('ap'), fid, tid, s.from, s.to, s.by, new Date(s.at.getTime() + 3 * 3_600_000), s.at]);
        }
        if (s.result === 'awaiting_approval' && d.pendingApproval) {
          await c.query(`INSERT INTO approval_requests (id, feature_id, transition_id, from_phase, to_phase, status, requested_by, created_at, updated_at, created_by)
            VALUES ($1,$2,$3,$4,$5,'pending',$6,$7,$7,$6)`, [newId('ap'), fid, tid, s.from, s.to, d.pendingApproval.by, d.pendingApproval.at]);
        }
      }
      const specTransition = transitionIds[0]!;
      for (const [i, req] of (d.requirements ?? []).entries()) {
        await c.query(`INSERT INTO feature_requirements (feature_id, req_id, artifact, line, transition_id, created_by) VALUES ($1,$2,'proposal.md',$3,$4,$5)`, [fid, req, 10 + i, specTransition, d.steps[0]!.by]);
      }
      const rid = newId('r');
      await c.query(
        `INSERT INTO routing_events (id, app_id, identity_key, external_ref, task_description, decision, intent, framework, route_count, first_routed_at, last_routed_at, feature_id, created_at, updated_at, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,'feature',$7,1,$8,$9,$10,$8,$9,$11)`,
        [rid, appId, `demo:${d.slug}`, d.ref, d.intent, JSON.stringify(DECISION(d.framework, d.track, 'demo', ['demo data'])), d.framework, d.steps[0]!.at, last.at, fid, d.steps[0]!.by]);
      for (const cm of d.commits ?? []) {
        await c.query(`INSERT INTO commits (id, app_id, sha, branch, message, files_changed, committed_at, routing_id, feature_id, created_at, updated_at, created_by)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$7,$7,$10)`, [newId('cm'), appId, cm.sha, `feature/${d.slug}`, cm.message, cm.files, cm.at, rid, fid, d.steps[0]!.by]);
      }
      if (d.slug === 'fix-checkout-timeout') {
        await c.query(`INSERT INTO proposals (id, app_id, feature_id, payload, status, created_at, updated_at, created_by)
          VALUES ($1,$2,$3,$4,'pending',$5,$5,'agent')`, [newId('p'), appId, fid, JSON.stringify({ kind: 'app_memory', memory_type: 'incident', title: 'Checkout gateway timeouts on slow cards', body: '## Incident Memory Proposal\nSlow issuers exceed 10s; the gateway timeout is now 20s.', stack_tags: [], links: [] }), ago(0, 3)]);
      }
      if (d.slug === 'refund-policy-page') {
        await c.query(`INSERT INTO proposals (id, app_id, feature_id, payload, status, reviewed_by, created_at, updated_at, created_by)
          VALUES ($1,$2,$3,$4,'approved','erin',$5,$5,'agent')`, [newId('p'), appId, fid, JSON.stringify({ kind: 'app_memory', memory_type: 'decision', title: 'Policy pages live under /legal', body: 'Static policy pages are served from /legal.', stack_tags: [], links: [] }), ago(2)]);
      }
    }
  });
  return { features: FEATURES.length, transitions };
}

export async function seedDemo(pool: pg.Pool, slug: string, actor: string): Promise<{ app: string; features: number; transitions: number }> {
  if (await getAppBySlug(pool, slug)) throw new Error(`app "${slug}" already exists; run "sdd-admin demo reset --app ${slug}" first`);
  const app = await createApp(pool, { slug, name: 'Demo shop', compliance: false }, actor);
  return { app: slug, ...(await insert(pool, app.id, actor)) };
}

export function demoCommand(actorOption: (c: Command) => Command): Command {
  const cmd = new Command('demo').description('Sample data to explore the admin UI without connecting a repository');
  actorOption(cmd.command('seed').description('Create the "demo" app with sample features, gate failures, approvals and proposals')
    .option('--app <slug>', 'app slug to create', 'demo'))
    .action(async (o: { app: string; actor: string }) => {
      const ctx = await openCli({ needEmbedder: false });
      try {
        print({ ...(await seedDemo(ctx.pool, o.app, o.actor)), notice: `Open the admin UI and pick "${o.app}" in the Project selector.` });
      } finally { await ctx.close(); }
    });
  cmd.command('reset').description('Delete the demo app and everything seeded for it').option('--app <slug>', 'app slug', 'demo')
    .action(async (o: { app: string }) => {
      const ctx = await openCli({ needEmbedder: false });
      try {
        const app = await getAppBySlug(ctx.pool, o.app);
        if (!app) { print({ app: o.app, removed: false }); return; }
        if (!(await ctx.pool.query(`SELECT 1 FROM routing_events WHERE app_id = $1 AND identity_key LIKE 'demo:%' LIMIT 1`, [app.id])).rowCount) {
          throw new Error(`app "${o.app}" was not created by "demo seed"; refusing to delete it`);
        }
        await withTransaction(ctx.pool, async (c) => {
          const f = `(SELECT id FROM features WHERE app_id = $1)`;
          await c.query(`DELETE FROM proposals WHERE app_id = $1`, [app.id]);
          await c.query(`DELETE FROM commits WHERE app_id = $1`, [app.id]);
          await c.query(`UPDATE phase_transitions SET approval_id = NULL WHERE feature_id IN ${f}`, [app.id]);
          await c.query(`DELETE FROM approval_requests WHERE feature_id IN ${f}`, [app.id]);
          await c.query(`DELETE FROM routing_events WHERE app_id = $1`, [app.id]);
          await c.query(`DELETE FROM feature_requirements WHERE feature_id IN ${f}`, [app.id]);
          await c.query(`DELETE FROM feature_artifacts WHERE transition_id IN (SELECT id FROM phase_transitions WHERE feature_id IN ${f})`, [app.id]);
          await c.query(`DELETE FROM phase_transitions WHERE feature_id IN ${f}`, [app.id]);
          await c.query(`DELETE FROM context_packs WHERE feature_id IN ${f}`, [app.id]);
          await c.query(`DELETE FROM features WHERE app_id = $1`, [app.id]);
          await c.query(`DELETE FROM app_policies WHERE app_id = $1`, [app.id]);
          await c.query(`DELETE FROM apps WHERE id = $1`, [app.id]);
        });
        print({ app: o.app, removed: true });
      } finally { await ctx.close(); }
    });
  return cmd;
}
