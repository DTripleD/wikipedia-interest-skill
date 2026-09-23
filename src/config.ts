/**
 * Runtime configuration shared by all modules.
 *
 * Wikimedia's User-Agent policy (https://meta.wikimedia.org/wiki/User-Agent_policy)
 * requires clients to send a descriptive User-Agent that includes contact information.
 * The contact is configurable via the WIKI_SKILL_CONTACT environment variable,
 * which can also be set in a `.env` file at the project root (see loadDotEnv).
 */
import type { PathLike } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TOOL_NAME = 'wikipedia-interest-skill';
export const TOOL_VERSION = '0.1.0';

/** Used when WIKI_SKILL_CONTACT is not set. Operators should set their own contact. */
export const DEFAULT_CONTACT = 'contact-not-configured (set WIKI_SKILL_CONTACT)';

export function getContact(env: NodeJS.ProcessEnv = process.env): string {
  const contact = env['WIKI_SKILL_CONTACT']?.trim();
  return contact ? contact : DEFAULT_CONTACT;
}

/**
 * Project root, resolved relative to this module. It is the same directory for
 * `src/config.ts` and `dist/config.js`, whatever the current working directory is.
 */
export const PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Project-root `.env`. */
export const DEFAULT_ENV_FILE = new URL('../.env', import.meta.url);

/** Default cache directory (gitignored). */
export const DEFAULT_CACHE_DIR = join(PROJECT_ROOT, '.cache');

/**
 * Cache directory from WIKI_SKILL_CACHE_DIR:
 * - unset → DEFAULT_CACHE_DIR;
 * - empty or blank → null (caching disabled);
 * - relative path → resolved against the project root, not the current directory.
 */
export function getCacheDir(env: NodeJS.ProcessEnv = process.env): string | null {
  const value = env['WIKI_SKILL_CACHE_DIR'];
  if (value === undefined) return DEFAULT_CACHE_DIR;
  const trimmed = value.trim();
  return trimmed ? resolve(PROJECT_ROOT, trimmed) : null;
}

/**
 * Loads `.env` into process.env using Node's native parser (process.loadEnvFile).
 * Variables already set in the environment take precedence over the file.
 * A missing file is not an error. Returns true if a file was loaded.
 */
export function loadDotEnv(path: PathLike = DEFAULT_ENV_FILE): boolean {
  try {
    process.loadEnvFile(path);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}

export function getUserAgent(env: NodeJS.ProcessEnv = process.env): string {
  return `${TOOL_NAME}/${TOOL_VERSION} (${getContact(env)})`;
}
