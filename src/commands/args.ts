/**
 * Command-line arguments (node:util parseArgs, strict). Every problem becomes a CliError with
 * code INVALID_ARGUMENT and a message that says how to fix the call.
 */
import { parseArgs, type ParseArgsConfig } from 'node:util';
import { addDays, isIsoDate, todayUtc } from '../dates.js';

export const DEFAULT_MONTHS = 24;
export const MAX_MONTHS = 120;

export class CliError extends Error {
  override readonly name = 'CliError';
  constructor(
    readonly code: string,
    message: string,
    /** Structured extras for the agent, e.g. candidate titles. */
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export interface TopicArgs {
  topic: string;
  languages: string[];
  sourceLanguage: string;
  /** Explicit titles per language from --title lang=Title. */
  titles: Record<string, string>;
  noCache: boolean;
}

export interface AnalysisArgs extends TopicArgs {
  start: string;
  end: string;
  charts: boolean;
  out: string | null;
}

export interface ReportArgs extends AnalysisArgs {
  note: string | null;
}

const TOPIC_OPTIONS = {
  topic: { type: 'string' },
  languages: { type: 'string' },
  source: { type: 'string' },
  title: { type: 'string', multiple: true },
  'no-cache': { type: 'boolean' },
} as const;

const ANALYSIS_OPTIONS = {
  ...TOPIC_OPTIONS,
  start: { type: 'string' },
  end: { type: 'string' },
  months: { type: 'string' },
  charts: { type: 'boolean' },
  out: { type: 'string' },
} as const;

/** All options accepted by the widest command (report); used by the SKILL.md consistency test. */
export const REPORT_OPTIONS = { ...ANALYSIS_OPTIONS, note: { type: 'string' } } as const;

export function parseResolveArgs(argv: readonly string[]): TopicArgs {
  return topicArgs(parse(argv, TOPIC_OPTIONS));
}

export function parseAnalysisArgs(argv: readonly string[], now: Date): AnalysisArgs {
  const values = parse(argv, ANALYSIS_OPTIONS);
  return { ...topicArgs(values), ...period(values, now), charts: values.charts === true, out: stringValue(values.out) };
}

export function parseReportArgs(argv: readonly string[], now: Date): ReportArgs {
  const values = parse(argv, REPORT_OPTIONS);
  return {
    ...topicArgs(values),
    ...period(values, now),
    charts: values.charts === true,
    out: stringValue(values.out),
    note: stringValue(values.note),
  };
}

type Values = Record<string, string | boolean | string[] | undefined>;

function parse(argv: readonly string[], options: NonNullable<ParseArgsConfig['options']>): Values {
  try {
    return parseArgs({ args: [...argv], options, strict: true, allowPositionals: false }).values as Values;
  } catch (error) {
    throw new CliError('INVALID_ARGUMENT', `${(error as Error).message}. Options: ${Object.keys(options).map((o) => `--${o}`).join(' ')}.`);
  }
}

function stringValue(value: Values[string]): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function topicArgs(values: Values): TopicArgs {
  const topic = stringValue(values.topic);
  if (topic === null) throw new CliError('INVALID_ARGUMENT', 'Missing --topic, e.g. --topic "intermittent fasting" (in the source language, English by default).');
  const languages = (stringValue(values.languages) ?? '')
    .split(',')
    .map((l) => l.trim())
    .filter((l) => l !== '');
  if (languages.length === 0) throw new CliError('INVALID_ARGUMENT', 'Missing --languages, e.g. --languages pl,cs (Wikipedia language codes, comma-separated).');

  const titles: Record<string, string> = {};
  for (const entry of (values.title as string[] | undefined) ?? []) {
    const eq = entry.indexOf('=');
    const lang = eq > 0 ? entry.slice(0, eq).trim() : '';
    const title = eq > 0 ? entry.slice(eq + 1).trim() : '';
    if (lang === '' || title === '') throw new CliError('INVALID_ARGUMENT', `Invalid --title "${entry}". Use --title <language>=<article title>, e.g. --title pl=Post.`);
    titles[lang] = title;
  }
  return { topic, languages, sourceLanguage: stringValue(values.source) ?? 'en', titles, noCache: values['no-cache'] === true };
}

/**
 * --start/--end (ISO dates, inclusive), or --months N back from --end. The end defaults to
 * yesterday (UTC), the last day the Pageviews API can have; the fetch layer trims days not
 * published yet.
 */
function period(values: Values, now: Date): { start: string; end: string } {
  const startArg = stringValue(values.start);
  const endArg = stringValue(values.end);
  const monthsArg = stringValue(values.months);
  for (const [name, value] of [['--start', startArg], ['--end', endArg]] as const) {
    if (value !== null && !isIsoDate(value)) throw new CliError('INVALID_ARGUMENT', `${name} must be a date in YYYY-MM-DD form, got "${value}".`);
  }
  if (startArg !== null && monthsArg !== null) throw new CliError('INVALID_ARGUMENT', 'Use either --start or --months, not both.');

  const end = endArg ?? addDays(todayUtc(now), -1);
  let start: string;
  if (startArg !== null) {
    start = startArg;
  } else {
    const months = monthsArg === null ? DEFAULT_MONTHS : Number(monthsArg);
    if (!Number.isInteger(months) || months < 1 || months > MAX_MONTHS) {
      throw new CliError('INVALID_ARGUMENT', `--months must be a whole number from 1 to ${MAX_MONTHS}, got "${monthsArg}".`);
    }
    start = monthsBefore(end, months);
  }
  if (start > end) throw new CliError('INVALID_ARGUMENT', `--start ${start} is after --end ${end}.`);
  return { start, end };
}

/** The first day of a window of `months` calendar months ending on `end`: 2026-09-22, 24 → 2024-09-23. */
function monthsBefore(end: string, months: number): string {
  const [y, m, d] = end.split('-').map(Number) as [number, number, number];
  const shifted = new Date(Date.UTC(y, m - 1 - months, d));
  // Day overflow (31 March minus one month → 3 March): use the last day of the target month.
  const date = shifted.getUTCDate() === d ? shifted : new Date(Date.UTC(y, m - months, 0));
  return addDays(date.toISOString().slice(0, 10), 1);
}
