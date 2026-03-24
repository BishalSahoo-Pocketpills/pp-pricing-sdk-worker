import { describe, it, expect, beforeEach } from 'vitest';
import { MockKV } from './helpers/mock-kv';
import {
  getPricing,
  setPricing,
  getSegments,
  setSegments,
  getProducts,
  setProducts,
  updateProducts,
  getMeta,
  setMeta,
} from '@/store';
import type { PricingEntry, SegmentDefinition, ProductEntry } from '@/types';

let kv: MockKV;

beforeEach(() => {
  kv = new MockKV();
});

const kvNs = () => kv as unknown as KVNamespace;

describe('pricing operations', () => {
  const pricing: Record<string, PricingEntry> = {
    'prod-1': {
      basePrice: 100,
      discountedPrice: 75,
      discountAmount: 25,
      discountLabel: '25% OFF',
      discountType: 'PERCENT',
      applicableVouchers: ['promo_1'],
      campaignName: 'Summer',
    },
  };

  it('returns null when no pricing exists', async () => {
    expect(await getPricing(kvNs(), 'anonymous')).toBeNull();
  });

  it('round-trips pricing data', async () => {
    await setPricing(kvNs(), 'anonymous', pricing);
    const result = await getPricing(kvNs(), 'anonymous');
    expect(result).toEqual(pricing);
  });

  it('stores different segments independently', async () => {
    await setPricing(kvNs(), 'anonymous', pricing);
    await setPricing(kvNs(), 'member', { 'prod-2': { ...pricing['prod-1'], basePrice: 200 } });
    expect(await getPricing(kvNs(), 'anonymous')).toEqual(pricing);
    expect((await getPricing(kvNs(), 'member'))!['prod-2'].basePrice).toBe(200);
  });
});

describe('segment operations', () => {
  const segments: SegmentDefinition[] = [
    { key: 'anonymous', label: 'Anonymous', customerContext: {} },
    { key: 'member', label: 'Member', customerContext: { metadata: { is_logged_in: true } } },
  ];

  it('returns empty array when no segments exist', async () => {
    expect(await getSegments(kvNs())).toEqual([]);
  });

  it('round-trips segment data', async () => {
    await setSegments(kvNs(), segments);
    expect(await getSegments(kvNs())).toEqual(segments);
  });
});

describe('product operations', () => {
  it('returns empty object when no products exist', async () => {
    expect(await getProducts(kvNs())).toEqual({});
  });

  it('round-trips product data', async () => {
    const products: Record<string, ProductEntry> = {
      'prod-1': { basePrice: 100, lastSeen: 1000 },
    };
    await setProducts(kvNs(), products);
    expect(await getProducts(kvNs())).toEqual(products);
  });

  it('updateProducts merges into existing catalog', async () => {
    await setProducts(kvNs(), {
      'prod-1': { basePrice: 100, lastSeen: Date.now() },
    });
    const result = await updateProducts(kvNs(), { 'prod-2': 200 });
    expect(result['prod-1'].basePrice).toBe(100);
    expect(result['prod-2'].basePrice).toBe(200);
    expect(result['prod-2'].lastSeen).toBeGreaterThan(0);
  });

  it('updateProducts overwrites existing product base price', async () => {
    await setProducts(kvNs(), {
      'prod-1': { basePrice: 100, lastSeen: Date.now() },
    });
    const result = await updateProducts(kvNs(), { 'prod-1': 150 });
    expect(result['prod-1'].basePrice).toBe(150);
  });

  it('updateProducts evicts stale products', async () => {
    const thirtyOneDaysAgo = Date.now() - 31 * 24 * 60 * 60 * 1000;
    await setProducts(kvNs(), {
      'stale-prod': { basePrice: 50, lastSeen: thirtyOneDaysAgo },
      'fresh-prod': { basePrice: 75, lastSeen: Date.now() },
    });
    const result = await updateProducts(kvNs(), { 'new-prod': 100 });
    expect(result['stale-prod']).toBeUndefined();
    expect(result['fresh-prod'].basePrice).toBe(75);
    expect(result['new-prod'].basePrice).toBe(100);
  });

  it('updateProducts skips update when catalog lock is held', async () => {
    await setProducts(kvNs(), {
      'prod-1': { basePrice: 100, lastSeen: Date.now() },
    });
    // Simulate an existing lock
    await kv.put('catalog:lock', String(Date.now()));

    const result = await updateProducts(kvNs(), { 'prod-2': 200 });

    // Should return existing catalog without the new product
    expect(result['prod-1'].basePrice).toBe(100);
    expect(result['prod-2']).toBeUndefined();
  });

  it('updateProducts acquires and releases catalog lock', async () => {
    const result = await updateProducts(kvNs(), { 'prod-1': 100 });
    expect(result['prod-1'].basePrice).toBe(100);

    // Lock should be released after completion
    const lockValue = await kv.get('catalog:lock');
    expect(lockValue).toBeNull();
  });
});

describe('meta operations', () => {
  it('returns null for missing meta', async () => {
    expect(await getMeta(kvNs(), 'meta:key')).toBeNull();
  });

  it('round-trips meta values', async () => {
    await setMeta(kvNs(), 'meta:key', 'value');
    expect(await getMeta(kvNs(), 'meta:key')).toBe('value');
  });
});
