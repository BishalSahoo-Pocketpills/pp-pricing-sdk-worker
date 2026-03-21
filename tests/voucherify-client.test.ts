import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fetchQualifications,
  fetchValidations,
  listCampaigns,
  listPromotionTiers,
  getValidationRules,
} from '@/voucherify-client';
import { mockEnv } from './helpers/fixtures';

const env = mockEnv();

beforeEach(() => {
  vi.restoreAllMocks();
});

function mockFetch(response: any, status = 200) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(response), { status }),
  );
}

function mockFetchSequence(responses: Array<{ body: any; status: number }>) {
  const spy = vi.spyOn(globalThis, 'fetch');
  for (const { body, status } of responses) {
    spy.mockResolvedValueOnce(
      new Response(JSON.stringify(body), { status }),
    );
  }
  return spy;
}

describe('fetchQualifications', () => {
  it('posts to qualifications endpoint with auth headers', async () => {
    const spy = mockFetch({ data: [] });
    const body = { customer: {}, order: {} };
    await fetchQualifications(env, body);

    expect(spy).toHaveBeenCalledWith(
      'https://api.voucherify.test/v1/qualifications',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'X-App-Id': 'test-app-id',
          'X-App-Token': 'test-secret-key',
        }),
      }),
    );
  });

  it('returns parsed JSON response', async () => {
    mockFetch({ redeemables: { data: [{ id: 'promo_1' }] } });
    const result = await fetchQualifications(env, {});
    expect(result.redeemables.data[0].id).toBe('promo_1');
  });

  it('throws on 4xx without retrying', async () => {
    const spy = mockFetch({ error: 'Bad Request' }, 400);
    await expect(fetchQualifications(env, {})).rejects.toThrow('API error 400');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('retries on 5xx errors', async () => {
    const spy = mockFetchSequence([
      { body: {}, status: 500 },
      { body: {}, status: 500 },
      { body: { ok: true }, status: 200 },
    ]);
    const result = await fetchQualifications(env, {});
    expect(result.ok).toBe(true);
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('throws after max retries', async () => {
    mockFetchSequence([
      { body: {}, status: 500 },
      { body: {}, status: 500 },
      { body: {}, status: 500 },
      { body: {}, status: 500 },
    ]);
    await expect(fetchQualifications(env, {})).rejects.toThrow();
  });
});

describe('fetchValidations', () => {
  it('posts to validations endpoint', async () => {
    const spy = mockFetch({ valid: true });
    await fetchValidations(env, { code: 'TEST' });
    expect(spy).toHaveBeenCalledWith(
      'https://api.voucherify.test/v1/validations',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});

describe('listCampaigns', () => {
  it('gets campaigns with filters', async () => {
    const spy = mockFetch({ campaigns: [] });
    await listCampaigns(env, { 'filters[active]': 'true' });
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('filters%5Bactive%5D=true'),
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('gets campaigns without filters', async () => {
    const spy = mockFetch({ campaigns: [] });
    await listCampaigns(env);
    expect(spy).toHaveBeenCalledWith(
      'https://api.voucherify.test/v1/campaigns',
      expect.anything(),
    );
  });
});

describe('listPromotionTiers', () => {
  it('gets tiers for campaign', async () => {
    const spy = mockFetch({ tiers: [] });
    await listPromotionTiers(env, 'camp_123');
    expect(spy).toHaveBeenCalledWith(
      'https://api.voucherify.test/v1/promotions/camp_123/tiers',
      expect.anything(),
    );
  });

  it('encodes campaign ID', async () => {
    const spy = mockFetch({ tiers: [] });
    await listPromotionTiers(env, 'camp/special');
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('camp%2Fspecial'),
      expect.anything(),
    );
  });
});

describe('getValidationRules', () => {
  it('gets validation rule by ID', async () => {
    const spy = mockFetch({ id: 'rule_1', rules: {} });
    await getValidationRules(env, 'rule_1');
    expect(spy).toHaveBeenCalledWith(
      'https://api.voucherify.test/v1/validation-rules/rule_1',
      expect.anything(),
    );
  });
});
