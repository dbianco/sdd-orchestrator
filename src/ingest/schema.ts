import { z } from 'zod';
import { PHASES } from '../domain/types.js';
import { TracksSchema } from '../lifecycle/track.js';

const KindSchema = z.enum(['framework_pack', 'standard', 'stack_guide', 'app_memory']);
const MemoryTypeSchema = z.enum(['adr', 'decision', 'constraint', 'incident']);

export const PackManifestSchema = z.object({
  name: z.string().min(1),
  kind: KindSchema,
  framework: z.string().min(1).nullable().default(null),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'version must be semver x.y.z'),
  source_url: z.string().nullable().default(null),
  license: z.string().nullable().default(null),
  app: z.string().min(1).nullable().default(null),
  tracks: TracksSchema.optional(),
});
export type PackManifest = z.infer<typeof PackManifestSchema>;

export const FrontMatterSchema = z.object({
  id: z.string().min(1),
  kind: KindSchema.optional(),
  tier: z.enum(['always_on', 'retrieved']).default('retrieved'),
  framework: z.string().min(1).nullable().optional(),
  app: z.string().min(1).nullable().optional(),
  memory_type: MemoryTypeSchema.nullable().optional(),
  human_id: z.string().min(1).nullable().optional(),
  phases: z.array(z.enum(PHASES)).default([]),
  stack_tags: z.array(z.string().min(1)).default([]),
  title: z.string().min(1),
  supersedes: z.string().min(1).nullable().optional(),
});
export type FrontMatter = z.infer<typeof FrontMatterSchema>;
