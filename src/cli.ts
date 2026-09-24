#!/usr/bin/env node
/**
 * CLI entry point used by the Agent Skill.
 *
 * Contract: every command writes exactly one JSON object (one line) to stdout.
 *   success: { "ok": true,  "command": string, "data": ... }
 *   failure: { "ok": false, "command": string, "error": { "code": string, "message": string, "details"?: object } }
 * Exit code is 0 on success, 1 on failure.
 *
 * Commands: version, resolve, analyze, report. Run `help` for the options.
 */
import { pathToFileURL } from 'node:url';
import { CliError } from './commands/args.js';
import { analyzeCommand, reportCommand, resolveCommand } from './commands/commands.js';
import type { CliDeps } from './commands/pipeline.js';
import { TOOL_NAME, TOOL_VERSION, getUserAgent, loadDotEnv } from './config.js';
import { WikimediaApiError } from './wikipedia/http.js';

export type CliResult =
  | { ok: true; command: string; data: unknown }
  | { ok: false; command: string; error: { code: string; message: string; details?: Record<string, unknown> } };

const HELP = {
  usage: 'wiki-interest <command> [options]',
  commands: {
    resolve: 'Match a topic to Wikipedia articles per language. Options: --topic, --languages, [--source en] [--title lang=Title ...] [--no-cache]',
    analyze:
      'Resolve, fetch and analyze pageviews; returns metrics, confidence, findings. Options: resolve options + [--months 24 | --start YYYY-MM-DD] [--end YYYY-MM-DD] [--charts] [--out DIR]',
    report: 'Same as analyze, plus a one-page PDF report. Options: analyze options + [--note "short analyst note, max 600 chars"]',
    version: 'Tool name, version and User-Agent.',
  },
} as const;

const COMMANDS = ['resolve', 'analyze', 'report', 'version', 'help'] as const;

export async function run(argv: readonly string[], deps: CliDeps = {}): Promise<CliResult> {
  const command = argv[0] ?? '';
  const rest = argv.slice(1);
  try {
    switch (command) {
      case 'version':
        return { ok: true, command, data: { name: TOOL_NAME, version: TOOL_VERSION, userAgent: getUserAgent(deps.env) } };
      case 'help':
        return { ok: true, command, data: HELP };
      case 'resolve':
        return { ok: true, command, data: await resolveCommand(rest, deps) };
      case 'analyze':
        return { ok: true, command, data: await analyzeCommand(rest, deps) };
      case 'report':
        return { ok: true, command, data: await reportCommand(rest, deps) };
      default:
        return {
          ok: false,
          command,
          error: { code: 'UNKNOWN_COMMAND', message: `Unknown command "${command}". Available commands: ${COMMANDS.join(', ')}.` },
        };
    }
  } catch (error) {
    return { ok: false, command, error: toError(error) };
  }
}

function toError(error: unknown): { code: string; message: string; details?: Record<string, unknown> } {
  if (error instanceof CliError) return { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) };
  // Wikimedia codes (RATE_LIMITED, TIMEOUT, ...); INVALID_INPUT means our arguments were rejected.
  if (error instanceof WikimediaApiError) return { code: error.code === 'INVALID_INPUT' ? 'INVALID_ARGUMENT' : error.code, message: error.message };
  if (error instanceof RangeError) return { code: 'INVALID_ARGUMENT', message: error.message };
  return { code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : String(error) };
}

async function main(): Promise<void> {
  loadDotEnv();
  const result = await run(process.argv.slice(2));
  process.stdout.write(JSON.stringify(result) + '\n');
  process.exitCode = result.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
