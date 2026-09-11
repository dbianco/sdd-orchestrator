import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getTestPool, truncateAll, closeTestPool } from '../../helpers/db.js';
import { seedPacks, packsEmbedder } from '../../helpers/seedPacks.js';
import { startFeature } from '../../../src/services/startFeature.js';
import { advancePhase } from '../../../src/services/advancePhase.js';
import { getFeatureStatus } from '../../../src/services/featureStatus.js';
import { getFrameworkVersion, trackOf } from '../../../src/store/frameworks.js';
import { phaseOrder } from '../../../src/lifecycle/track.js';
import type { ServiceDeps } from '../../../src/services/deps.js';
import type { Decision, Intent, Phase } from '../../../src/domain/types.js';

const url = process.env.SDD_TEST_DATABASE_URL;

const evidence = { tests: { command: 'npm test', passed: 12, failed: 0 }, lint: 'pass', security: { status: 'pass', new_high: 0 }, files_changed: ['src/orders/export.ts', 'src/orders/export.test.ts'], implements: ['REQ-1'], existing_tests_modified: 0, characterization_tests: ['src/orders/export.characterization.test.ts'] };

const proposal = '## Why\nExports are manual.\n\n## What Changes\n- Add a CSV export button.\n\n## Impact\nOrders page only.\n';
const deltaSpec = '## ADDED Requirements\n\n### Requirement: CSV export\n\nThe system SHALL export up to 10000 rows within 2 s.\n\n#### Scenario: export\n\n- **WHEN** the user clicks export\n- **THEN** a CSV downloads\n\n## MODIFIED Requirements\n\n## REMOVED Requirements\n';
const openspecTasks = '## Tasks\n\n- [ ] 1. Add endpoint\n- [ ] 2. Add button\n';
const hotfixProposal = '## Reproduction\nINC-204: export 500s for EU.\n\n## Expected Behaviour\nExport succeeds.\n\n## Regression Test\nsrc/orders/export.test.ts "eu export"\n';
const learn = '## Timeline\n10:00 detect, 10:20 fix.\n\n## Root Cause\nNull region.\n\n## Incident Memory Proposal\nproposal p_x submitted.\n';
const refactorProposal = '## Observed Behaviors\n- Exports buffer whole result (export.test.ts).\n\n## Assumed Contracts\n- Reporting reads the file after completion.\n\n## Characterization Tests\n- src/orders/export.characterization.test.ts\n\n## Approach\nStream instead of buffer.\n';
const emptyDelta = '## ADDED Requirements\n\n## MODIFIED Requirements\n\n## REMOVED Requirements\n';
const specKitSpec = '## User Scenarios\n\n### Primary user story\nAs an ops user I want CSV export.\n\n## Functional Requirements\n\n- **FR-001**: The system MUST export orders as CSV.\n\n## Success Criteria\n\n- **SC-001**: 95% of exports complete within 2 s.\n';
const specKitRefactorSpec = '## Observed Behaviors\n- buffers (test).\n\n## Assumed Contracts\n- file read after completion.\n\n## Characterization Tests\n- src/orders/export.characterization.test.ts\n\n## Success Criteria\n- 0 existing tests modified.\n';
const plan = '## Technical Context\nTypeScript 5, Node 22.\n\n## Project Structure\n- `src/orders/export.ts`\n- `src/orders/export.test.ts`\n';
const orderedTasks = '## Tasks\n\n- [ ] T001 Create endpoint in `src/orders/export.ts`\n- [ ] T002 Add test, depends on T001\n';
const quickSpec = '## Goal\nCSV export.\n\n## Acceptance Criteria\n1. Downloads CSV.\n\n## Tasks\n- [ ] Add endpoint (AC: 1)\n';
const prd = '## Goals\n- Faster reporting.\n\n## Requirements\n- **FR1**: export CSV.\n\n## Success Metrics\n- Reporting time down 50% within 30 days.\n';
const architecture = '## Decisions\n1. Stream exports.\n\n## Components\n- ExportService.\n';
const epics = '## Epics\n\n### Epic 1: Export\nCovers FR1.\n';
const stories = '## Stories\n\n### Story 1.1: Endpoint\nAs a user I want CSV.\n\nAcceptance Criteria:\n1. Downloads CSV.\n';
const retro = '## What Went Well\nTests first.\n\n## What To Change\nEarlier review.\n';
const requirements = '## Introduction\nCSV export.\n\n## Requirements\n\n### Requirement 1\n\n**User Story:** As a user I want CSV.\n\n#### Acceptance Criteria\n1. WHEN export clicked THEN the system SHALL download CSV\n';
const design = '## Overview\nStream CSV.\n\n## Architecture\nExportService streams rows.\n';
const kiroTasks = '## Implementation Plan\n\n- [ ] 1. Endpoint\n  - _Requirements: 1.1_\n';
const sdlcPrd = '## Problem\nManual exports.\n\n## Users\nOps.\n\n## Requirements\n- **R1**: CSV export.\n\n## Success Metrics\n- Tickets down 50% within 60 days.\n';
const scoping = '## In Scope\n- R1.\n\n## Out of Scope\n- Scheduling.\n';
const jotDown = '## Approach\nStream rows.\n\n## Files\n- `src/orders/export.ts`\n- `src/orders/export.test.ts`\n';
const sdlcTasks = '## Tasks\n\n- [ ] T1 Endpoint in `src/orders/export.ts` (AC: R1)\n- [ ] T2 Test, depends on T1 (AC: R1)\n';
const sdlcRetro = '## Learnings\nStreaming is simpler.\n\n## Memory Proposals\np_x\n';

// Artifacts per framework/track keyed by "from->to".
const ARTIFACTS: Record<string, Record<string, Record<string, string>>> = {
  'openspec/default': { 'specify->implement': { 'proposal.md': proposal, 'spec.md': deltaSpec, 'tasks.md': openspecTasks } },
  'openspec/hotfix': { 'specify->implement': { 'proposal.md': hotfixProposal }, 'learn->archived': { 'learn.md': learn } },
  'openspec/refactor': { 'specify->implement': { 'proposal.md': refactorProposal, 'spec.md': emptyDelta } },
  'spec-kit/default': { 'specify->plan': { 'spec.md': specKitSpec }, 'plan->tasks': { 'plan.md': plan }, 'tasks->implement': { 'tasks.md': orderedTasks }, 'verify->integrate': { 'plan.md': plan } },
  'spec-kit/refactor': { 'specify->plan': { 'spec.md': specKitRefactorSpec }, 'plan->tasks': { 'plan.md': plan }, 'tasks->implement': { 'tasks.md': orderedTasks }, 'verify->integrate': { 'plan.md': plan } },
  'bmad/quick': { 'specify->implement': { 'quick-spec.md': quickSpec } },
  'bmad/full': { 'specify->plan': { 'prd.md': prd, 'architecture.md': architecture }, 'plan->tasks': { 'epics.md': epics }, 'tasks->implement': { 'stories.md': stories }, 'learn->archived': { 'retrospective.md': retro } },
  'kiro/default': { 'specify->plan': { 'requirements.md': requirements }, 'plan->tasks': { 'design.md': design }, 'tasks->implement': { 'tasks.md': kiroTasks } },
  'sdlc/default': { 'specify->plan': { 'prd.md': sdlcPrd, 'scoping.md': scoping }, 'plan->tasks': { 'jot-down.md': jotDown }, 'tasks->implement': { 'tasks.md': sdlcTasks }, 'verify->integrate': { 'jot-down.md': jotDown }, 'learn->archived': { 'retrospective.md': sdlcRetro } },
};

describe.skipIf(!url)('seed track lifecycles', () => {
  let deps: ServiceDeps;
  beforeAll(async () => { const pool = await getTestPool(); await truncateAll(pool); await seedPacks(pool); deps = { pool, embedder: packsEmbedder, tokenBudget: 6000 }; });
  afterAll(closeTestPool);

  for (const key of Object.keys(ARTIFACTS)) {
    const [framework, track] = key.split('/') as [string, string];
    it(`${framework} ${track}: start to archived with every transition recorded`, async () => {
      const intent: Intent = track === 'hotfix' ? 'incident' : track === 'refactor' ? 'refactor' : 'feature';
      const decision: Decision = { intent, framework, track, confidence: 'high', rule: 'test', reasons: [], high_risk: false, policy_version: null, framework_pack_version: '1.0.0' };
      const start = await startFeature(deps, { app: 'checkout', actor: 'walker', task_description: `Walk ${key}`, decision, trigger_ref: track === 'hotfix' ? 'INC-204' : null });
      expect(start.context_pack).toContain('## 3. Phase template');
      const fw = (await getFrameworkVersion(deps.pool, framework, '1.0.0'))!;
      const phases = phaseOrder(trackOf(fw, track));
      let current: Phase = 'specify';
      for (let i = 0; i < phases.length; i++) {
        const target = i === phases.length - 1 ? 'archived' : phases[i + 1]!;
        const artifacts = ARTIFACTS[key]![`${current}->${target}`] ?? {};
        const r = await advancePhase(deps, {
          feature_id: start.feature_id, actor: 'walker', expected_phase: current, target_phase: target, artifacts,
          evidence: current === 'verify' ? evidence : undefined, human_approved: true,
        });
        expect(r.findings.filter((f) => f.severity === 'blocker'), `${key} ${current}->${target}`).toEqual([]);
        expect(r.result).toBe('pass');
        if (target !== 'archived') current = target as Phase;
      }
      const status = await getFeatureStatus(deps, start.feature_id);
      expect(status.status).toBe('archived');
      expect(status.transitions).toHaveLength(phases.length);
      expect(status.transitions.every((t) => t.result === 'pass')).toBe(true);
      const artifactRows = (await deps.pool.query('SELECT count(*)::int AS n FROM feature_artifacts a JOIN phase_transitions t ON t.id = a.transition_id WHERE t.feature_id = $1', [start.feature_id])).rows[0].n;
      const expected = Object.values(ARTIFACTS[key]!).reduce((s, a) => s + Object.keys(a).length, 0);
      expect(artifactRows).toBe(expected);
      expect(Object.keys(status.latest_pack_per_phase)).toEqual(['specify']);
    });
  }

  it('hotfix defers spec review to verify and requires it there', async () => {
    // high_risk stays false so the approval demanded at verify->integrate can only come from the
    // track's own spec_review: deferred, not from the high-risk branch of mandatesApproval.
    const decision: Decision = { intent: 'incident', framework: 'openspec', track: 'hotfix', confidence: 'high', rule: 'test', reasons: [], high_risk: false, policy_version: null, framework_pack_version: '1.0.0' };
    const s = await startFeature(deps, { app: 'checkout', actor: 'w', task_description: 'outage', decision });
    const first = await advancePhase(deps, { feature_id: s.feature_id, actor: 'w', expected_phase: 'specify', target_phase: 'implement', artifacts: { 'proposal.md': hotfixProposal } });
    expect(first.result).toBe('pass');
    await advancePhase(deps, { feature_id: s.feature_id, actor: 'w', expected_phase: 'implement', target_phase: 'verify' });
    const noApproval = await advancePhase(deps, { feature_id: s.feature_id, actor: 'w', expected_phase: 'verify', target_phase: 'integrate', evidence });
    expect(noApproval.findings.map((f) => f.check)).toEqual(['human_approved']);
  });

  it('refactor tracks block when existing tests were modified', async () => {
    const decision: Decision = { intent: 'refactor', framework: 'openspec', track: 'refactor', confidence: 'high', rule: 'test', reasons: [], high_risk: false, policy_version: null, framework_pack_version: '1.0.0' };
    const s = await startFeature(deps, { app: 'checkout', actor: 'w', task_description: 'refactor exports', decision });
    await advancePhase(deps, { feature_id: s.feature_id, actor: 'w', expected_phase: 'specify', target_phase: 'implement', artifacts: { 'proposal.md': refactorProposal, 'spec.md': emptyDelta }, human_approved: true });
    await advancePhase(deps, { feature_id: s.feature_id, actor: 'w', expected_phase: 'implement', target_phase: 'verify' });
    const r = await advancePhase(deps, { feature_id: s.feature_id, actor: 'w', expected_phase: 'verify', target_phase: 'integrate', evidence: { ...evidence, existing_tests_modified: 2 } });
    expect(r.result).toBe('fail');
    expect(r.findings[0]?.message).toMatch(/2 existing test file\(s\) modified, max 0/);
  });
});
