import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CACHE_VERSION, FileCache, isFresh, openCache } from '../../src/data/cache.js';

const NOW = new Date('2026-09-23T12:00:00Z');

describe('FileCache', () => {
  let dir: string;
  let cache: FileCache;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'wiki-skill-cache-'));
    cache = new FileCache(join(dir, 'nested'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns null on a miss and round-trips values', () => {
    expect(cache.get('pageviews', 'k')).toBeNull();
    cache.set('pageviews', 'k', { a: [1, 2] }, NOW);
    expect(cache.get('pageviews', 'k')).toEqual({ storedAt: NOW.toISOString(), value: { a: [1, 2] } });
  });

  it('keeps keys and namespaces apart, including unsafe characters', () => {
    const k1 = 'uk.wikipedia|all-access|user|Астрономія';
    const k2 = 'en.wikipedia|all-access|user|AC/DC';
    cache.set('pageviews', k1, 1, NOW);
    cache.set('pageviews', k2, 2, NOW);
    cache.set('mediawiki', k1, 3, NOW);
    expect(cache.get('pageviews', k1)?.value).toBe(1);
    expect(cache.get('pageviews', k2)?.value).toBe(2);
    expect(cache.get('mediawiki', k1)?.value).toBe(3);
  });

  it('overwrites entries and leaves no temp files behind', () => {
    cache.set('pageviews', 'k', 1, NOW);
    cache.set('pageviews', 'k', 2, NOW);
    expect(cache.get('pageviews', 'k')?.value).toBe(2);
    expect(readdirSync(join(dir, 'nested', 'pageviews')).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('treats corrupt, foreign-version or mismatched files as a miss', () => {
    cache.set('pageviews', 'k', 1, NOW);
    const [file] = readdirSync(join(dir, 'nested', 'pageviews'));
    const path = join(dir, 'nested', 'pageviews', file!);

    writeFileSync(path, '{not json');
    expect(cache.get('pageviews', 'k')).toBeNull();
    writeFileSync(path, JSON.stringify({ version: CACHE_VERSION + 1, key: 'k', storedAt: NOW.toISOString(), value: 1 }));
    expect(cache.get('pageviews', 'k')).toBeNull();
    writeFileSync(path, JSON.stringify({ version: CACHE_VERSION, key: 'other', storedAt: NOW.toISOString(), value: 1 }));
    expect(cache.get('pageviews', 'k')).toBeNull();
    writeFileSync(path, JSON.stringify({ version: CACHE_VERSION, key: 'k', storedAt: 'yesterday', value: 1 }));
    expect(cache.get('pageviews', 'k')).toBeNull();
  });

  it('ignores write failures', () => {
    const file = join(dir, 'blocker');
    writeFileSync(file, 'not a directory');
    const broken = new FileCache(file);
    expect(() => broken.set('pageviews', 'k', 1, NOW)).not.toThrow();
    expect(broken.get('pageviews', 'k')).toBeNull();
  });

  it('rejects unsafe namespaces', () => {
    expect(() => cache.get('../x', 'k')).toThrow(/namespace/);
  });
});

describe('openCache / isFresh', () => {
  it('opens the configured directory or returns null when disabled', () => {
    expect(openCache({ WIKI_SKILL_CACHE_DIR: '' })).toBeNull();
    const abs = join(tmpdir(), 'wiki-cache-x');
    expect(openCache({ WIKI_SKILL_CACHE_DIR: abs })?.dir).toBe(abs);
  });

  it('checks the age of an entry', () => {
    const hour = 3_600_000;
    expect(isFresh('2026-09-23T11:30:00Z', hour, NOW)).toBe(true);
    expect(isFresh('2026-09-23T11:00:00Z', hour, NOW)).toBe(false);
    expect(isFresh('2026-09-23T13:00:00Z', hour, NOW)).toBe(false); // written "in the future": clock skew
  });
});
