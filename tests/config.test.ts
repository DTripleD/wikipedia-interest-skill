import { describe, expect, it } from 'vitest';
import { DEFAULT_CONTACT, TOOL_NAME, TOOL_VERSION, getUserAgent } from '../src/config.js';

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
