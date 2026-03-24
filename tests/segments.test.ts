import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseValidationConditions,
  discoverSegments,
  getOrDiscoverSegments,
} from '@/segments';
import { KV_KEYS, getConfiguredSegments } from '@/config';
import { MockKV } from './helpers/mock-kv';
import {
  mockEnv,
  CAMPAIGNS_RESPONSE,
  TIERS_RESPONSE,
  VALIDATION_RULE_WITH_METADATA,
  VALIDATION_RULE_NO_METADATA,
} from './helpers/fixtures';

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('parseValidationConditions', () => {
  it('extracts customer.metadata equality checks', () => {
    const result = parseValidationConditions(
      VALIDATION_RULE_WITH_METADATA.rules,
    );
    expect(result).toEqual({ is_member: true });
  });

  it('returns null for non-metadata conditions', () => {
    const result = parseValidationConditions(
      VALIDATION_RULE_NO_METADATA.rules,
    );
    expect(result).toBeNull();
  });

  it('returns null for null/undefined input', () => {
    expect(parseValidationConditions(null)).toBeNull();
    expect(parseValidationConditions(undefined)).toBeNull();
  });

  it('returns null for empty rules', () => {
    expect(parseValidationConditions({ rules: [] })).toBeNull();
  });

  it('handles nested rules', () => {
    const conditions = {
      rules: [
        {
          rules: [
            {
              property: 'customer.metadata.plan',
              comparator: 'is',
              value: 'premium',
            },
          ],
        },
      ],
    };
    const result = parseValidationConditions(conditions);
    expect(result).toEqual({ plan: 'premium' });
  });

  it('handles multiple metadata conditions', () => {
    const conditions = {
      rules: [
        {
          property: 'customer.metadata.is_member',
          comparator: 'is',
          value: true,
        },
        {
          property: 'customer.metadata.plan',
          comparator: 'is',
          value: 'gold',
        },
      ],
    };
    const result = parseValidationConditions(conditions);
    expect(result).toEqual({ is_member: true, plan: 'gold' });
  });

  it('ignores non-equality comparators', () => {
    const conditions = {
      rules: [
        {
          property: 'customer.metadata.age',
          comparator: 'more_than',
          value: 18,
        },
      ],
    };
    expect(parseValidationConditions(conditions)).toBeNull();
  });
});

describe('getConfiguredSegments', () => {
  it('returns defaults when CUSTOM_SEGMENTS not set', () => {
    const segments = getConfiguredSegments({});
    expect(segments).toHaveLength(2);
    expect(segments[0].key).toBe('anonymous');
    expect(segments[1].key).toBe('member');
  });

  it('merges custom segments from env var', () => {
    const custom = [
      { key: 'ad-google', label: 'Google Ads', metadata: { ad_source: 'google' } },
      { key: 'ad-facebook', label: 'Facebook Ads', metadata: { ad_source: 'facebook' } },
    ];
    const segments = getConfiguredSegments({ CUSTOM_SEGMENTS: JSON.stringify(custom) });
    expect(segments).toHaveLength(4);
    expect(segments[2].key).toBe('ad-google');
    expect(segments[2].label).toBe('Google Ads');
    expect(segments[2].customerContext).toEqual({ metadata: { ad_source: 'google' } });
    expect(segments[3].key).toBe('ad-facebook');
  });

  it('handles malformed JSON gracefully', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const segments = getConfiguredSegments({ CUSTOM_SEGMENTS: 'not-json' });
    expect(segments).toHaveLength(2); // only defaults
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to parse CUSTOM_SEGMENTS'));
    warnSpy.mockRestore();
  });
});

describe('discoverSegments', () => {
  it('returns default segments when API fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network'));
    const env = mockEnv();
    const segments = await discoverSegments(env);
    expect(segments).toHaveLength(2);
    expect(segments[0].key).toBe('anonymous');
    expect(segments[1].key).toBe('member');
  });

  it('discovers segments from campaigns', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    spy.mockResolvedValueOnce(
      new Response(JSON.stringify(CAMPAIGNS_RESPONSE)),
    );
    spy.mockResolvedValueOnce(
      new Response(JSON.stringify(TIERS_RESPONSE)),
    );
    spy.mockResolvedValueOnce(
      new Response(JSON.stringify(VALIDATION_RULE_WITH_METADATA)),
    );

    const env = mockEnv();
    const segments = await discoverSegments(env);
    expect(segments.length).toBeGreaterThan(2);
    const discovered = segments.find((s) => s.key === 'is_member:true');
    expect(discovered).toBeDefined();
    expect(discovered!.customerContext.metadata.is_member).toBe(true);
  });

  it('deduplicates segments by key', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    // Two campaigns that produce the same segment
    spy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          campaigns: [
            { id: 'c1', campaign_type: 'PROMOTION' },
            { id: 'c2', campaign_type: 'PROMOTION' },
          ],
        }),
      ),
    );
    // Tiers for c1 and c2 fetched in parallel
    spy.mockResolvedValueOnce(
      new Response(JSON.stringify(TIERS_RESPONSE)),
    );
    spy.mockResolvedValueOnce(
      new Response(JSON.stringify(TIERS_RESPONSE)),
    );
    // Validation rules for both tiers fetched in parallel
    spy.mockResolvedValueOnce(
      new Response(JSON.stringify(VALIDATION_RULE_WITH_METADATA)),
    );
    spy.mockResolvedValueOnce(
      new Response(JSON.stringify(VALIDATION_RULE_WITH_METADATA)),
    );

    const env = mockEnv();
    const segments = await discoverSegments(env);
    const memberSegments = segments.filter((s) => s.key === 'is_member:true');
    expect(memberSegments).toHaveLength(1);
  });

  it('includes configured custom segments in base list', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network'));
    const custom = [{ key: 'ad-google', label: 'Google Ads', metadata: { ad_source: 'google' } }];
    const env = mockEnv({ CUSTOM_SEGMENTS: JSON.stringify(custom) });
    const segments = await discoverSegments(env);
    expect(segments).toHaveLength(3); // anonymous + member + ad-google
    expect(segments[2].key).toBe('ad-google');
  });

  it('skips tiers without validation rules', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    spy.mockResolvedValueOnce(
      new Response(JSON.stringify(CAMPAIGNS_RESPONSE)),
    );
    spy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          tiers: [{ id: 'tier_no_rules', name: 'Open' }],
        }),
      ),
    );

    const env = mockEnv();
    const segments = await discoverSegments(env);
    // Only defaults
    expect(segments).toHaveLength(2);
  });
});

describe('getOrDiscoverSegments', () => {
  it('returns existing segments from KV', async () => {
    const kv = new MockKV();
    const stored = [
      { key: 'test', label: 'Test', customerContext: {} },
    ];
    await kv.put(KV_KEYS.SEGMENTS_REGISTRY, JSON.stringify(stored));
    const env = mockEnv({ PRICING_KV: kv as unknown as KVNamespace });
    const result = await getOrDiscoverSegments(env);
    expect(result).toEqual(stored);
  });

  it('discovers and stores segments when KV is empty', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network'));
    const kv = new MockKV();
    const env = mockEnv({ PRICING_KV: kv as unknown as KVNamespace });
    const result = await getOrDiscoverSegments(env);
    expect(result).toHaveLength(2);
    // Verify stored in KV
    const stored = await kv.get(KV_KEYS.SEGMENTS_REGISTRY, 'json');
    expect(stored).toHaveLength(2);
  });
});
