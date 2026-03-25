import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processWebhook, revalidateAllSegments } from '@/webhook';
import { processPendingCMSSync } from '@/cron';
import { KV_KEYS } from '@/config';
import { MockKV } from './helpers/mock-kv';
import { mockEnv } from './helpers/fixtures';

// Mock webflow-client for CMS sync assertions
vi.mock('@/webflow-client', () => ({
  listCollections: vi.fn().mockResolvedValue([]),
  createCollection: vi.fn().mockResolvedValue({ id: 'col_new' }),
  createField: vi.fn().mockResolvedValue({}),
  createFieldMultiRef: vi.fn().mockResolvedValue({}),
  listItems: vi.fn().mockResolvedValue([]),
  createItems: vi.fn().mockResolvedValue([]),
  updateItems: vi.fn().mockResolvedValue([]),
  publishSite: vi.fn().mockResolvedValue({}),
}));

import {
  listItems,
  createItems,
  updateItems,
  publishSite,
} from '@/webflow-client';

const mockedListItems = vi.mocked(listItems);
const mockedCreateItems = vi.mocked(createItems);
const mockedUpdateItems = vi.mocked(updateItems);
const mockedPublishSite = vi.mocked(publishSite);

function mockQualificationResponse(redeemables: any[] = []) {
  return new Response(JSON.stringify({ redeemables: { data: redeemables } }));
}

function makePromoRedeemable(id: string, percentOff: number, campaignName = 'Test Campaign') {
  return {
    id,
    object: 'promotion_tier',
    result: { discount: { type: 'PERCENT', percent_off: percentOff } },
    campaign_name: campaignName,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('Promotion Lifecycle', () => {
  it('create promotion → webhook → pricing updated in KV', async () => {
    const kv = new MockKV();
    await kv.put(
      KV_KEYS.PRODUCTS_CATALOG,
      JSON.stringify({ 'prod-1': { basePrice: 100, lastSeen: 1000 } }),
    );
    const env = mockEnv({ PRICING_KV: kv as unknown as KVNamespace });

    const spy = vi.spyOn(globalThis, 'fetch');
    spy.mockResolvedValueOnce(new Response('Not Found', { status: 404 })); // discoverSegments
    spy.mockResolvedValueOnce(mockQualificationResponse([makePromoRedeemable('promo_1', 20)])); // anonymous
    spy.mockResolvedValueOnce(mockQualificationResponse([makePromoRedeemable('promo_1', 20)])); // member

    await processWebhook('campaign.created', env);

    const anonPricing = await kv.get(KV_KEYS.PRICES + 'anonymous', 'json');
    expect(anonPricing['prod-1'].discountedPrice).toBe(80); // 100 - 20%
    expect(anonPricing['prod-1'].discountAmount).toBe(20);
  });

  it('update promotion → webhook → pricing reflects new discount', async () => {
    const kv = new MockKV();
    await kv.put(
      KV_KEYS.PRODUCTS_CATALOG,
      JSON.stringify({ 'prod-1': { basePrice: 100, lastSeen: 1000 } }),
    );
    const env = mockEnv({ PRICING_KV: kv as unknown as KVNamespace });

    // First webhook: 20% off
    const spy = vi.spyOn(globalThis, 'fetch');
    spy.mockResolvedValueOnce(new Response('Not Found', { status: 404 }));
    spy.mockResolvedValueOnce(mockQualificationResponse([makePromoRedeemable('promo_1', 20)]));
    spy.mockResolvedValueOnce(mockQualificationResponse([makePromoRedeemable('promo_1', 20)]));

    await processWebhook('campaign.updated', env);

    let pricing = await kv.get(KV_KEYS.PRICES + 'anonymous', 'json');
    expect(pricing['prod-1'].discountedPrice).toBe(80);

    // Clear revalidation lock for second run
    await kv.delete(KV_KEYS.REVALIDATION_LOCK);

    // Second webhook: 30% off (promotion updated)
    spy.mockResolvedValueOnce(new Response('Not Found', { status: 404 }));
    spy.mockResolvedValueOnce(mockQualificationResponse([makePromoRedeemable('promo_1', 30)]));
    spy.mockResolvedValueOnce(mockQualificationResponse([makePromoRedeemable('promo_1', 30)]));

    await processWebhook('campaign.updated', env);

    pricing = await kv.get(KV_KEYS.PRICES + 'anonymous', 'json');
    expect(pricing['prod-1'].discountedPrice).toBe(70); // 100 - 30%
  });

  it('disable promotion → webhook → fallback to base price', async () => {
    const kv = new MockKV();
    await kv.put(
      KV_KEYS.PRODUCTS_CATALOG,
      JSON.stringify({ 'prod-1': { basePrice: 100, lastSeen: 1000 } }),
    );
    const env = mockEnv({ PRICING_KV: kv as unknown as KVNamespace });

    // First: promotion active
    const spy = vi.spyOn(globalThis, 'fetch');
    spy.mockResolvedValueOnce(new Response('Not Found', { status: 404 }));
    spy.mockResolvedValueOnce(mockQualificationResponse([makePromoRedeemable('promo_1', 20)]));
    spy.mockResolvedValueOnce(mockQualificationResponse([makePromoRedeemable('promo_1', 20)]));

    await processWebhook('campaign.enabled', env);

    let pricing = await kv.get(KV_KEYS.PRICES + 'anonymous', 'json');
    expect(pricing['prod-1'].discountedPrice).toBe(80);

    await kv.delete(KV_KEYS.REVALIDATION_LOCK);

    // Second: promotion disabled — no redeemables returned
    spy.mockResolvedValueOnce(new Response('Not Found', { status: 404 }));
    spy.mockResolvedValueOnce(mockQualificationResponse([])); // anonymous: no promotions
    spy.mockResolvedValueOnce(mockQualificationResponse([])); // member: no promotions

    await processWebhook('campaign.disabled', env);

    pricing = await kv.get(KV_KEYS.PRICES + 'anonymous', 'json');
    expect(pricing['prod-1'].discountedPrice).toBe(100); // reverts to base
    expect(pricing['prod-1'].discountAmount).toBe(0);
    expect(pricing['prod-1'].discountLabel).toBe('');
  });

  it('rapid webhooks are debounced by revalidation lock', async () => {
    const kv = new MockKV();
    await kv.put(
      KV_KEYS.PRODUCTS_CATALOG,
      JSON.stringify({ 'prod-1': { basePrice: 100, lastSeen: 1000 } }),
    );
    const env = mockEnv({ PRICING_KV: kv as unknown as KVNamespace });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Simulate an in-progress revalidation by setting the lock
    await kv.put(KV_KEYS.REVALIDATION_LOCK, String(Date.now()));

    // Both calls should skip — lock is already held
    await revalidateAllSegments(env);
    await revalidateAllSegments(env);

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Revalidation already in progress'),
    );
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('CMS sync is debounced by 5-minute lock', async () => {
    const kv = new MockKV();
    // Set pending flag
    await kv.put(KV_KEYS.CMS_SYNC_PENDING, new Date().toISOString());
    // Set CMS sync lock (simulates recent sync)
    await kv.put(KV_KEYS.CMS_SYNC_LOCK, String(Date.now()));
    // Set up collection IDs so performCMSSync doesn't abort early
    await kv.put(KV_KEYS.CMS_COLLECTION_IDS, JSON.stringify({
      products: 'col_p', categories: 'col_c', segments: 'col_s',
      discountCoupons: 'col_dc', vouchers: 'col_v', referralCodes: 'col_r',
      promotions: 'col_pr', loyaltyPrograms: 'col_lp',
    }));
    const env = mockEnv({ PRICING_KV: kv as unknown as KVNamespace, CMS_SYNC_ENABLED: 'true' });
    vi.spyOn(console, 'log').mockImplementation(() => {});

    await processPendingCMSSync(env);

    // performCMSSync should see the lock and return early with "already in progress"
    // No webflow API calls should be made for creating/updating items
    expect(mockedCreateItems).not.toHaveBeenCalled();
    expect(mockedUpdateItems).not.toHaveBeenCalled();
    expect(mockedPublishSite).not.toHaveBeenCalled();
  });

  it('end-to-end: webhook → revalidation → KV → CMS sync → publish', async () => {
    const kv = new MockKV();
    await kv.put(
      KV_KEYS.PRODUCTS_CATALOG,
      JSON.stringify({ 'prod-1': { basePrice: 100, lastSeen: 1000 } }),
    );
    // Pre-populate collection IDs so CMS sync proceeds
    await kv.put(KV_KEYS.CMS_COLLECTION_IDS, JSON.stringify({
      products: 'col_p', categories: 'col_c', segments: 'col_s',
      discountCoupons: 'col_dc', vouchers: 'col_v', referralCodes: 'col_r',
      promotions: 'col_pr', loyaltyPrograms: 'col_lp',
    }));
    const env = mockEnv({ PRICING_KV: kv as unknown as KVNamespace, CMS_SYNC_ENABLED: 'true' });

    const spy = vi.spyOn(globalThis, 'fetch');
    spy.mockResolvedValueOnce(new Response('Not Found', { status: 404 })); // discoverSegments
    spy.mockResolvedValueOnce(mockQualificationResponse([makePromoRedeemable('promo_1', 15)])); // anonymous
    spy.mockResolvedValueOnce(mockQualificationResponse([makePromoRedeemable('promo_1', 25)])); // member

    // Re-set module mock implementations (beforeEach restoreAllMocks resets them)
    // listItems must return created items after Phase 1, so performCMSSync can build ID maps
    let productsSynced = false;
    let segmentsSynced = false;
    mockedListItems.mockImplementation(async (_env: any, collectionId: string) => {
      if (collectionId === 'col_p' && productsSynced) {
        return [{ id: 'item_p1', fieldData: { slug: 'prod-1', name: 'prod-1' } }];
      }
      if (collectionId === 'col_s' && segmentsSynced) {
        return [
          { id: 'item_s1', fieldData: { slug: 'anonymous', name: 'Anonymous' } },
          { id: 'item_s2', fieldData: { slug: 'member', name: 'Logged-in member' } },
        ];
      }
      return [];
    });
    mockedCreateItems.mockImplementation(async (_env: any, collectionId: string, items: any[]) => {
      if (collectionId === 'col_p') productsSynced = true;
      if (collectionId === 'col_s') segmentsSynced = true;
      return items.map((_, i) => ({ id: `item_${i}` }));
    });
    mockedUpdateItems.mockResolvedValue([]);
    mockedPublishSite.mockResolvedValue({});
    vi.spyOn(console, 'log').mockImplementation(() => {});

    await processWebhook('campaign.created', env);

    // Verify KV pricing was updated
    const anonPricing = await kv.get(KV_KEYS.PRICES + 'anonymous', 'json');
    expect(anonPricing['prod-1'].discountedPrice).toBe(85); // 100 - 15%

    const memberPricing = await kv.get(KV_KEYS.PRICES + 'member', 'json');
    expect(memberPricing['prod-1'].discountedPrice).toBe(75); // 100 - 25%

    // Verify CMS sync was triggered (createItems called for products at minimum)
    expect(mockedCreateItems).toHaveBeenCalled();

    // Verify site was published
    expect(mockedPublishSite).toHaveBeenCalled();

    // Verify last CMS sync timestamp was set
    const lastSync = await kv.get(KV_KEYS.META_LAST_CMS_SYNC);
    expect(lastSync).toBeTruthy();
  });

  it('fallback data: no promotion → base price, no discount label', async () => {
    const kv = new MockKV();
    await kv.put(
      KV_KEYS.PRODUCTS_CATALOG,
      JSON.stringify({
        'prod-1': { basePrice: 100, lastSeen: 1000 },
        'prod-2': { basePrice: 50, lastSeen: 1000 },
      }),
    );
    const env = mockEnv({ PRICING_KV: kv as unknown as KVNamespace });

    const spy = vi.spyOn(globalThis, 'fetch');
    spy.mockResolvedValueOnce(new Response('Not Found', { status: 404 }));
    spy.mockResolvedValueOnce(mockQualificationResponse([])); // no promotions
    spy.mockResolvedValueOnce(mockQualificationResponse([]));

    await processWebhook('campaign.disabled', env);

    const pricing = await kv.get(KV_KEYS.PRICES + 'anonymous', 'json');
    expect(pricing['prod-1'].discountedPrice).toBe(100);
    expect(pricing['prod-1'].discountAmount).toBe(0);
    expect(pricing['prod-1'].discountLabel).toBe('');
    expect(pricing['prod-2'].discountedPrice).toBe(50);
    expect(pricing['prod-2'].discountAmount).toBe(0);
  });

  it('default-text and default-price are never overwritten by CMS sync', async () => {
    const kv = new MockKV();
    await kv.put(
      KV_KEYS.PRODUCTS_CATALOG,
      JSON.stringify({ 'prod-1': { basePrice: 100, lastSeen: 1000 } }),
    );
    await kv.put(KV_KEYS.CMS_COLLECTION_IDS, JSON.stringify({
      products: 'col_p', categories: 'col_c', segments: 'col_s',
      discountCoupons: 'col_dc', vouchers: 'col_v', referralCodes: 'col_r',
      promotions: 'col_pr', loyaltyPrograms: 'col_lp',
    }));
    const env = mockEnv({ PRICING_KV: kv as unknown as KVNamespace, CMS_SYNC_ENABLED: 'true' });

    // Simulate existing product item with marketing-set default-text/default-price
    mockedListItems.mockImplementation(async (_env: any, collectionId: string) => {
      if (collectionId === 'col_p') {
        return [{
          id: 'item_prod1',
          fieldData: {
            slug: 'prod-1',
            name: 'prod-1',
            'default-text': 'Starting from',
            'default-price': 89.99,
            active: true,
          },
        }];
      }
      return [];
    });

    // Capture what gets sent to updateItems for the products collection
    const updateCalls: any[] = [];
    mockedUpdateItems.mockImplementation(async (_env: any, collectionId: string, items: any[]) => {
      if (collectionId === 'col_p') {
        updateCalls.push(...items);
      }
      return [];
    });
    mockedCreateItems.mockResolvedValue([]);
    mockedPublishSite.mockResolvedValue({});
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const spy = vi.spyOn(globalThis, 'fetch');
    spy.mockResolvedValueOnce(new Response('Not Found', { status: 404 }));
    spy.mockResolvedValueOnce(mockQualificationResponse([]));
    spy.mockResolvedValueOnce(mockQualificationResponse([]));

    await processWebhook('campaign.disabled', env);

    // Verify the product update does NOT contain default-text or default-price
    expect(updateCalls.length).toBeGreaterThan(0);
    for (const update of updateCalls) {
      expect(update.fieldData).not.toHaveProperty('default-text');
      expect(update.fieldData).not.toHaveProperty('default-price');
    }
  });

  it('multi-segment pricing: different discounts per segment', async () => {
    const kv = new MockKV();
    await kv.put(
      KV_KEYS.PRODUCTS_CATALOG,
      JSON.stringify({ 'prod-1': { basePrice: 100, lastSeen: 1000 } }),
    );
    const env = mockEnv({ PRICING_KV: kv as unknown as KVNamespace });

    const spy = vi.spyOn(globalThis, 'fetch');
    spy.mockResolvedValueOnce(new Response('Not Found', { status: 404 })); // discoverSegments
    // anonymous: 10% off
    spy.mockResolvedValueOnce(mockQualificationResponse([makePromoRedeemable('promo_1', 10)]));
    // member: 30% off
    spy.mockResolvedValueOnce(mockQualificationResponse([makePromoRedeemable('promo_1', 30)]));

    await processWebhook('campaign.created', env);

    const anonPricing = await kv.get(KV_KEYS.PRICES + 'anonymous', 'json');
    expect(anonPricing['prod-1'].discountedPrice).toBe(90); // 100 - 10%

    const memberPricing = await kv.get(KV_KEYS.PRICES + 'member', 'json');
    expect(memberPricing['prod-1'].discountedPrice).toBe(70); // 100 - 30%

    // Verify segments are stored with different pricing
    expect(anonPricing['prod-1'].discountedPrice).not.toBe(memberPricing['prod-1'].discountedPrice);
  });
});
