export function slugify(text: string, maxLength = 48): string {
  const slug = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  return slug.slice(0, maxLength).replace(/-+$/g, '');
}

export function defaultFeatureSlug(taskDescription: string, externalRef: string | null): string {
  const base = slugify(taskDescription);
  return externalRef ? `${slugify(externalRef, 24)}-${base}`.slice(0, 64).replace(/-+$/g, '') : base;
}
