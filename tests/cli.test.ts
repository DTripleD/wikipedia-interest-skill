import { describe, expect, it } from 'vitest';
import { run } from '../src/cli.js';
import { TOOL_VERSION } from '../src/config.js';

describe('cli run()', () => {
  it('returns version info as a success envelope', () => {
    const result = run(['version']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toMatchObject({ version: TOOL_VERSION });
    }
  });

  it('returns a structured error for unknown commands', () => {
    const result = run(['nope']);
    expect(result).toMatchObject({ ok: false, error: { code: 'UNKNOWN_COMMAND' } });
  });

  it('returns a structured error when no command is given', () => {
    expect(run([])).toMatchObject({ ok: false, error: { code: 'UNKNOWN_COMMAND' } });
  });
});
