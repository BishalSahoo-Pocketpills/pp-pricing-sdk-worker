import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleWebhook, processWebhook, revalidateAllSegments } from '@/webhook';
import { KV_KEYS } from '@/config';
import { MockKV } from './helpers/mock-kv';
import { mockEnv, WEBHOOK_PAYLOAD_CAMPAIGN, WEBHOOK_PAYLOAD_IRRELEVANT } from './helpers/fixtures';

const encoder = new TextEncoder();

async function sign(body: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  return [...new Uint8Array(mac)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function makeCtx(): ExecutionContext {
  return {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
  } as unknown as ExecutionContext;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('handleWebhook', () => {
  it('returns 401 for invalid signature', async () => {
    const body = JSON.stringify(WEBHOOK_PAYLOAD_CAMPAIGN);
    const req = new Request('https://worker.test/webhook', {
      method: 'POST',
      body,
      headers: { 'x-voucherify-signature': 'bad-sig' },
    });
    const env = mockEnv();
    const ctx = makeCtx();
    const res = await handleWebhook(req, env, ctx);
    expect(res.status).toBe(401);
    expect(ctx.waitUntil).not.toHaveBeenCalled();
  });

  it('returns 200 and processes in background for valid signature', async () => {
    const body = JSON.stringify(WEBHOOK_PAYLOAD_CAMPAIGN);
    const sig = await sign(body, 'test-webhook-secret');
    const req = new Request('https://worker.test/webhook', {
      method: 'POST',
      body,
      headers: { 'x-voucherify-signature': sig },
    });
    const env = mockEnv();
    const ctx = makeCtx();
    const res = await handleWebhook(req, env, ctx);
    expect(res.status).toBe(200);
    expect(ctx.waitUntil).toHaveBeenCalledTimes(1);
  });

  it('returns 400 for invalid JSON', async () => {
    const body = 'not-json';
    const sig = await sign(body, 'test-webhook-secret');
    const req = new Request('https://worker.test/webhook', {
      method: 'POST',
      body,
      headers: { 'x-voucherify-signature': sig },
    });
    const env = mockEnv();
    const ctx = makeCtx();
    const res = await handleWebhook(req, env, ctx);
    expect(res.status).toBe(400);
  });
});

describe('processWebhook', () => {
  it('increments webhook counter', async () => {
    const kv = new MockKV();
    const env = mockEnv({ PRICING_KV: kv as unknown as KVNamespace });
    // Mock fetch for discoverSegments
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network'));

    await processWebhook('campaign.updated', env);

    const count = await kv.get(KV_KEYS.META_WEBHOOK_COUNT);
    expect(count).toBe('1');
  });

  it('skips irrelevant events', async () => {
    const kv = new MockKV();
    const env = mockEnv({ PRICING_KV: kv as unknown as KVNamespace });
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network'));

    await processWebhook('customer.created', env);

    // Should increment counter but not set revalidation timestamp
    const count = await kv.get(KV_KEYS.META_WEBHOOK_COUNT);
    expect(count).toBe('1');
    const lastRevalidation = await kv.get(KV_KEYS.META_LAST_REVALIDATION);
    expect(lastRevalidation).toBeNull();
  });

  it('processes pricing events', async () => {
    const kv = new MockKV();
    // Seed product catalog
    await kv.put(
      KV_KEYS.PRODUCTS_CATALOG,
      JSON.stringify({ 'prod-1': { basePrice: 100, lastSeen: 1000 } }),
    );
    const env = mockEnv({ PRICING_KV: kv as unknown as KVNamespace });

    // Mock fetch for discoverSegments (fail) and qualifications (succeed)
    const spy = vi.spyOn(globalThis, 'fetch');
    // discoverSegments — listCampaigns call fails
    spy.mockRejectedValueOnce(new Error('Network'));
    // qualifications for anonymous
    spy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          redeemables: { data: [] },
        }),
      ),
    );
    // qualifications for member
    spy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          redeemables: { data: [] },
        }),
      ),
    );

    await processWebhook('campaign.updated', env);

    const lastRevalidation = await kv.get(KV_KEYS.META_LAST_REVALIDATION);
    expect(lastRevalidation).toBeTruthy();
  });
});

describe('revalidateAllSegments', () => {
  it('skips when product catalog is empty', async () => {
    const kv = new MockKV();
    const env = mockEnv({ PRICING_KV: kv as unknown as KVNamespace });
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await revalidateAllSegments(env);

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Product catalog is empty'),
    );
    const lastRevalidation = await kv.get(KV_KEYS.META_LAST_REVALIDATION);
    expect(lastRevalidation).toBeNull();
  });

  it('writes pricing matrix per segment', async () => {
    const kv = new MockKV();
    await kv.put(
      KV_KEYS.PRODUCTS_CATALOG,
      JSON.stringify({ 'prod-1': { basePrice: 60, lastSeen: 1000 } }),
    );
    const env = mockEnv({ PRICING_KV: kv as unknown as KVNamespace });

    const spy = vi.spyOn(globalThis, 'fetch');
    // discoverSegments — listCampaigns returns 404 (no retry on 4xx)
    spy.mockResolvedValueOnce(new Response('Not Found', { status: 404 }));
    // qualifications for anonymous
    spy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          redeemables: {
            data: [
              {
                id: 'promo_1',
                object: 'promotion_tier',
                result: {
                  discount: { type: 'PERCENT', percent_off: 10 },
                },
              },
            ],
          },
        }),
      ),
    );
    // qualifications for member
    spy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          redeemables: {
            data: [
              {
                id: 'promo_2',
                object: 'promotion_tier',
                result: {
                  discount: { type: 'PERCENT', percent_off: 20 },
                },
              },
            ],
          },
        }),
      ),
    );

    await revalidateAllSegments(env);

    const anonPricing = await kv.get(KV_KEYS.PRICES + 'anonymous', 'json');
    expect(anonPricing['prod-1'].discountedPrice).toBe(54); // 60 - 10% = 54
    const memberPricing = await kv.get(KV_KEYS.PRICES + 'member', 'json');
    expect(memberPricing['prod-1'].discountedPrice).toBe(48); // 60 - 20% = 48
  });

  it('writes offers bundle alongside pricing matrix', async () => {
    const kv = new MockKV();
    await kv.put(
      KV_KEYS.PRODUCTS_CATALOG,
      JSON.stringify({ 'prod-1': { basePrice: 60, lastSeen: 1000 } }),
    );
    const env = mockEnv({ PRICING_KV: kv as unknown as KVNamespace });

    const spy = vi.spyOn(globalThis, 'fetch');
    spy.mockResolvedValueOnce(new Response('Not Found', { status: 404 }));
    // anonymous qualifications with a promotion + coupon voucher
    spy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          redeemables: {
            data: [
              {
                id: 'promo_1',
                object: 'promotion_tier',
                result: { discount: { type: 'PERCENT', percent_off: 10 } },
                campaign_name: 'Promo',
              },
              {
                id: 'voucher_1',
                object: 'voucher',
                campaign_type: 'DISCOUNT_COUPONS',
                voucher: { code: 'SAVE10' },
                result: { discount: { type: 'AMOUNT', amount_off: 1000 } },
                campaign_name: 'Coupon Campaign',
              },
            ],
          },
        }),
      ),
    );
    // member qualifications
    spy.mockResolvedValueOnce(
      new Response(JSON.stringify({ redeemables: { data: [] } })),
    );

    await revalidateAllSegments(env);

    const offers = await kv.get(KV_KEYS.OFFERS + 'anonymous', 'json');
    expect(offers).toBeTruthy();
    expect(offers.promotions.length).toBe(1);
    expect(offers.promotions[0].id).toBe('promo_1');
    expect(offers.coupons.length).toBe(1);
    expect(offers.coupons[0].code).toBe('SAVE10');

    // member offers should be empty
    const memberOffers = await kv.get(KV_KEYS.OFFERS + 'member', 'json');
    expect(memberOffers).toBeTruthy();
    expect(memberOffers.coupons).toEqual([]);
  });

  it('calls performCMSSync when CMS_SYNC_ENABLED is true', async () => {
    const kv = new MockKV();
    await kv.put(
      KV_KEYS.PRODUCTS_CATALOG,
      JSON.stringify({ 'prod-1': { basePrice: 60, lastSeen: 1000 } }),
    );
    const env = mockEnv({ PRICING_KV: kv as unknown as KVNamespace, CMS_SYNC_ENABLED: 'true' });

    const spy = vi.spyOn(globalThis, 'fetch');
    spy.mockResolvedValueOnce(new Response('Not Found', { status: 404 }));
    // anonymous qualifications
    spy.mockResolvedValueOnce(
      new Response(JSON.stringify({ redeemables: { data: [] } })),
    );
    // member qualifications
    spy.mockResolvedValueOnce(
      new Response(JSON.stringify({ redeemables: { data: [] } })),
    );

    // Mock performCMSSync (which internally calls syncPricingToCMS + syncOffersToCMS)
    const cms = await import('@/cms');
    const performSyncSpy = vi.spyOn(cms, 'performCMSSync').mockResolvedValue({
      pricing: { created: 0, updated: 0, published: 0, errors: [] },
      offers: { created: 0, updated: 0, published: 0, errors: [] },
    });

    await revalidateAllSegments(env);

    expect(performSyncSpy).toHaveBeenCalledWith(env);

    performSyncSpy.mockRestore();
  });

  it('handles qualification failure for individual segments', async () => {
    const kv = new MockKV();
    await kv.put(
      KV_KEYS.PRODUCTS_CATALOG,
      JSON.stringify({ 'prod-1': { basePrice: 100, lastSeen: 1000 } }),
    );
    const env = mockEnv({ PRICING_KV: kv as unknown as KVNamespace });

    const spy = vi.spyOn(globalThis, 'fetch');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // discoverSegments — 404 (no retry on 4xx)
    spy.mockResolvedValueOnce(new Response('Not Found', { status: 404 }));
    // anonymous qualifications fail — 400 (no retry)
    spy.mockResolvedValueOnce(new Response('Bad Request', { status: 400 }));
    // member qualifications succeed
    spy.mockResolvedValueOnce(
      new Response(JSON.stringify({ redeemables: { data: [] } })),
    );

    await revalidateAllSegments(env);

    // anonymous pricing should not exist (failed)
    const anonPricing = await kv.get(KV_KEYS.PRICES + 'anonymous', 'json');
    expect(anonPricing).toBeNull();
    // member pricing should exist
    const memberPricing = await kv.get(KV_KEYS.PRICES + 'member', 'json');
    expect(memberPricing).toBeTruthy();
  });
});
