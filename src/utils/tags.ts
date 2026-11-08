/**
 * Tag rules, driven by TagConfig (handlers/tags.go) instead of per-tag code.
 */
import type { TagConfig } from '../api/types.js';

/** Adds `tag`, dropping any other tag from its group (one per group). */
export function withTag(tags: string[], tag: string, config: TagConfig): string[] {
  const group = config.groups.find((g) => g.includes(tag)) ?? [tag];
  return [...tags.filter((t) => !group.includes(t)), tag];
}

/** Whether a song with `tags` shows under the `filter` tag. */
export function matchesTag(tags: string[], filter: string, config: TagConfig): boolean {
  return tags.some((t) => t === filter || (config.implies[t]?.includes(filter) ?? false));
}
