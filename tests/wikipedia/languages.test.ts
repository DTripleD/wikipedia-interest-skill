import { describe, expect, it } from 'vitest';
import { WikimediaApiError } from '../../src/wikipedia/http.js';
import { actionApiUrl, toEdition, wikipediaProject } from '../../src/wikipedia/languages.js';

describe('toEdition', () => {
  it('passes through normal codes, normalizing case and whitespace', () => {
    expect(toEdition('pl')).toBe('pl');
    expect(toEdition(' UK ')).toBe('uk');
    expect(toEdition('simple')).toBe('simple');
  });

  it('maps language codes whose edition subdomain differs', () => {
    expect(toEdition('nb')).toBe('no');
    expect(toEdition('gsw')).toBe('als');
    expect(toEdition('nan')).toBe('zh-min-nan');
    expect(toEdition('yue')).toBe('zh-yue');
    expect(toEdition('be-x-old')).toBe('be-tarask');
    expect(toEdition('zh-min-nan')).toBe('zh-min-nan');
  });

  it('rejects malformed codes', () => {
    for (const bad of ['', 'p l', 'pl.wikipedia', '-pl', 'pl_PL', 'a'.repeat(21)]) {
      expect(() => toEdition(bad), bad).toThrow(WikimediaApiError);
    }
  });
});

describe('URL helpers', () => {
  it('builds project ids and Action API URLs', () => {
    expect(wikipediaProject('nb')).toBe('no.wikipedia');
    expect(actionApiUrl('uk')).toBe('https://uk.wikipedia.org/w/api.php');
  });
});
