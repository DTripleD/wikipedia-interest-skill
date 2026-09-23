/**
 * Small file-based JSON cache shared by the Pageviews layer and the resolver.
 *
 * Layout: `<dir>/<namespace>/<sha256(key)>.json`, each file holding
 * `{version, key, storedAt, value}`. Hashing keeps file names safe for any title
 * (slashes, Cyrillic, very long names); the full key is stored and checked on read.
 *
 * The cache is only an optimization, so it never breaks a request:
 * - unreadable, corrupt or foreign-version files are treated as a miss;
 * - write failures are ignored (the next run simply fetches again).
 * Writes go to a temp file first and are then renamed, so a reader never sees half a file.
 * Freshness rules (TTL, immutable days) belong to the callers, which get `storedAt` back.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getCacheDir } from '../config.js';

/** Bump when the file format or any cached value shape changes; old files become misses. */
export const CACHE_VERSION = 1;

export interface CacheEntry {
  /** ISO timestamp of when the value was written. */
  storedAt: string;
  /** Untrusted JSON: callers must validate its shape. */
  value: unknown;
}

export interface JsonCache {
  get(namespace: string, key: string): CacheEntry | null;
  set(namespace: string, key: string, value: unknown, now: Date): void;
}

export class FileCache implements JsonCache {
  constructor(readonly dir: string) {}

  get(namespace: string, key: string): CacheEntry | null {
    const file = this.file(namespace, key);
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      return null;
    }
    if (typeof parsed !== 'object' || parsed === null) return null;
    const entry = parsed as Record<string, unknown>;
    if (entry['version'] !== CACHE_VERSION || entry['key'] !== key) return null;
    if (typeof entry['storedAt'] !== 'string' || Number.isNaN(Date.parse(entry['storedAt']))) return null;
    if (!('value' in entry)) return null;
    return { storedAt: entry['storedAt'], value: entry['value'] };
  }

  set(namespace: string, key: string, value: unknown, now: Date): void {
    const file = this.file(namespace, key);
    const tmp = `${file}.${randomUUID()}.tmp`;
    try {
      mkdirSync(join(this.dir, namespace), { recursive: true });
      writeFileSync(tmp, JSON.stringify({ version: CACHE_VERSION, key, storedAt: now.toISOString(), value }));
      renameSync(tmp, file);
    } catch {
      rmSync(tmp, { force: true });
    }
  }

  private file(namespace: string, key: string): string {
    if (!/^[a-z0-9-]+$/.test(namespace)) throw new Error(`Invalid cache namespace "${namespace}".`);
    return join(this.dir, namespace, `${createHash('sha256').update(key).digest('hex')}.json`);
  }
}

/** Opens the cache configured by WIKI_SKILL_CACHE_DIR, or returns null if caching is disabled. */
export function openCache(env: NodeJS.ProcessEnv = process.env): FileCache | null {
  const dir = getCacheDir(env);
  return dir === null ? null : new FileCache(dir);
}

/** True if an entry written at `storedAt` is younger than `ttlMs` at `now`. */
export function isFresh(storedAt: string, ttlMs: number, now: Date): boolean {
  const age = now.getTime() - Date.parse(storedAt);
  return age >= 0 && age < ttlMs;
}
