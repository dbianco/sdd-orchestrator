import type { Queryable } from '../db/pool.js';

export interface DriftCommit { sha: string; message: string; at: string; feature_slug: string | null }
export interface DriftFile { file: string; commits: DriftCommit[] }
export interface DriftEntry {
  feature_id: string; slug: string; app: string; archived_at: string;
  // likely: someone changed these files with no spec (work routed without a feature); review: only other features changed them.
  level: 'likely' | 'review';
  unspecced_commits: number; other_feature_commits: number; last_changed_at: string; files: DriftFile[];
}

export const LOCKFILES = String.raw`(^|/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|Cargo\.lock|go\.sum)$`;

/** SQL for the files a feature delivered: its commits plus the evidence sent when it left verify, minus lockfiles. Needs an `archived` CTE with column id. */
export const ownedFilesSql = (regexParam: string): string => `
  SELECT DISTINCT x.feature_id, x.file FROM (
    SELECT a.id AS feature_id, unnest(c.files_changed) AS file FROM archived a JOIN commits c ON c.feature_id = a.id
    UNION ALL
    SELECT a.id, jsonb_array_elements_text(pt.evidence->'files_changed')
    FROM archived a JOIN phase_transitions pt ON pt.feature_id = a.id AND pt.from_phase = 'verify' AND pt.result = 'pass' AND jsonb_typeof(pt.evidence->'files_changed') = 'array'
  ) x WHERE x.file !~ ${regexParam}`;
const MAX_FILES = 20;
const MAX_COMMITS_PER_FILE = 5;

interface Row { feature_id: string; slug: string; app: string; archived_at: Date; file: string; sha: string; message: string; at: Date; by_feature_id: string | null; by_feature_slug: string | null }

/**
 * Archived features whose files were changed again after archive. The files a feature owns are those of its commits
 * and of the evidence sent when it left verify. A change that no feature covers (work routed as trivial, or reported
 * without a feature) means the accepted spec may be stale; changes made through another feature are listed for review.
 */
export async function driftReport(q: Queryable, appId: string | null = null, limit = 100): Promise<DriftEntry[]> {
  const r = await q.query<Row>(
    `WITH archived AS (
       SELECT f.id, f.slug, f.app_id, a.slug AS app, max(pt.created_at) AS archived_at
       FROM features f JOIN apps a ON a.id = f.app_id
       JOIN phase_transitions pt ON pt.feature_id = f.id AND pt.to_phase = 'archived' AND pt.result = 'pass'
       WHERE f.status = 'archived' AND ($1::text IS NULL OR f.app_id = $1)
       GROUP BY f.id, f.slug, f.app_id, a.slug),
     owned AS (${ownedFilesSql('$2')})
     SELECT a.id AS feature_id, a.slug, a.app, a.archived_at, o.file, c.sha, c.message,
            COALESCE(c.committed_at, c.created_at) AS at, c.feature_id AS by_feature_id, f2.slug AS by_feature_slug
     FROM archived a
     JOIN owned o ON o.feature_id = a.id
     JOIN commits c ON c.app_id = a.app_id AND o.file = ANY(c.files_changed)
                    AND COALESCE(c.committed_at, c.created_at) > a.archived_at AND c.feature_id IS DISTINCT FROM a.id
     LEFT JOIN features f2 ON f2.id = c.feature_id
     ORDER BY a.archived_at DESC, o.file, at`,
    [appId, LOCKFILES],
  );

  const byFeature = new Map<string, { row: Row; files: Map<string, DriftCommit[]>; seen: Set<string>; unspecced: Set<string>; other: Set<string>; last: Date }>();
  for (const row of r.rows) {
    const g = byFeature.get(row.feature_id) ?? { row, files: new Map(), seen: new Set(), unspecced: new Set(), other: new Set(), last: row.at };
    const commits = g.files.get(row.file) ?? [];
    if (!commits.some((c: DriftCommit) => c.sha === row.sha)) commits.push({ sha: row.sha, message: row.message.split('\n')[0] ?? '', at: row.at.toISOString(), feature_slug: row.by_feature_slug });
    g.files.set(row.file, commits);
    (row.by_feature_id === null ? g.unspecced : g.other).add(row.sha);
    if (row.at > g.last) g.last = row.at;
    byFeature.set(row.feature_id, g);
  }
  const entries: DriftEntry[] = [...byFeature.values()].map((g) => ({
    feature_id: g.row.feature_id, slug: g.row.slug, app: g.row.app, archived_at: g.row.archived_at.toISOString(),
    level: g.unspecced.size > 0 ? 'likely' : 'review',
    unspecced_commits: g.unspecced.size, other_feature_commits: g.other.size, last_changed_at: g.last.toISOString(),
    files: [...g.files].slice(0, MAX_FILES).map(([file, commits]) => ({ file, commits: commits.slice(0, MAX_COMMITS_PER_FILE) })),
  }));
  entries.sort((a, b) => (a.level === b.level ? b.unspecced_commits + b.other_feature_commits - (a.unspecced_commits + a.other_feature_commits) : a.level === 'likely' ? -1 : 1));
  return entries.slice(0, limit);
}
