import type { CacheEntry, JsonCache } from '../../src/data/cache.js';

/** In-memory JsonCache for tests. Values are JSON round-tripped, like the file cache. */
export class MemoryCache implements JsonCache {
  readonly entries = new Map<string, CacheEntry>();

  get(namespace: string, key: string): CacheEntry | null {
    return this.entries.get(`${namespace}\n${key}`) ?? null;
  }

  set(namespace: string, key: string, value: unknown, now: Date): void {
    this.entries.set(`${namespace}\n${key}`, { storedAt: now.toISOString(), value: JSON.parse(JSON.stringify(value)) });
  }
}
