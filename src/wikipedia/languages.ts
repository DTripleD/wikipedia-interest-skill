/**
 * Wikipedia language editions.
 *
 * An "edition" is the subdomain of `<edition>.wikipedia.org`, which is also what the
 * Pageviews API expects (`<edition>.wikipedia`). Most editions use their language code
 * as the subdomain, but some do not, and interlanguage links (`langlinks`) report the
 * language code, not the subdomain. For example, a Norwegian link says `nb`, but the wiki
 * is `no.wikipedia.org`.
 *
 * The code ≠ subdomain pairs below were taken from Wikimedia's sitematrix on 2026-09-23,
 * plus the legacy alias `be-x-old`. Whether an edition exists is not checked here. The
 * resolver finds that out from the network (DNS lookup of the wiki host).
 */
import { WikimediaApiError } from './http.js';

const CODE_TO_EDITION: Readonly<Record<string, string>> = {
  gsw: 'als',
  lzh: 'zh-classical',
  nan: 'zh-min-nan',
  rup: 'roa-rup',
  sgs: 'bat-smg',
  vro: 'fiu-vro',
  yue: 'zh-yue',
  nb: 'no',
  'be-x-old': 'be-tarask',
};

const LANGUAGE_CODE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/** Normalizes a language code or edition subdomain to the edition subdomain (`nb` → `no`). */
export function toEdition(language: string): string {
  const code = language.trim().toLowerCase();
  if (!LANGUAGE_CODE.test(code) || code.length > 20) {
    throw new WikimediaApiError('INVALID_INPUT', `Invalid Wikipedia language code: "${language}". Use edition codes such as pl, cs, uk or de.`);
  }
  return CODE_TO_EDITION[code] ?? code;
}

/** `pl` → `pl.wikipedia` (the Pageviews API project id). */
export function wikipediaProject(language: string): string {
  return `${toEdition(language)}.wikipedia`;
}

/** Base URL of the MediaWiki Action API for an edition. */
export function actionApiUrl(edition: string): string {
  return `https://${edition}.wikipedia.org/w/api.php`;
}
