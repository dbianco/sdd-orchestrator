import type { Queryable } from '../db/pool.js';
import type { TrackDecl } from '../domain/types.js';
import { newId } from '../ids.js';
import { TrackDeclSchema } from '../lifecycle/track.js';
import type { FrameworkRow } from './rows.js';

function normalizeFrameworkRow(row: FrameworkRow): FrameworkRow {
  const sortedTracks = Object.keys(row.tracks)
    .sort()
    .reduce((obj, key) => {
      obj[key] = row.tracks[key];
      return obj;
    }, {} as Record<string, unknown>);
  return { ...row, tracks: sortedTracks };
}

export function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number(n) || 0);
  const pb = b.split('.').map((n) => Number(n) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export async function upsertFramework(
  q: Queryable,
  input: { name: string; pack_version: string; tracks: Record<string, TrackDecl>; gate_library_version: string },
  actor: string,
): Promise<FrameworkRow> {
  const r = await q.query<FrameworkRow>(
    `INSERT INTO frameworks (id, name, pack_version, tracks, gate_library_version, status, created_by)
     VALUES ($1, $2, $3, $4, $5, 'active', $6)
     ON CONFLICT (name, pack_version) DO UPDATE SET tracks = EXCLUDED.tracks, gate_library_version = EXCLUDED.gate_library_version, updated_at = now()
     RETURNING *`,
    [newId('fw'), input.name, input.pack_version, JSON.stringify(input.tracks), input.gate_library_version, actor],
  );
  return normalizeFrameworkRow(r.rows[0]!);
}

export async function currentFramework(q: Queryable, name: string): Promise<FrameworkRow | null> {
  const r = await q.query<FrameworkRow>(`SELECT * FROM frameworks WHERE name = $1 AND status = 'active'`, [name]);
  const sorted = [...r.rows].map(normalizeFrameworkRow).sort((a, b) => compareSemver(b.pack_version, a.pack_version));
  return sorted[0] ?? null;
}

export async function getFrameworkVersion(q: Queryable, name: string, packVersion: string): Promise<FrameworkRow | null> {
  const r = await q.query<FrameworkRow>('SELECT * FROM frameworks WHERE name = $1 AND pack_version = $2', [name, packVersion]);
  return r.rows[0] ? normalizeFrameworkRow(r.rows[0]) : null;
}

export async function listCurrentFrameworks(q: Queryable): Promise<FrameworkRow[]> {
  const r = await q.query<FrameworkRow>(`SELECT * FROM frameworks WHERE status = 'active'`);
  const normalized = r.rows.map(normalizeFrameworkRow);
  const byName = new Map<string, FrameworkRow>();
  for (const row of normalized) {
    const cur = byName.get(row.name);
    if (!cur || compareSemver(row.pack_version, cur.pack_version) > 0) byName.set(row.name, row);
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function deprecateFramework(q: Queryable, name: string, packVersion: string | null, reason: string, actor: string): Promise<number> {
  void reason; void actor;
  const r = packVersion
    ? await q.query(`UPDATE frameworks SET status = 'deprecated', updated_at = now() WHERE name = $1 AND pack_version = $2 AND status = 'active'`, [name, packVersion])
    : await q.query(`UPDATE frameworks SET status = 'deprecated', updated_at = now() WHERE name = $1 AND status = 'active'`, [name]);
  return r.rowCount ?? 0;
}

export function trackOf(row: FrameworkRow, track: string | null): TrackDecl {
  const key = track ?? 'default';
  const raw = row.tracks[key];
  if (raw === undefined) throw new Error(`framework ${row.name}@${row.pack_version} has no track "${key}"`);
  return TrackDeclSchema.parse(raw) as TrackDecl;
}

export function trackNames(row: FrameworkRow): string[] {
  return Object.keys(row.tracks);
}
