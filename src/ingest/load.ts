import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import matter from 'gray-matter';
import { parse as parseYaml } from 'yaml';
import type { KnowledgeKind } from '../domain/types.js';
import { FrontMatterSchema, PackManifestSchema, type FrontMatter, type PackManifest } from './schema.js';

export interface LoadedItem { frontMatter: FrontMatter; body: string; sourcePath: string; sourceHash: string }
export interface LoadedPack { dir: string; manifest: PackManifest; items: LoadedItem[] }

async function markdownFiles(root: string, dir = root): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir)) {
    const full = join(dir, entry);
    const s = await stat(full);
    if (s.isDirectory()) out.push(...(await markdownFiles(root, full)));
    else if (entry.endsWith('.md') && entry !== 'README.md') out.push(full);
  }
  return out.sort();
}

export async function loadPack(dir: string): Promise<LoadedPack> {
  const manifestPath = join(dir, 'pack.yaml');
  let raw: string;
  try { raw = await readFile(manifestPath, 'utf8'); } catch { throw new Error(`no pack.yaml found in ${dir}`); }
  const manifest = PackManifestSchema.parse(parseYaml(raw));
  const items: LoadedItem[] = [];
  for (const file of await markdownFiles(dir)) {
    const text = await readFile(file, 'utf8');
    const parsed = matter(text);
    const fm = FrontMatterSchema.safeParse(parsed.data);
    const sourcePath = relative(dir, file);
    if (!fm.success) throw new Error(`${sourcePath}: invalid front matter: ${fm.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
    items.push({ frontMatter: fm.data, body: parsed.content.trim(), sourcePath, sourceHash: createHash('sha256').update(text, 'utf8').digest('hex') });
  }
  return { dir, manifest, items: items.sort((a, b) => a.frontMatter.id.localeCompare(b.frontMatter.id)) };
}

export function effectiveKind(pack: LoadedPack, item: LoadedItem): KnowledgeKind {
  return item.frontMatter.kind ?? pack.manifest.kind;
}
export function effectiveFramework(pack: LoadedPack, item: LoadedItem): string | null {
  return item.frontMatter.framework === undefined ? pack.manifest.framework : item.frontMatter.framework;
}
export function effectiveApp(pack: LoadedPack, item: LoadedItem): string | null {
  return item.frontMatter.app === undefined ? pack.manifest.app : item.frontMatter.app;
}
