import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_CACHE_DIR,
  DEFAULT_CONTACT,
  DEFAULT_ENV_FILE,
  PROJECT_ROOT,
  TOOL_NAME,
  TOOL_VERSION,
  getCacheDir,
  getUserAgent,
  loadDotEnv,
} from '../src/config.js';

describe('getCacheDir', () => {
  it('defaults to .cache at the project root', () => {
    expect(getCacheDir({})).toBe(DEFAULT_CACHE_DIR);
    expect(DEFAULT_CACHE_DIR).toBe(join(PROJECT_ROOT, '.cache'));
  });

  it('resolves a relative WIKI_SKILL_CACHE_DIR against the project root', () => {
    expect(getCacheDir({ WIKI_SKILL_CACHE_DIR: 'tmp/cache' })).toBe(join(PROJECT_ROOT, 'tmp', 'cache'));
  });

  it('keeps an absolute path', () => {
    const abs = join(tmpdir(), 'wiki-cache');
    expect(getCacheDir({ WIKI_SKILL_CACHE_DIR: abs })).toBe(abs);
  });

  it('disables caching when set to an empty value', () => {
    expect(getCacheDir({ WIKI_SKILL_CACHE_DIR: '' })).toBeNull();
    expect(getCacheDir({ WIKI_SKILL_CACHE_DIR: '  ' })).toBeNull();
  });
});

describe('loadDotEnv', () => {
  const KEY = 'WIKI_SKILL_TEST_DOTENV';
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'wiki-skill-env-'));
    delete process.env[KEY];
  });

  afterEach(() => {
    delete process.env[KEY];
    rmSync(dir, { recursive: true, force: true });
  });

  it('loads variables from the file', () => {
    const file = join(dir, '.env');
    writeFileSync(file, `# comment\n${KEY}=me@example.org\n`);
    expect(loadDotEnv(file)).toBe(true);
    expect(process.env[KEY]).toBe('me@example.org');
  });

  it('does not override variables already set in the environment', () => {
    const file = join(dir, '.env');
    writeFileSync(file, `${KEY}=from-file\n`);
    process.env[KEY] = 'from-shell';
    loadDotEnv(file);
    expect(process.env[KEY]).toBe('from-shell');
  });

  it('returns false when the file does not exist', () => {
    expect(loadDotEnv(join(dir, 'missing.env'))).toBe(false);
  });

  it('defaults to .env at the project root', () => {
    expect(DEFAULT_ENV_FILE.href).toBe(new URL('../.env', import.meta.url).href);
  });
});

describe('getUserAgent', () => {
  it('uses WIKI_SKILL_CONTACT when set', () => {
    expect(getUserAgent({ WIKI_SKILL_CONTACT: 'me@example.org' })).toBe(
      `${TOOL_NAME}/${TOOL_VERSION} (me@example.org)`,
    );
  });

  it('falls back to the default contact when unset or blank', () => {
    expect(getUserAgent({})).toContain(DEFAULT_CONTACT);
    expect(getUserAgent({ WIKI_SKILL_CONTACT: '   ' })).toContain(DEFAULT_CONTACT);
  });
});
