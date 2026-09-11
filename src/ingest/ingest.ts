import type pg from 'pg';
import { withTransaction } from '../db/pool.js';
import { assertEmbeddingConfigMatches } from '../embedding/index.js';
import type { EmbeddingProvider } from '../embedding/provider.js';
import { EMBEDDING_DIMENSION } from '../embedding/provider.js';
import { GATE_LIBRARY_VERSION } from '../gates/library.js';
import { listApps } from '../store/apps.js';
import { insertChunks, type NewChunk } from '../store/chunks.js';
import { getEmbeddingConfig, setEmbeddingConfig } from '../store/embeddingConfig.js';
import { upsertFramework } from '../store/frameworks.js';
import { currentItem, insertItemVersion, listActivePackItems, markSuperseded, type NewKnowledgeItem } from '../store/knowledge.js';
import { TOKENIZER } from '../tokens.js';
import { chunkMarkdown, embedText, type Chunk } from './chunk.js';
import { effectiveApp, effectiveFramework, effectiveKind, type LoadedItem, type LoadedPack } from './load.js';
import { validatePack } from './validate.js';

export interface IngestDeps { pool: pg.Pool; embedder: EmbeddingProvider }
export interface IngestReport { pack: string; version: string; created: string[]; skipped: string[]; warnings: string[] }

interface Planned { item: LoadedItem; row: NewKnowledgeItem; chunks: Chunk[]; embeddings: number[][] }

export async function ingestPack(deps: IngestDeps, pack: LoadedPack, actor: string): Promise<IngestReport> {
  const { pool, embedder } = deps;
  const apps = await listApps(pool);
  const { errors, warnings } = validatePack(pack, { knownAppSlugs: new Set(apps.map((a) => a.slug)) });
  if (errors.length > 0) throw new Error(`pack ${pack.manifest.name} is invalid:\n- ${errors.join('\n- ')}`);
  await assertEmbeddingConfigMatches(pool, embedder);
  const appIdBySlug = new Map(apps.map((a) => [a.slug, a.id]));

  const planned: Planned[] = [];
  const skipped: string[] = [];
  for (const item of pack.items) {
    const kind = effectiveKind(pack, item);
    const current = await currentItem(pool, item.frontMatter.id);
    const unchanged = current?.source_hash === item.sourceHash && (kind !== 'framework_pack' || current.pack_version === pack.manifest.version);
    if (unchanged) { skipped.push(item.frontMatter.id); continue; }
    const appSlug = effectiveApp(pack, item);
    planned.push({
      item,
      row: {
        stable_id: item.frontMatter.id, kind, tier: item.frontMatter.tier, framework: effectiveFramework(pack, item),
        app_id: appSlug ? appIdBySlug.get(appSlug)! : null, memory_type: item.frontMatter.memory_type ?? null, human_id: item.frontMatter.human_id ?? null,
        stack_tags: item.frontMatter.stack_tags, phase_tags: item.frontMatter.phases, title: item.frontMatter.title, body: item.body,
        front_matter: item.frontMatter as unknown as Record<string, unknown>, pack_name: pack.manifest.name, pack_version: pack.manifest.version,
        source_path: item.sourcePath, source_hash: item.sourceHash, source_url: pack.manifest.source_url, license: pack.manifest.license,
      },
      chunks: chunkMarkdown(item.body),
      embeddings: [],
    });
  }

  const texts = planned.flatMap((p) => p.chunks.map((c) => embedText(p.item.frontMatter.title, c)));
  const vectors = texts.length > 0 ? await embedder.embed(texts, 'document') : [];
  let cursor = 0;
  for (const p of planned) { p.embeddings = vectors.slice(cursor, cursor + p.chunks.length); cursor += p.chunks.length; }

  const existing = await listActivePackItems(pool, pack.manifest.name);
  const inPack = new Set(pack.items.map((i) => i.frontMatter.id));
  for (const row of existing) {
    if (!inPack.has(row.stable_id)) warnings.push(`${row.stable_id} is active in the database but no longer in the pack; deprecate it explicitly if intended`);
  }

  await withTransaction(pool, async (tx) => {
    for (const p of planned) {
      const row = await insertItemVersion(tx, p.row, actor);
      const chunks: NewChunk[] = p.chunks.map((c, i) => ({
        ordinal: c.ordinal, heading_path: c.heading_path, text: c.text, embedding: p.embeddings[i]!, embedding_model: embedder.model, token_count: c.token_count, tokenizer: TOKENIZER,
      }));
      await insertChunks(tx, row.id, chunks, actor);
      if (p.item.frontMatter.supersedes) {
        const target = await currentItem(tx, p.item.frontMatter.supersedes);
        if (target) await markSuperseded(tx, target.id, row.id);
        else warnings.push(`${row.stable_id} supersedes "${p.item.frontMatter.supersedes}" which has no current version`);
      }
    }
    if (pack.manifest.kind === 'framework_pack' && pack.manifest.tracks) {
      await upsertFramework(tx, { name: pack.manifest.framework ?? pack.manifest.name, pack_version: pack.manifest.version, tracks: pack.manifest.tracks, gate_library_version: GATE_LIBRARY_VERSION }, actor);
    }
    if (!(await getEmbeddingConfig(tx))) await setEmbeddingConfig(tx, { provider: embedder.provider, model: embedder.model, dimension: EMBEDDING_DIMENSION }, actor);
  });

  return { pack: pack.manifest.name, version: pack.manifest.version, created: planned.map((p) => p.row.stable_id), skipped, warnings };
}
