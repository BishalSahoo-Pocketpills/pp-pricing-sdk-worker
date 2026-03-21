import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  handlePrices,
  handleOffers,
  handleValidate,
  handleQualify,
  handleSegments,
  handleHealth,
} from '../src/api';
import { MockKV } from './helpers/mock-kv';
import { mockEnv } from './helpers/fixtures';
import type { PricingEntry, OffersBundle } from '../src/types';

function makeRequest(
  url: string,
  method = 'GET',
  body?: any,
  origin = 'https://example.com',
): Request {
  const init: RequestInit = {
    method,
    headers: { Origin: origin },
  };
  if (body) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)['Content-Type'] =
      'application/json';
  }
  return new Request(url, init);
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('handlePrices', () => {
  it('returns 400 when products param is missing', async () => {
    const env = mockEnv();
    const req = makeRequest('https://worker.test/api/prices/anonymous');
    const res = await handlePrices(req, env, 'anonymous');
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('Missing products');
  });

  it('returns cached pricing for known products', async () => {
    const kv = new MockKV();
    const pricing: Record<string, PricingEntry> = {
      'prod-1': {
        basePrice: 100,
        discountedPrice: 75,
        discountAmount: 25,
        discountLabel: '25% OFF',
        discountType: 'PERCENT',
        applicableVouchers: ['promo_1'],
        campaignName: 'Sale',
      },
    };
    await kv.put('prices:anonymous', JSON.stringify(pricing));
    const env = mockEnv({ PRICING_KV: kv as unknown as KVNamespace });
    const req = makeRequest(
      'https://worker.test/api/prices/anonymous?products=prod-1&basePrices=100',
    );
    const res = await handlePrices(req, env, 'anonymous');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.segment).toBe('anonymous');
    expect(data.products['prod-1'].discountedPrice).toBe(75);
  });

  it('returns base prices for unknown segment', async () => {
    const env = mockEnv();
    const req = makeRequest(
      'https://worker.test/api/prices/unknown?products=prod-1&basePrices=60',
    );
    const res = await handlePrices(req, env, 'unknown');
    const data = await res.json();
    expect(data.products['prod-1'].basePrice).toBe(60);
    expect(data.products['prod-1'].discountedPrice).toBe(60);
    expect(data.products['prod-1'].discountType).toBe('NONE');
  });

  it('registers unknown products in catalog', async () => {
    const kv = new MockKV();
    const env = mockEnv({ PRICING_KV: kv as unknown as KVNamespace });
    const req = makeRequest(
      'https://worker.test/api/prices/anonymous?products=new-prod&basePrices=45',
    );
    await handlePrices(req, env, 'anonymous');

    // Wait for fire-and-forget to settle
    await new Promise((r) => setTimeout(r, 50));

    const catalog = await kv.get('products:catalog', 'json');
    expect(catalog['new-prod'].basePrice).toBe(45);
  });

  it('includes CORS headers', async () => {
    const env = mockEnv();
    const req = makeRequest(
      'https://worker.test/api/prices/anonymous?products=prod-1&basePrices=100',
    );
    const res = await handlePrices(req, env, 'anonymous');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(
      'https://example.com',
    );
  });

  it('handles multiple products', async () => {
    const kv = new MockKV();
    const pricing: Record<string, PricingEntry> = {
      'prod-1': {
        basePrice: 100,
        discountedPrice: 75,
        discountAmount: 25,
        discountLabel: '25% OFF',
        discountType: 'PERCENT',
        applicableVouchers: [],
      },
    };
    await kv.put('prices:anonymous', JSON.stringify(pricing));
    const env = mockEnv({ PRICING_KV: kv as unknown as KVNamespace });
    const req = makeRequest(
      'https://worker.test/api/prices/anonymous?products=prod-1,prod-2&basePrices=100,50',
    );
    const res = await handlePrices(req, env, 'anonymous');
    const data = await res.json();
    expect(data.products['prod-1'].discountedPrice).toBe(75); // cached
    expect(data.products['prod-2'].discountedPrice).toBe(50); // base price fallback
  });

  it('sets cache headers on success', async () => {
    const env = mockEnv();
    const req = makeRequest(
      'https://worker.test/api/prices/anonymous?products=prod-1&basePrices=100',
    );
    const res = await handlePrices(req, env, 'anonymous');
    expect(res.headers.get('Cache-Control')).toContain('max-age=60');
  });

  it('does not register products with zero base price', async () => {
    const kv = new MockKV();
    const env = mockEnv({ PRICING_KV: kv as unknown as KVNamespace });
    const req = makeRequest(
      'https://worker.test/api/prices/anonymous?products=prod-1&basePrices=0',
    );
    await handlePrices(req, env, 'anonymous');
    await new Promise((r) => setTimeout(r, 50));
    const catalog = await kv.get('products:catalog', 'json');
    expect(catalog).toBeNull();
  });
});

describe('handleValidate', () => {
  it('proxies to Voucherify validations', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ valid: true, code: 'TEST' })),
    );
    const env = mockEnv();
    const req = makeRequest('https://worker.test/api/validate', 'POST', {
      code: 'SUMMER2025',
    });
    const res = await handleValidate(req, env);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.valid).toBe(true);
  });

  it('sanitizes voucher code', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ valid: false })),
    );
    const env = mockEnv();
    const req = makeRequest('https://worker.test/api/validate', 'POST', {
      code: '<script>XSS</script>',
    });
    await handleValidate(req, env);
    const call = spy.mock.calls[0];
    const body = JSON.parse(call[1]!.body as string);
    expect(body.redeemables[0].id).not.toContain('<');
  });

  it('returns 400 for invalid JSON', async () => {
    const env = mockEnv();
    const req = new Request('https://worker.test/api/validate', {
      method: 'POST',
      body: 'not-json',
      headers: { Origin: 'https://example.com' },
    });
    const res = await handleValidate(req, env);
    expect(res.status).toBe(400);
  });

  it('returns 502 when Voucherify fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new Error('API timeout'),
    );
    const env = mockEnv();
    const req = makeRequest('https://worker.test/api/validate', 'POST', {
      code: 'TEST',
    });
    const res = await handleValidate(req, env);
    expect(res.status).toBe(502);
  });
});

describe('handleQualify', () => {
  it('proxies to Voucherify qualifications', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ redeemables: { data: [] }, total: 0 }),
      ),
    );
    const env = mockEnv();
    const req = makeRequest('https://worker.test/api/qualify', 'POST', {
      scenario: 'ALL',
    });
    const res = await handleQualify(req, env);
    expect(res.status).toBe(200);
  });

  it('returns 400 for invalid JSON', async () => {
    const env = mockEnv();
    const req = new Request('https://worker.test/api/qualify', {
      method: 'POST',
      body: 'bad',
      headers: { Origin: 'https://example.com' },
    });
    const res = await handleQualify(req, env);
    expect(res.status).toBe(400);
  });

  it('returns 502 on upstream failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Down'));
    const env = mockEnv();
    const req = makeRequest('https://worker.test/api/qualify', 'POST', {});
    const res = await handleQualify(req, env);
    expect(res.status).toBe(502);
  });
});

describe('handleSegments', () => {
  it('returns segment registry from KV', async () => {
    const kv = new MockKV();
    const segments = [{ key: 'test', label: 'Test', customerContext: {} }];
    await kv.put('segments:registry', JSON.stringify(segments));
    const env = mockEnv({ PRICING_KV: kv as unknown as KVNamespace });
    const req = makeRequest('https://worker.test/api/segments');
    const res = await handleSegments(req, env);
    const data = await res.json();
    expect(data).toEqual(segments);
  });

  it('returns empty array when no segments exist', async () => {
    const env = mockEnv();
    const req = makeRequest('https://worker.test/api/segments');
    const res = await handleSegments(req, env);
    const data = await res.json();
    expect(data).toEqual([]);
  });
});

describe('handleHealth', () => {
  it('returns health status', async () => {
    const kv = new MockKV();
    await kv.put('meta:last-revalidation', '2025-01-01T00:00:00Z');
    await kv.put(
      'segments:registry',
      JSON.stringify([{ key: 'a', label: 'A', customerContext: {} }]),
    );
    const env = mockEnv({ PRICING_KV: kv as unknown as KVNamespace });
    const req = makeRequest('https://worker.test/health');
    const res = await handleHealth(req, env);
    const data = await res.json();
    expect(data.status).toBe('ok');
    expect(data.lastRevalidation).toBe('2025-01-01T00:00:00Z');
    expect(data.segmentCount).toBe(1);
  });

  it('returns null lastRevalidation when never revalidated', async () => {
    const env = mockEnv();
    const req = makeRequest('https://worker.test/health');
    const res = await handleHealth(req, env);
    const data = await res.json();
    expect(data.lastRevalidation).toBeNull();
  });
});

describe('handleOffers', () => {
  it('returns 400 when segment is empty', async () => {
    const env = mockEnv();
    const req = makeRequest('https://worker.test/api/offers/');
    const res = await handleOffers(req, env, '');
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('Missing segment');
  });

  it('returns cached offers for segment', async () => {
    const kv = new MockKV();
    const offers: OffersBundle = {
      coupons: [
        {
          id: 'coupon_1',
          category: 'coupon',
          title: 'Summer Sale',
          description: 'Save 25%',
          code: 'SAVE25',
          discount: {
            type: 'PERCENT',
            percentOff: 25,
            label: '25% OFF',
          },
          applicableProductIds: [],
        },
      ],
      promotions: [],
      loyalty: [],
      referrals: [],
      gifts: [],
    };
    await kv.put('offers:anonymous', JSON.stringify(offers));
    const env = mockEnv({ PRICING_KV: kv as unknown as KVNamespace });
    const req = makeRequest('https://worker.test/api/offers/anonymous');
    const res = await handleOffers(req, env, 'anonymous');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.segment).toBe('anonymous');
    expect(data.offers.coupons.length).toBe(1);
    expect(data.offers.coupons[0].code).toBe('SAVE25');
  });

  it('returns empty bundle for unknown segment', async () => {
    const env = mockEnv();
    const req = makeRequest('https://worker.test/api/offers/unknown');
    const res = await handleOffers(req, env, 'unknown');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.offers.coupons).toEqual([]);
    expect(data.offers.promotions).toEqual([]);
    expect(data.offers.loyalty).toEqual([]);
    expect(data.offers.referrals).toEqual([]);
    expect(data.offers.gifts).toEqual([]);
  });
});
