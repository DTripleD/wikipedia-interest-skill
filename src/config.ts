/**
 * Runtime configuration shared by all modules.
 *
 * Wikimedia's User-Agent policy (https://meta.wikimedia.org/wiki/User-Agent_policy)
 * requires clients to send a descriptive User-Agent that includes contact information.
 * The contact is configurable via the WIKI_SKILL_CONTACT environment variable.
 */

export const TOOL_NAME = 'wikipedia-interest-skill';
export const TOOL_VERSION = '0.1.0';

/** Used when WIKI_SKILL_CONTACT is not set. Operators should set their own contact. */
export const DEFAULT_CONTACT = 'contact-not-configured (set WIKI_SKILL_CONTACT)';

export function getContact(env: NodeJS.ProcessEnv = process.env): string {
  const contact = env['WIKI_SKILL_CONTACT']?.trim();
  return contact ? contact : DEFAULT_CONTACT;
}

export function getUserAgent(env: NodeJS.ProcessEnv = process.env): string {
  return `${TOOL_NAME}/${TOOL_VERSION} (${getContact(env)})`;
}
