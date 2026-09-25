/**
 * The resolve / analyze / report commands. Each returns the `data` of a success envelope or
 * throws (CliError, WikimediaApiError, RangeError), which cli.ts maps to an error envelope.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve as resolvePath } from 'node:path';
import { CONFIDENCE_THRESHOLDS } from '../analysis/confidence.js';
import { renderSvg } from '../charts/render.js';
import { PROJECT_ROOT } from '../config.js';
import { addDays } from '../dates.js';
import { buildReportModel, type ReportModel } from '../reports/content.js';
import { renderReportPdf } from '../reports/pdf.js';
import { parseAnalysisArgs, parseReportArgs, parseResolveArgs, type AnalysisArgs } from './args.js';
import { analyze, makeContext, resolve, type Analysis, type CliDeps, type Context } from './pipeline.js';
import { presentAnalysis, presentResolve } from './present.js';

export const DEFAULT_OUT_DIR = join(PROJECT_ROOT, 'output');

export async function resolveCommand(argv: readonly string[], deps: CliDeps) {
  const args = parseResolveArgs(argv);
  const ctx = makeContext(deps, args.noCache);
  const result = await resolve(ctx, args);
  return { ...presentResolve(result), ...footer(ctx, []) };
}

export async function analyzeCommand(argv: readonly string[], deps: CliDeps) {
  const ctx = makeContext(deps, false);
  const args = parseAnalysisArgs(argv, ctx.now);
  if (args.noCache) ctx.http.cache = null;
  const analysis = await analyze(ctx, args);
  const model = reportModel(analysis, args, ctx, null);
  const files = args.charts ? { charts: await writeCharts(model, args, deps) } : {};
  return { ...presentAnalysis(analysis, model), ...(args.charts ? { files } : {}), ...footer(ctx, [...analysisWarnings(analysis), ...model.warnings]) };
}

export async function reportCommand(argv: readonly string[], deps: CliDeps) {
  const ctx = makeContext(deps, false);
  const args = parseReportArgs(argv, ctx.now);
  if (args.noCache) ctx.http.cache = null;
  const analysis = await analyze(ctx, args);
  const model = reportModel(analysis, args, ctx, args.note);
  const svgs = await Promise.all(model.charts.map((c) => renderSvg(c.spec)));
  const { pdf, warnings } = await renderReportPdf(model, svgs, ctx.now);
  const dir = outDir(args, deps);
  await mkdir(dir, { recursive: true });
  const report = join(dir, `${baseName(args)}.pdf`);
  await writeFile(report, pdf);
  const files = { report, ...(args.charts ? { charts: await writeCharts(model, args, deps, svgs) } : {}) };
  return { ...presentAnalysis(analysis, model), files, ...footer(ctx, [...analysisWarnings(analysis), ...model.warnings, ...warnings]) };
}

function reportModel(analysis: Analysis, args: AnalysisArgs, ctx: Context, note: string | null): ReportModel {
  return buildReportModel({
    topic: args.topic,
    comparison: analysis.comparison,
    assessment: analysis.assessment,
    series: analysis.analyzed.map((a) => a.series),
    missing: analysis.missing,
    analystNote: note,
    generatedAt: ctx.now,
  });
}

/**
 * Series and comparison warnings (clamped dates, trimmed days, common period), deduplicated, plus
 * a hint when an article's data start well after the period start (created or renamed later):
 * its early zeros drag down medians, trends and month-by-month rankings.
 */
function analysisWarnings(analysis: Analysis): string[] {
  const all = [...analysis.comparison.warnings, ...analysis.comparison.analyses.flatMap((a) => a.warnings.map((w) => `${a.language}: ${w}`))];
  const late = analysis.comparison.analyses.flatMap((a) => {
    const first = a.coverage.firstReportedDate;
    return first !== null && first > addDays(a.period.start, CONFIDENCE_THRESHOLDS.coverage.lateStartDays) ? [{ language: a.language, first, start: a.period.start }] : [];
  });
  if (late.length > 0) {
    // One date for the whole comparison: the latest start, so every edition has data from day one.
    const latest = late.reduce((max, l) => (l.first > max ? l.first : max), late[0]!.first);
    const which = late.map((l) => `${l.language} on ${l.first}`).join(', ');
    all.push(`Data start later than ${late[0]!.start} for ${which} (the article may have been created or renamed then). For a fair picture, re-run with --start ${latest}.`);
  }
  return [...new Set(all)];
}

async function writeCharts(model: ReportModel, args: AnalysisArgs, deps: CliDeps, svgs?: readonly string[]): Promise<string[]> {
  const dir = outDir(args, deps);
  await mkdir(dir, { recursive: true });
  const paths: string[] = [];
  for (const [i, chart] of model.charts.entries()) {
    const path = join(dir, `${baseName(args)}-${chart.id}.svg`);
    await writeFile(path, svgs?.[i] ?? (await renderSvg(chart.spec)), 'utf8');
    paths.push(path);
  }
  return paths;
}

function outDir(args: AnalysisArgs, deps: CliDeps): string {
  return args.out ? resolvePath(args.out) : (deps.outDir ?? DEFAULT_OUT_DIR);
}

/** e.g. "intermittent-fasting_cs-pl_2024-09-23_2026-09-22". */
export function baseName(args: Pick<AnalysisArgs, 'topic' | 'languages' | 'start' | 'end'>): string {
  const slug =
    args.topic
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'topic';
  const langs = [...args.languages].sort().join('-').replace(/[^a-z0-9-]/gi, '');
  return `${slug}_${langs}_${args.start}_${args.end}`;
}

function footer(ctx: Context, warnings: string[]) {
  const all = [...ctx.warnings, ...warnings];
  return { ...(all.length ? { warnings: all } : {}), apiRequests: ctx.requests(), cache: ctx.http.cache ? 'on' : 'off' };
}
