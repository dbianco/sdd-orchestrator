import { z } from 'zod';
import { withTransaction } from '../db/pool.js';
import type { IngestDeps } from '../ingest/ingest.js';
import { chunkMarkdown, embedText } from '../ingest/chunk.js';
import { insertChunks } from '../store/chunks.js';
import { currentItem, insertItemVersion, markSuperseded, nextProposalSequence } from '../store/knowledge.js';
import { getProposal, reviewProposal } from '../store/proposals.js';
import type { KnowledgeItemRow } from '../store/rows.js';
import { TOKENIZER } from '../tokens.js';

export const ProposalPayloadSchema = z.object({
  kind: z.enum(['app_memory', 'standard']),
  memory_type: z.enum(['adr', 'decision', 'constraint', 'incident']).nullable().optional(),
  title: z.string().min(1),
  body: z.string().min(1),
  stack_tags: z.array(z.string()).default([]),
  links: z.array(z.string()).default([]),
});

const LEADING_ID = /^(ADR|REQ|US|INC)-\d+\b/;

export async function approveProposal(deps: IngestDeps, proposalId: string, reviewer: string): Promise<KnowledgeItemRow> {
  const proposal = await getProposal(deps.pool, proposalId);
  if (!proposal) throw new Error(`no proposal with id "${proposalId}"`);
  if (proposal.status !== 'pending') throw new Error(`proposal ${proposalId} is already ${proposal.status}`);
  const payload = ProposalPayloadSchema.parse(proposal.payload);
  const app = (await deps.pool.query<{ slug: string }>('SELECT slug FROM apps WHERE id = $1', [proposal.app_id])).rows[0]!;
  const memoryType = payload.kind === 'app_memory' ? payload.memory_type ?? null : null;
  if (payload.kind === 'app_memory' && !memoryType) throw new Error('app_memory proposals require memory_type');
  const seqKey = payload.kind === 'app_memory' ? memoryType! : 'standard';
  const body = payload.links.length > 0 ? `${payload.body.trim()}\n\n## Links\n${payload.links.map((l) => `- ${l}`).join('\n')}` : payload.body.trim();
  const chunks = chunkMarkdown(body);
  const vectors = chunks.length > 0 ? await deps.embedder.embed(chunks.map((c) => embedText(payload.title, c)), 'document') : [];

  return withTransaction(deps.pool, async (tx) => {
    // Re-check under a row lock: the pre-transaction read above is only an optimistic
    // check. Lock and re-read the proposal row now that we're inside the transaction, in
    // case another approval of the same proposal is racing us.
    const locked = await tx.query<{ status: string }>('SELECT status FROM proposals WHERE id = $1 FOR UPDATE', [proposal.id]);
    const lockedStatus = locked.rows[0]?.status;
    if (lockedStatus !== 'pending') throw new Error(`proposal ${proposalId} is already ${lockedStatus}`);
    const seq = await nextProposalSequence(tx, app.slug, seqKey);
    const stableId = `${app.slug}.${seqKey}.${String(seq).padStart(4, '0')}`;
    const row = await insertItemVersion(tx, {
      stable_id: stableId, kind: payload.kind, tier: 'retrieved', framework: null, app_id: proposal.app_id, memory_type: memoryType,
      human_id: LEADING_ID.exec(payload.title)?.[0] ?? null, stack_tags: payload.stack_tags, phase_tags: [], title: payload.title, body,
      front_matter: { proposal_id: proposal.id, feature_id: proposal.feature_id, links: payload.links }, pack_name: 'proposals', pack_version: null,
      source_path: null, source_hash: null, source_url: null, license: null,
    }, reviewer);
    await insertChunks(tx, row.id, chunks.map((c, i) => ({ ordinal: c.ordinal, heading_path: c.heading_path, text: c.text, embedding: vectors[i]!, embedding_model: deps.embedder.model, token_count: c.token_count, tokenizer: TOKENIZER })), reviewer);
    if (proposal.supersedes) {
      const target = await currentItem(tx, proposal.supersedes);
      if (target) await markSuperseded(tx, target.id, row.id);
    }
    await reviewProposal(tx, proposal.id, 'approved', reviewer, null);
    return row;
  });
}
