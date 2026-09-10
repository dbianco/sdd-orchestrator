import type { Decision, Intent, Policy, Size, Workspace } from '../domain/types.js';
import { DomainError } from '../errors.js';
import { inferIntent, type IntentPhraseLists } from './intent.js';
import { greenfieldOf, matchPolicyPathRule, matchRiskPaths, sizeOf } from './signals.js';

export interface KnownFramework { name: string; pack_version: string; tracks: string[] }
export interface RouterInput {
  task_description: string;
  workspace: Workspace;
  framework_preference?: string | null;
  policy: Policy | null;
  policy_version: number | null;
  app: { compliance: boolean; default_stack: string[] };
  frameworks: KnownFramework[];
  phraseLists?: IntentPhraseLists;
}
export interface RouterSignals {
  size: Size;
  greenfield: boolean | null;
  risk_paths: string[];
  intent_source: 'host' | 'inferred';
}
export interface RouterOutput {
  decision: Decision;
  clarifying_questions: string[];
  warnings: string[];
  guidance: string | null;
  lite: boolean;
  signals: RouterSignals;
}

export const SPIKE_GUIDANCE =
  'Prototype first. Time-box the spike, keep the code disposable, write down what you learned and what you would build next. ' +
  'When the question is answered, route the follow-up as a feature; no lifecycle state is kept for a spike.';

export function parseFrameworkRef(ref: string): { name: string; track: string | null } {
  const [name, track] = ref.split(':', 2);
  return { name: name!, track: track ?? null };
}

interface Ctx {
  intent: Intent;
  size: Size;
  greenfield: boolean | null;
  risk: readonly string[];
  compliance: boolean;
  ws: Readonly<Workspace>;
  frameworks: ReadonlyMap<string, KnownFramework>;
  reasons: readonly string[];
}

function requireFramework(ctx: Readonly<Ctx>, name: string, source: string): KnownFramework {
  const fw = ctx.frameworks.get(name);
  if (!fw) {
    throw new DomainError('UNKNOWN_FRAMEWORK', `${source} names framework "${name}" which has no current version`, {
      framework: name, known: [...ctx.frameworks.keys()],
    });
  }
  return fw;
}

function trackForIntent(fw: KnownFramework, ctx: Readonly<Ctx>, named: string | null): string | null {
  if (fw.tracks.length === 0) return null;
  if (named) {
    if (!fw.tracks.includes(named)) {
      throw new DomainError('UNKNOWN_FRAMEWORK', `framework "${fw.name}" has no track "${named}"`, { framework: fw.name, tracks: fw.tracks });
    }
    return named;
  }
  if (fw.name === 'openspec') {
    if (ctx.intent === 'incident' && fw.tracks.includes('hotfix')) return 'hotfix';
    if (ctx.intent === 'refactor' && fw.tracks.includes('refactor')) return 'refactor';
  }
  if (fw.name === 'spec-kit' && ctx.intent === 'refactor' && fw.tracks.includes('refactor')) return 'refactor';
  if (fw.name === 'bmad') return fw.tracks.includes('full') ? 'full' : fw.tracks[0]!;
  return fw.tracks.includes('default') ? 'default' : fw.tracks[0]!;
}

interface RulePick { framework: string; track: string | null; rule: string; confidence: 'high' | 'medium'; questions: string[]; guidance: string | null; lite: boolean }

interface RulesResult { pick: RulePick; intent: Intent; reasons: string[] }

function rulesThreeToTwelve(ctx: Readonly<Ctx>): RulesResult {
  const extraReasons: string[] = [];
  let intent = ctx.intent;
  const done = (p: RulePick): RulesResult => ({ pick: p, intent, reasons: extraReasons });
  const none = (rule: string, guidance: string | null, lite: boolean): RulePick => ({ framework: 'none', track: null, rule, confidence: 'high', questions: [], guidance, lite });
  const pick = (name: string, rule: string, track?: string): RulePick => {
    const fw = requireFramework(ctx, name, `rule ${rule}`);
    return { framework: name, track: trackForIntent(fw, ctx, track ?? null), rule, confidence: 'high', questions: [], guidance: null, lite: false };
  };

  if (intent === 'spike') return done(none('3-spike', SPIKE_GUIDANCE, false));

  if (intent === 'trivial') {
    const causes: string[] = [];
    if (ctx.size !== 'small') causes.push(`size is ${ctx.size}`);
    if (ctx.risk.length > 0) causes.push(`risk path matched (${ctx.risk.join(', ')})`);
    if (ctx.compliance) causes.push('app is under compliance');
    if (causes.length === 0) return done(none('4-trivial', null, true));
    extraReasons.push(`intent trivial downgraded to feature: ${causes.join('; ')}`);
    intent = 'feature';
  }

  if (intent === 'product') return done(pick('sdlc', '5-product'));
  if (intent === 'incident') return done(pick('openspec', '6-incident', 'hotfix'));
  if (intent === 'refactor' && (ctx.size === 'small' || ctx.size === 'medium')) return done(pick('openspec', '7-refactor-small-medium', 'refactor'));
  if (intent === 'refactor' && ctx.size === 'large') return done(pick('spec-kit', '8-refactor-large', 'refactor'));
  if (ctx.size === 'large' && (ctx.compliance || ctx.ws.new_subsystem === true)) {
    const files = ctx.ws.estimated_files ?? null;
    const quick = files !== null && files <= 15 && !ctx.compliance;
    return done(pick('bmad', '9-large-compliance-or-subsystem', quick ? 'quick' : 'full'));
  }
  if (ctx.greenfield === false && (ctx.size === 'small' || ctx.size === 'medium')) return done(pick('openspec', '10-brownfield-small-medium', 'default'));
  if ((ctx.greenfield === true && (ctx.size === 'small' || ctx.size === 'medium')) || ctx.size === 'large') return done(pick('spec-kit', '11-greenfield-or-large', 'default'));

  const questions: string[] = [];
  if (ctx.greenfield === null) questions.push('Is this a greenfield repository (fewer than 20 commits) or does it already have a spec library?');
  if (ctx.size === 'unknown') questions.push('Roughly how many files will this change touch?');
  if (ctx.size === 'unknown' && ctx.ws.new_subsystem == null) questions.push('Does this introduce a new subsystem or a second repository?');
  const candidate = ctx.ws.has_spec_library === true ? 'openspec' : 'spec-kit';
  const fw = requireFramework(ctx, candidate, 'rule 12');
  return done({ framework: candidate, track: trackForIntent(fw, ctx, null), rule: '12-unknown', confidence: 'medium', questions: questions.slice(0, 3), guidance: null, lite: false });
}

export function route(input: RouterInput): RouterOutput {
  const ws = input.workspace;
  const reasons: string[] = [];
  const warnings: string[] = [];

  let intent: Intent;
  let intentSource: 'host' | 'inferred';
  if (ws.intent && ws.intent !== 'auto') {
    intent = ws.intent;
    intentSource = 'host';
    reasons.push(`intent ${intent} (asserted by host)`);
  } else {
    const inferred = inferIntent(input.task_description, input.phraseLists);
    intent = inferred.intent;
    intentSource = 'inferred';
    reasons.push(inferred.matched ? `intent ${intent} (matched "${inferred.matched}")` : 'intent feature (no phrase matched)');
  }

  const size = sizeOf(ws);
  const greenfield = greenfieldOf(ws);
  const risk = matchRiskPaths(ws.paths_touched ?? [], input.policy?.risk_paths ?? []);
  reasons.push(`size ${size}${ws.estimated_files != null ? ` (${ws.estimated_files} files, estimate asserted by host)` : ''}`);
  if (greenfield !== null) reasons.push(`${greenfield ? 'greenfield' : 'brownfield'} (asserted by host)`);
  if (risk.length > 0) reasons.push(`risk paths: ${risk.join(', ')}`);
  if (input.app.compliance) reasons.push('app under compliance');

  const ctx: Ctx = {
    intent, size, greenfield, risk, compliance: input.app.compliance, ws,
    frameworks: new Map(input.frameworks.map((f) => [f.name, f])), reasons,
  };

  let partial: RulePick | null = null;

  // Rule 1: policy
  if (input.policy) {
    const pathRule = matchPolicyPathRule(input.policy, ws.paths_touched ?? []);
    const ref = input.policy.framework ?? pathRule?.framework ?? null;
    if (ref) {
      const { name, track } = parseFrameworkRef(ref);
      const fw = requireFramework(ctx, name, 'policy');
      if (ctx.intent === 'trivial') { ctx.intent = 'feature'; reasons.push('intent trivial downgraded to feature: policy names a framework'); }
      reasons.push(pathRule && !input.policy.framework ? `policy path rule ${pathRule.glob} -> ${name}` : `policy names ${name}`);
      partial = { framework: name, track: trackForIntent(fw, ctx, track), rule: '1-policy', confidence: 'high', questions: [], guidance: null, lite: false };
    }
  }

  // Rule 2: explicit preference
  if (!partial && input.framework_preference) {
    const { name, track } = parseFrameworkRef(input.framework_preference);
    const fw = requireFramework(ctx, name, 'framework_preference');
    // Call BEFORE the trivial-downgrade mutation below, so the speculative "what would
    // rules 3-12 have chosen" call sees the original intent (e.g. still 'trivial')
    // rather than the already-downgraded 'feature'. rulesThreeToTwelve is pure (it
    // takes a Readonly<Ctx> and returns its intent/reasons changes rather than
    // mutating), so this call cannot leak any side effects into the real ctx/reasons.
    let wouldHave: RulePick | null = null;
    try { wouldHave = rulesThreeToTwelve(ctx).pick; } catch { wouldHave = null; }
    if (ctx.intent === 'trivial') { ctx.intent = 'feature'; reasons.push('intent trivial downgraded to feature: explicit preference'); }
    if (wouldHave && wouldHave.framework !== name) {
      reasons.push(`preference ${name} honoured; rule ${wouldHave.rule} would have chosen ${wouldHave.framework}`);
    } else {
      reasons.push(`preference ${name} honoured`);
    }
    partial = { framework: name, track: trackForIntent(fw, ctx, track), rule: '2-preference', confidence: 'high', questions: [], guidance: null, lite: false };
  }

  if (!partial) {
    const result = rulesThreeToTwelve(ctx);
    ctx.intent = result.intent;
    reasons.push(...result.reasons);
    partial = result.pick;
  }

  const highRisk = risk.length > 0 || ctx.intent === 'incident';
  const fw = partial.framework === 'none' ? null : ctx.frameworks.get(partial.framework) ?? null;

  const decision: Decision = {
    intent: ctx.intent,
    framework: partial.framework,
    track: partial.track,
    confidence: partial.confidence,
    rule: partial.rule,
    reasons,
    high_risk: highRisk,
    policy_version: input.policy_version,
    framework_pack_version: fw?.pack_version ?? null,
  };

  return {
    decision,
    clarifying_questions: partial.questions,
    warnings,
    guidance: partial.guidance,
    lite: partial.lite,
    signals: { size, greenfield, risk_paths: risk, intent_source: intentSource },
  };
}
