/**
 * Shared HTTP layer for all Wikimedia requests: User-Agent, per-attempt timeout,
 * retries with backoff, Retry-After handling and error mapping.
 *
 * Retry policy (see docs/wikimedia-api.md):
 * - 429 / 503: wait Retry-After if present; otherwise backoff (429: at least 5 s).
 * - other 5xx, timeouts, transient network errors: exponential backoff.
 * - DNS "host not found" and other 4xx: fail immediately.
 * - Retry-After above maxRetryAfterMs: fail immediately rather than block the agent.
 */
import { getUserAgent } from '../config.js';

export type WikimediaErrorCode =
  | 'INVALID_INPUT'
  | 'BAD_REQUEST'
  | 'FORBIDDEN'
  | 'RATE_LIMITED'
  | 'SERVER_ERROR'
  | 'HTTP_ERROR'
  | 'TIMEOUT'
  | 'NETWORK_ERROR'
  | 'HOST_NOT_FOUND'
  | 'INVALID_RESPONSE';

export class WikimediaApiError extends Error {
  override readonly name = 'WikimediaApiError';
  constructor(
    readonly code: WikimediaErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export interface HttpOptions {
  fetch?: typeof fetch;
  userAgent?: string;
  /** Per-attempt timeout. Default 15 000 ms. */
  timeoutMs?: number;
  /** Retries after the first attempt for 429, 5xx, timeouts and network errors. Default 3. */
  maxRetries?: number;
  /** Exponential backoff base: delay = base * 2^retryIndex. Default 1 000 ms. */
  baseDelayMs?: number;
  /** Give up instead of waiting if the server asks for a longer Retry-After. Default 60 000 ms. */
  maxRetryAfterMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
}

export interface RequestSpec {
  /** Human-readable service name used in error messages, e.g. "Pageviews API". */
  service: string;
  /** Non-2xx statuses returned to the caller instead of being treated as errors (e.g. 404). */
  passStatuses?: readonly number[];
}

export const DEFAULT_TIMEOUT_MS = 15_000;

/** Minimum wait after a 429 without Retry-After, per Wikimedia rate-limit guidance. */
const MIN_RATE_LIMIT_DELAY_MS = 5_000;

export async function requestWithRetry(url: string, options: HttpOptions, spec: RequestSpec): Promise<Response> {
  const doFetch = options.fetch ?? globalThis.fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 1_000;
  const maxRetryAfterMs = options.maxRetryAfterMs ?? 60_000;
  const passStatuses = spec.passStatuses ?? [];
  const headers = {
    'User-Agent': options.userAgent ?? getUserAgent(),
    Accept: 'application/json',
  };

  for (let attempt = 0; ; attempt++) {
    const backoff = baseDelayMs * 2 ** attempt;
    const canRetry = attempt < maxRetries;
    let failure: WikimediaApiError;
    let delay = backoff;

    try {
      const response = await doFetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
      if (response.ok || passStatuses.includes(response.status)) return response;

      failure = await httpError(response, spec.service);
      if (response.status === 429 || response.status === 503) {
        const retryAfter = parseRetryAfter(response.headers.get('retry-after'), options.now?.() ?? new Date());
        if (retryAfter !== null && retryAfter > maxRetryAfterMs) {
          throw new WikimediaApiError(
            failure.code,
            `${failure.message} Server asked to retry after ${Math.ceil(retryAfter / 1000)} s; giving up.`,
            response.status,
          );
        }
        delay = retryAfter ?? (response.status === 429 ? Math.max(MIN_RATE_LIMIT_DELAY_MS, backoff) : backoff);
      } else if (response.status < 500) {
        throw failure; // other 4xx: not retryable
      }
    } catch (err) {
      if (err instanceof WikimediaApiError) throw err;
      failure = toTransportError(err, timeoutMs, spec.service, url);
      if (failure.code === 'HOST_NOT_FOUND') throw failure;
    }

    if (!canRetry) throw failure;
    await sleep(delay);
  }
}

/** Reads a JSON body; maps parse failures to INVALID_RESPONSE and body-read timeouts to TIMEOUT. */
export async function readJson(response: Response, options: HttpOptions, service: string): Promise<unknown> {
  try {
    return await response.json();
  } catch (err) {
    // The timeout signal also covers reading the body.
    if (isAbort(err)) throw toTransportError(err, options.timeoutMs ?? DEFAULT_TIMEOUT_MS, service, response.url);
    throw new WikimediaApiError('INVALID_RESPONSE', `${service} returned a body that is not valid JSON.`, response.status);
  }
}

/** Parses Retry-After (delta-seconds or HTTP-date) into milliseconds; null if absent/invalid. */
export function parseRetryAfter(value: string | null, now: Date): number | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return null;
  return Math.max(0, at - now.getTime());
}

async function httpError(response: Response, service: string): Promise<WikimediaApiError> {
  const detail = await readProblemDetail(response);
  const suffix = detail ? `: ${detail}` : '';
  const status = response.status;
  if (status === 400) return new WikimediaApiError('BAD_REQUEST', `${service} rejected the request (400)${suffix}`, status);
  if (status === 403) {
    return new WikimediaApiError('FORBIDDEN', `${service} refused access (403); check the User-Agent/WIKI_SKILL_CONTACT${suffix}`, status);
  }
  if (status === 429) {
    return new WikimediaApiError(
      'RATE_LIMITED',
      `${service} rate limit exceeded (429); setting WIKI_SKILL_CONTACT to a real email or URL raises the limit${suffix}`,
      status,
    );
  }
  if (status >= 500) return new WikimediaApiError('SERVER_ERROR', `${service} server error (${status})${suffix}`, status);
  return new WikimediaApiError('HTTP_ERROR', `${service} returned HTTP ${status}${suffix}`, status);
}

async function readProblemDetail(response: Response): Promise<string | null> {
  try {
    const body: unknown = await response.json();
    if (body && typeof body === 'object' && 'detail' in body && typeof body.detail === 'string') {
      return body.detail;
    }
  } catch {
    // Body is not JSON; the status code alone is reported.
  }
  return null;
}

function isAbort(err: unknown): err is Error {
  return err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
}

function toTransportError(err: unknown, timeoutMs: number, service: string, url: string): WikimediaApiError {
  if (isAbort(err)) {
    return new WikimediaApiError('TIMEOUT', `${service} did not respond within ${timeoutMs} ms.`);
  }
  const cause = err instanceof Error ? (err.cause as { code?: unknown } | undefined) : undefined;
  if (cause?.code === 'ENOTFOUND') {
    const host = safeHost(url);
    return new WikimediaApiError('HOST_NOT_FOUND', `${service}: host ${host} does not exist (DNS lookup failed).`);
  }
  const message = err instanceof Error ? err.message : String(err);
  return new WikimediaApiError('NETWORK_ERROR', `Network error calling ${service}: ${message}`);
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
