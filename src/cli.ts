#!/usr/bin/env node
/**
 * CLI entry point used by the Agent Skill.
 *
 * Contract: every command writes exactly one JSON object to stdout.
 *   success: { "ok": true,  "command": string, "data": ... }
 *   failure: { "ok": false, "command": string, "error": { "code": string, "message": string } }
 * Exit code is 0 on success, 1 on failure.
 *
 * Only the `version` command exists in Stage 1; resolve/fetch/analyze/chart/report are added later.
 */
import { pathToFileURL } from 'node:url';
import { TOOL_NAME, TOOL_VERSION, getUserAgent } from './config.js';

export type CliResult =
  | { ok: true; command: string; data: unknown }
  | { ok: false; command: string; error: { code: string; message: string } };

const COMMANDS = ['version'] as const;

export function run(argv: readonly string[]): CliResult {
  const command = argv[0] ?? '';

  switch (command) {
    case 'version':
      return {
        ok: true,
        command,
        data: { name: TOOL_NAME, version: TOOL_VERSION, userAgent: getUserAgent() },
      };
    default:
      return {
        ok: false,
        command,
        error: {
          code: 'UNKNOWN_COMMAND',
          message: `Unknown command "${command}". Available commands: ${COMMANDS.join(', ')}.`,
        },
      };
  }
}

function main(): void {
  const result = run(process.argv.slice(2));
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  process.exitCode = result.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
