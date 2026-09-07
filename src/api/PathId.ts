// Keep opaque IDs in a single path segment through URL normalization and Go's
// generated parameter binding. JSON and query IDs remain unchanged.
export const encodePathId = (id: string): string => id === '.' || id === '..' || /[/%]/.test(id) || id.startsWith('~')
  ? `~${Buffer.from(id, 'utf8').toString('base64url')}` : encodeURIComponent(id);
