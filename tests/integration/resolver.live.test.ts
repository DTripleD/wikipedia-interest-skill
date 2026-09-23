/**
 * Live resolver tests against the real MediaWiki Action API (run: npm run test:integration).
 * They cover the assignment scenarios and use few requests (~8 in total) to stay polite.
 * Wikipedia content can change; the assertions target long-stable facts (Wikidata items).
 */
import { describe, expect, it } from 'vitest';
import { resolveTopic } from '../../src/wikipedia/resolver.js';

const options = { timeoutMs: 20_000, maxRetries: 2 };

describe('resolveTopic (live)', () => {
  it('scenario 1: intermittent fasting in pl and cs', async () => {
    const result = await resolveTopic({ topic: 'intermittent fasting', languages: ['pl', 'cs'] }, options);
    expect(result.source).toMatchObject({ status: 'found', article: 'Intermittent fasting', wikidataId: 'Q1666254' });

    const [pl, cs] = result.results;
    expect(cs).toMatchObject({ status: 'resolved', article: 'Přerušovaný půst', wikidataId: 'Q1666254', method: 'interlanguage_link' });
    // As of 2026-09-23 pl.wikipedia has no article for this concept. If one is created,
    // it must still be the same Wikidata item.
    if (pl!.status === 'resolved') expect(pl!.wikidataId).toBe('Q1666254');
    else expect(pl!.status).toBe('not_found');
  });

  it('scenario 2: astronomy in uk', async () => {
    const result = await resolveTopic({ topic: 'astronomy', languages: ['uk'] }, options);
    expect(result.results[0]).toMatchObject({ status: 'resolved', article: 'Астрономія', wikidataId: 'Q333', confidence: 'high' });
  });

  it('scenario 3: "learning English" is ambiguous and offers the ESL article as a candidate', async () => {
    const result = await resolveTopic({ topic: 'learning English', languages: ['de'] }, options);
    expect(result.source.status).toBe('ambiguous');
    expect(result.source.candidates.map((c) => c.wikidataId)).toContain('Q130192');
    expect(result.results[0]!.status).toBe('ambiguous');
  });

  it('reports a nonexistent language edition', async () => {
    const result = await resolveTopic({ topic: 'Astronomy', languages: ['xx'] }, options);
    expect(result.results[0]!.status).toBe('language_unavailable');
  });
});
