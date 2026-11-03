import type { Queryable } from '../db/pool.js';
import { LOCKFILES, ownedFilesSql } from '../store/drift.js';

// A "tiny" change delivered through a full spec track: few files and few requirements. The light path (route with
// workspace.intent "trivial") would have been enough for similar work, unless the app is under compliance or the
// feature is high risk, where the full process is required.
export const TINY_MAX_FILES = 3;
export const TINY_MAX_REQUIREMENTS = 2;
const LIGHT_TRACKS = new Set(['hotfix', 'quick']);

export function isFullTrack(track: string | null): boolean {
  return !track || !LIGHT_TRACKS.has(track);
}

export function isTinyChange(files: number, requirements: number): boolean {
  return files > 0 && files <= TINY_MAX_FILES && requirements <= TINY_MAX_REQUIREMENTS;
}

export function rightSizingSuggestion(s: { files: number; requirements: number; framework: string; track: string | null }): string {
  return `Right-sizing: this change touched ${s.files} file(s) for ${s.requirements} requirement(s) but went through the full ${s.framework}${s.track ? `:${s.track}` : ''} track. `
    + 'If similar work touches no compliance-sensitive paths, route it with workspace.intent "trivial" next time to get the light pack without spec phases.';
}

/** Files and requirements a feature delivered, for the archive-time hint. */
export async function featureChangeSize(q: Queryable, featureId: string): Promise<{ files: number; requirements: number }> {
  const r = await q.query<{ files: number; requirements: number }>(
    `WITH archived AS (SELECT $1::text AS id),
          owned AS (${ownedFilesSql('$2')})
     SELECT (SELECT count(*) FROM owned)::int AS files, (SELECT count(*) FROM feature_requirements WHERE feature_id = $1)::int AS requirements`,
    [featureId, LOCKFILES],
  );
  return r.rows[0]!;
}

export interface RightSizingEntry { feature_id: string; slug: string; framework: string; track: string | null; files: number; requirements: number; cycle_hours: number | null }
export interface RightSizing {
  thresholds: { max_files: number; max_requirements: number };
  archived_full_track: number; tiny: number; share: number | null; entries: RightSizingEntry[];
}

/** Archived features that went through a full track although the change was tiny; compliance and high-risk work is excluded. */
export async function rightSizingReport(q: Queryable, appId: string | null = null, limit = 25): Promise<RightSizing> {
  const r = await q.query<{ feature_id: string; slug: string; framework: string; track: string | null; files: number; requirements: number; cycle_hours: number | null }>(
    `WITH archived AS (
       SELECT f.id, f.slug, f.framework, f.track, f.created_at, max(pt.created_at) AS archived_at
       FROM features f JOIN apps a ON a.id = f.app_id
       JOIN phase_transitions pt ON pt.feature_id = f.id AND pt.to_phase = 'archived' AND pt.result = 'pass'
       WHERE f.status = 'archived' AND NOT f.high_risk AND NOT a.compliance AND ($1::text IS NULL OR f.app_id = $1)
       GROUP BY f.id, f.slug, f.framework, f.track, f.created_at),
     owned AS (${ownedFilesSql('$2')})
     SELECT a.id AS feature_id, a.slug, a.framework, a.track,
            (SELECT count(*) FROM owned o WHERE o.feature_id = a.id)::int AS files,
            (SELECT count(*) FROM feature_requirements fr WHERE fr.feature_id = a.id)::int AS requirements,
            (extract(epoch FROM a.archived_at - a.created_at) / 3600)::float AS cycle_hours
     FROM archived a ORDER BY a.archived_at DESC`,
    [appId, LOCKFILES],
  );
  // Features with no recorded files cannot be sized, so they count in neither number.
  const sized = r.rows.filter((x) => isFullTrack(x.track) && x.files > 0);
  const tiny = sized.filter((x) => isTinyChange(x.files, x.requirements));
  return {
    thresholds: { max_files: TINY_MAX_FILES, max_requirements: TINY_MAX_REQUIREMENTS },
    archived_full_track: sized.length, tiny: tiny.length, share: sized.length === 0 ? null : tiny.length / sized.length,
    entries: tiny.slice(0, limit).map((x) => ({ ...x, cycle_hours: x.cycle_hours === null ? null : Math.round(x.cycle_hours * 10) / 10 })),
  };
}
