import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  setupCollections,
  syncPricingToCMS,
  syncTreatmentsToCMS,
  syncSegmentsToCMS,
  syncOffersToCMS,
  buildOfferSlug,
  computeSortOrder,
  buildOfferFieldData,
  getCMSStatus,
} from '@/cms';
import { KV_KEYS } from '@/config';
import { mockEnv } from './helpers/fixtures';
import { MockKV } from './helpers/mock-kv';
import type { Env, PricingEntry, ProductEntry, SegmentDefinition, OfferEntry, OffersBundle } from '@/types';

// Mock webflow-client module
vi.mock('@/webflow-client', () => ({
  listCollections: vi.fn(),
  createCollection: vi.fn(),
  createField: vi.fn(),
  listItems: vi.fn(),
  createLiveItems: vi.fn(),
  updateLiveItems: vi.fn(),
  publishItems: vi.fn(),
}));

import {
  listCollections,
  createCollection,
  createField,
  listItems,
  createLiveItems,
  updateLiveItems,
  publishItems,
} from '@/webflow-client';

const mockedListCollections = vi.mocked(listCollections);
const mockedCreateCollection = vi.mocked(createCollection);
const mockedCreateField = vi.mocked(createField);
const mockedListItems = vi.mocked(listItems);
const mockedCreateLiveItems = vi.mocked(createLiveItems);
const mockedUpdateLiveItems = vi.mocked(updateLiveItems);
const mockedPublishItems = vi.mocked(publishItems);

// --- Test data ---

function makePricingEntry(overrides: Partial<PricingEntry> = {}): PricingEntry {
  return {
    basePrice: 60,
    discountedPrice: 30,
    discountAmount: 30,
    discountLabel: '50% OFF',
    discountType: 'PERCENT',
    applicableVouchers: ['promo_1'],
    campaignName: 'Summer Sale',
    ...overrides,
  };
}

function makeProducts(): Record<string, ProductEntry> {
  return {
    'hair-loss': { basePrice: 60, lastSeen: Date.now() },
    'weight-loss': { basePrice: 100, lastSeen: Date.now() },
  };
}

function makeSegments(): SegmentDefinition[] {
  return [
    { key: 'anonymous', label: 'Anonymous', customerContext: {} },
    { key: 'member', label: 'Logged-in member', customerContext: { metadata: { is_logged_in: true } } },
  ];
}

function makeOfferEntry(overrides: Partial<OfferEntry> = {}): OfferEntry {
  return {
    id: 'promo_summer',
    category: 'promotion',
    title: 'Summer Sale',
    description: '25% off everything',
    applicableProductIds: ['hair-loss'],
    discount: { type: 'PERCENT', percentOff: 25, label: '25% OFF' },
    campaignName: 'Summer Campaign',
    ...overrides,
  };
}

function makeOffersBundle(overrides: Partial<OffersBundle> = {}): OffersBundle {
  return {
    promotions: [makeOfferEntry()],
    coupons: [makeOfferEntry({
      id: 'voucher_save10',
      category: 'coupon',
      title: 'Save $10',
      description: '$10 off your order',
      code: 'SAVE10',
      discount: { type: 'AMOUNT', amountOff: 1000, label: '$10 OFF' },
      campaignName: 'Coupon Campaign',
    })],
    loyalty: [],
    referrals: [],
    gifts: [],
    ...overrides,
  };
}

describe('CMS module', () => {
  let env: Env;
  let kv: MockKV;

  beforeEach(() => {
    vi.resetAllMocks();
    kv = new MockKV();
    env = mockEnv({ PRICING_KV: kv as unknown as KVNamespace, CMS_SYNC_ENABLED: 'true' });
  });

  // =====================================================
  // setupCollections
  // =====================================================

  describe('setupCollections', () => {
    it('creates all four collections when none exist', async () => {
      mockedListCollections.mockResolvedValueOnce([]);
      mockedCreateCollection
        .mockResolvedValueOnce({ id: 'col_treat', displayName: 'Treatments', singularName: 'Treatment', slug: 'treatments', fields: [] })
        .mockResolvedValueOnce({ id: 'col_price', displayName: 'Pricing', singularName: 'Pricing', slug: 'pricing', fields: [] })
        .mockResolvedValueOnce({ id: 'col_seg', displayName: 'Segments', singularName: 'Segment', slug: 'segments', fields: [] })
        .mockResolvedValueOnce({ id: 'col_off', displayName: 'Offers', singularName: 'Offer', slug: 'offers', fields: [] });
      mockedCreateField.mockResolvedValue({ id: 'f1', type: 'PlainText', slug: 'test', displayName: 'Test' });

      const ids = await setupCollections(env);

      expect(ids).toEqual({ treatments: 'col_treat', pricing: 'col_price', segments: 'col_seg', offers: 'col_off' });
      expect(mockedCreateCollection).toHaveBeenCalledTimes(4);
      // Treatments: 2 custom fields, Pricing: 9, Segments: 2, Offers: 19 = 32 total
      expect(mockedCreateField).toHaveBeenCalledTimes(32);

      // Verify stored in KV
      const stored = await kv.get(KV_KEYS.CMS_COLLECTION_IDS, 'json');
      expect(stored).toEqual(ids);
    });

    it('reuses existing collections by slug', async () => {
      mockedListCollections.mockResolvedValueOnce([
        { id: 'existing_treat', displayName: 'Treatments', singularName: 'Treatment', slug: 'treatments', fields: [] },
        { id: 'existing_price', displayName: 'Pricing', singularName: 'Pricing', slug: 'pricing', fields: [] },
        { id: 'existing_seg', displayName: 'Segments', singularName: 'Segment', slug: 'segments', fields: [] },
        { id: 'existing_off', displayName: 'Offers', singularName: 'Offer', slug: 'offers', fields: [] },
      ]);

      const ids = await setupCollections(env);

      expect(ids).toEqual({ treatments: 'existing_treat', pricing: 'existing_price', segments: 'existing_seg', offers: 'existing_off' });
      expect(mockedCreateCollection).not.toHaveBeenCalled();
      expect(mockedCreateField).not.toHaveBeenCalled();
    });

    it('creates only missing collections', async () => {
      mockedListCollections.mockResolvedValueOnce([
        { id: 'existing_treat', displayName: 'Treatments', singularName: 'Treatment', slug: 'treatments', fields: [] },
      ]);
      mockedCreateCollection
        .mockResolvedValueOnce({ id: 'col_price', displayName: 'Pricing', singularName: 'Pricing', slug: 'pricing', fields: [] })
        .mockResolvedValueOnce({ id: 'col_seg', displayName: 'Segments', singularName: 'Segment', slug: 'segments', fields: [] })
        .mockResolvedValueOnce({ id: 'col_off', displayName: 'Offers', singularName: 'Offer', slug: 'offers', fields: [] });
      mockedCreateField.mockResolvedValue({ id: 'f1', type: 'PlainText', slug: 'test', displayName: 'Test' });

      const ids = await setupCollections(env);

      expect(ids.treatments).toBe('existing_treat');
      expect(ids.pricing).toBe('col_price');
      expect(ids.segments).toBe('col_seg');
      expect(ids.offers).toBe('col_off');
      expect(mockedCreateCollection).toHaveBeenCalledTimes(3);
    });
  });

  // =====================================================
  // syncPricingToCMS
  // =====================================================

  describe('syncPricingToCMS', () => {
    it('creates new pricing items when CMS is empty', async () => {
      // Set up KV data
      const collectionIds = { treatments: 'col_t', pricing: 'col_p', segments: 'col_s', offers: 'col_o' };
      await kv.put(KV_KEYS.CMS_COLLECTION_IDS, JSON.stringify(collectionIds));
      await kv.put(KV_KEYS.SEGMENTS_REGISTRY, JSON.stringify(makeSegments()));
      await kv.put(KV_KEYS.PRODUCTS_CATALOG, JSON.stringify(makeProducts()));
      await kv.put(KV_KEYS.PRICES + 'anonymous', JSON.stringify({
        'hair-loss': makePricingEntry(),
        'weight-loss': makePricingEntry({ basePrice: 100, discountedPrice: 80, discountAmount: 20 }),
      }));
      await kv.put(KV_KEYS.PRICES + 'member', JSON.stringify({
        'hair-loss': makePricingEntry({ discountedPrice: 20, discountAmount: 40 }),
        'weight-loss': makePricingEntry({ basePrice: 100, discountedPrice: 50, discountAmount: 50 }),
      }));

      // No existing items in CMS
      mockedListItems
        .mockResolvedValueOnce([]) // Initial listing
        .mockResolvedValueOnce([ // After create, listing for publish
          { id: 'new_1', fieldData: { slug: 'hair-loss--anonymous' }, isDraft: false, isArchived: false, createdOn: '', lastUpdated: '' },
          { id: 'new_2', fieldData: { slug: 'weight-loss--anonymous' }, isDraft: false, isArchived: false, createdOn: '', lastUpdated: '' },
          { id: 'new_3', fieldData: { slug: 'hair-loss--member' }, isDraft: false, isArchived: false, createdOn: '', lastUpdated: '' },
          { id: 'new_4', fieldData: { slug: 'weight-loss--member' }, isDraft: false, isArchived: false, createdOn: '', lastUpdated: '' },
        ]);

      mockedCreateLiveItems.mockResolvedValueOnce([
        { id: 'new_1', fieldData: {}, isDraft: false, isArchived: false, createdOn: '', lastUpdated: '' },
        { id: 'new_2', fieldData: {}, isDraft: false, isArchived: false, createdOn: '', lastUpdated: '' },
        { id: 'new_3', fieldData: {}, isDraft: false, isArchived: false, createdOn: '', lastUpdated: '' },
        { id: 'new_4', fieldData: {}, isDraft: false, isArchived: false, createdOn: '', lastUpdated: '' },
      ]);
      mockedPublishItems.mockResolvedValueOnce(undefined);

      const result = await syncPricingToCMS(env);

      expect(result.created).toBe(4);
      expect(result.updated).toBe(0);
      expect(result.published).toBe(4);
      expect(result.errors).toEqual([]);
      expect(mockedCreateLiveItems).toHaveBeenCalledOnce();
      expect(mockedUpdateLiveItems).not.toHaveBeenCalled();
      expect(mockedPublishItems).toHaveBeenCalledOnce();
    });

    it('updates existing pricing items by slug match', async () => {
      const collectionIds = { treatments: 'col_t', pricing: 'col_p', segments: 'col_s', offers: 'col_o' };
      await kv.put(KV_KEYS.CMS_COLLECTION_IDS, JSON.stringify(collectionIds));
      await kv.put(KV_KEYS.SEGMENTS_REGISTRY, JSON.stringify([makeSegments()[0]])); // only anonymous
      await kv.put(KV_KEYS.PRODUCTS_CATALOG, JSON.stringify({ 'hair-loss': { basePrice: 60, lastSeen: Date.now() } }));
      await kv.put(KV_KEYS.PRICES + 'anonymous', JSON.stringify({
        'hair-loss': makePricingEntry(),
      }));

      // Existing item in CMS
      mockedListItems
        .mockResolvedValueOnce([
          { id: 'existing_1', fieldData: { slug: 'hair-loss--anonymous', name: 'hair-loss__anonymous' }, isDraft: false, isArchived: false, createdOn: '', lastUpdated: '' },
        ])
        .mockResolvedValueOnce([
          { id: 'existing_1', fieldData: { slug: 'hair-loss--anonymous' }, isDraft: false, isArchived: false, createdOn: '', lastUpdated: '' },
        ]);

      mockedUpdateLiveItems.mockResolvedValueOnce(undefined);
      mockedPublishItems.mockResolvedValueOnce(undefined);

      const result = await syncPricingToCMS(env);

      expect(result.created).toBe(0);
      expect(result.updated).toBe(1);
      expect(result.published).toBe(1);
      expect(mockedCreateLiveItems).not.toHaveBeenCalled();
      expect(mockedUpdateLiveItems).toHaveBeenCalledOnce();
    });

    it('returns error when collections are not set up', async () => {
      // No collection IDs in KV
      mockedListCollections.mockResolvedValueOnce([]); // Discovery also fails

      const result = await syncPricingToCMS(env);

      expect(result.errors).toContain('CMS collections not set up. Run POST /api/cms/setup first.');
      expect(result.created).toBe(0);
    });

    it('returns error when product catalog is empty', async () => {
      const collectionIds = { treatments: 'col_t', pricing: 'col_p', segments: 'col_s', offers: 'col_o' };
      await kv.put(KV_KEYS.CMS_COLLECTION_IDS, JSON.stringify(collectionIds));
      await kv.put(KV_KEYS.SEGMENTS_REGISTRY, JSON.stringify(makeSegments()));
      // No products in catalog

      const result = await syncPricingToCMS(env);

      expect(result.errors).toContain('Product catalog is empty');
    });

    it('handles create errors gracefully', async () => {
      const collectionIds = { treatments: 'col_t', pricing: 'col_p', segments: 'col_s', offers: 'col_o' };
      await kv.put(KV_KEYS.CMS_COLLECTION_IDS, JSON.stringify(collectionIds));
      await kv.put(KV_KEYS.SEGMENTS_REGISTRY, JSON.stringify([makeSegments()[0]]));
      await kv.put(KV_KEYS.PRODUCTS_CATALOG, JSON.stringify({ 'hair-loss': { basePrice: 60, lastSeen: Date.now() } }));
      await kv.put(KV_KEYS.PRICES + 'anonymous', JSON.stringify({ 'hair-loss': makePricingEntry() }));

      mockedListItems.mockResolvedValueOnce([]);
      mockedCreateLiveItems.mockRejectedValueOnce(new Error('Webflow API error 500'));

      const result = await syncPricingToCMS(env);

      expect(result.created).toBe(0);
      expect(result.errors).toContain('Create failed: Webflow API error 500');
    });

    it('handles update errors gracefully', async () => {
      const collectionIds = { treatments: 'col_t', pricing: 'col_p', segments: 'col_s', offers: 'col_o' };
      await kv.put(KV_KEYS.CMS_COLLECTION_IDS, JSON.stringify(collectionIds));
      await kv.put(KV_KEYS.SEGMENTS_REGISTRY, JSON.stringify([makeSegments()[0]]));
      await kv.put(KV_KEYS.PRODUCTS_CATALOG, JSON.stringify({ 'hair-loss': { basePrice: 60, lastSeen: Date.now() } }));
      await kv.put(KV_KEYS.PRICES + 'anonymous', JSON.stringify({ 'hair-loss': makePricingEntry() }));

      mockedListItems.mockResolvedValueOnce([
        { id: 'existing_1', fieldData: { slug: 'hair-loss--anonymous' }, isDraft: false, isArchived: false, createdOn: '', lastUpdated: '' },
      ]);
      mockedUpdateLiveItems.mockRejectedValueOnce(new Error('Webflow API error 429'));

      const result = await syncPricingToCMS(env);

      expect(result.updated).toBe(0);
      expect(result.errors).toContain('Update failed: Webflow API error 429');
    });

    it('skips segments with no pricing data in KV', async () => {
      const collectionIds = { treatments: 'col_t', pricing: 'col_p', segments: 'col_s', offers: 'col_o' };
      await kv.put(KV_KEYS.CMS_COLLECTION_IDS, JSON.stringify(collectionIds));
      await kv.put(KV_KEYS.SEGMENTS_REGISTRY, JSON.stringify(makeSegments()));
      await kv.put(KV_KEYS.PRODUCTS_CATALOG, JSON.stringify({ 'hair-loss': { basePrice: 60, lastSeen: Date.now() } }));
      // No pricing data for any segment

      mockedListItems.mockResolvedValueOnce([]);

      const result = await syncPricingToCMS(env);

      expect(result.created).toBe(0);
      expect(result.updated).toBe(0);
      expect(mockedCreateLiveItems).not.toHaveBeenCalled();
    });

    it('discovers collection IDs from Webflow when not in KV', async () => {
      // No IDs in KV, but collections exist in Webflow
      mockedListCollections.mockResolvedValueOnce([
        { id: 'found_t', displayName: 'Treatments', singularName: 'Treatment', slug: 'treatments', fields: [] },
        { id: 'found_p', displayName: 'Pricing', singularName: 'Pricing', slug: 'pricing', fields: [] },
        { id: 'found_s', displayName: 'Segments', singularName: 'Segment', slug: 'segments', fields: [] },
      ]);

      await kv.put(KV_KEYS.SEGMENTS_REGISTRY, JSON.stringify(makeSegments()));
      await kv.put(KV_KEYS.PRODUCTS_CATALOG, JSON.stringify({ 'hair-loss': { basePrice: 60, lastSeen: Date.now() } }));
      await kv.put(KV_KEYS.PRICES + 'anonymous', JSON.stringify({ 'hair-loss': makePricingEntry() }));

      mockedListItems
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 'n1', fieldData: {}, isDraft: false, isArchived: false, createdOn: '', lastUpdated: '' }]);
      mockedCreateLiveItems.mockResolvedValueOnce([
        { id: 'n1', fieldData: {}, isDraft: false, isArchived: false, createdOn: '', lastUpdated: '' },
      ]);
      mockedPublishItems.mockResolvedValueOnce(undefined);

      const result = await syncPricingToCMS(env);

      expect(result.created).toBe(1);
      // Should have stored discovered IDs
      const stored = await kv.get(KV_KEYS.CMS_COLLECTION_IDS, 'json');
      expect(stored).toEqual({ treatments: 'found_t', pricing: 'found_p', segments: 'found_s', offers: '' });
    });

    it('records last sync timestamp in KV', async () => {
      const collectionIds = { treatments: 'col_t', pricing: 'col_p', segments: 'col_s', offers: 'col_o' };
      await kv.put(KV_KEYS.CMS_COLLECTION_IDS, JSON.stringify(collectionIds));
      await kv.put(KV_KEYS.SEGMENTS_REGISTRY, JSON.stringify(makeSegments()));
      await kv.put(KV_KEYS.PRODUCTS_CATALOG, JSON.stringify(makeProducts()));
      await kv.put(KV_KEYS.PRICES + 'anonymous', JSON.stringify({ 'hair-loss': makePricingEntry() }));

      mockedListItems.mockResolvedValue([]);

      // Products exist but member pricing missing, anonymous pricing has 1 item
      mockedCreateLiveItems.mockResolvedValueOnce([
        { id: 'n1', fieldData: {}, isDraft: false, isArchived: false, createdOn: '', lastUpdated: '' },
      ]);
      mockedListItems
        .mockResolvedValueOnce([]) // initial listing
        .mockResolvedValueOnce([{ id: 'n1', fieldData: {}, isDraft: false, isArchived: false, createdOn: '', lastUpdated: '' }]);
      mockedPublishItems.mockResolvedValueOnce(undefined);

      await syncPricingToCMS(env);

      const lastSync = await kv.get(KV_KEYS.META_LAST_CMS_SYNC);
      expect(lastSync).toBeTruthy();
      // Should be a valid ISO date
      expect(new Date(lastSync!).toISOString()).toBe(lastSync);
    });
  });

  // =====================================================
  // syncOffersToCMS
  // =====================================================

  describe('syncOffersToCMS', () => {
    it('creates new offer items when CMS is empty', async () => {
      const collectionIds = { treatments: 'col_t', pricing: 'col_p', segments: 'col_s', offers: 'col_o' };
      await kv.put(KV_KEYS.CMS_COLLECTION_IDS, JSON.stringify(collectionIds));
      await kv.put(KV_KEYS.SEGMENTS_REGISTRY, JSON.stringify([makeSegments()[0]])); // anonymous only
      await kv.put(KV_KEYS.OFFERS + 'anonymous', JSON.stringify(makeOffersBundle()));

      mockedListItems
        .mockResolvedValueOnce([]) // existing items
        .mockResolvedValueOnce([ // after create, for publish
          { id: 'o1', fieldData: { slug: 'promo-summer--anonymous' }, isDraft: false, isArchived: false, createdOn: '', lastUpdated: '' },
          { id: 'o2', fieldData: { slug: 'voucher-save10--anonymous' }, isDraft: false, isArchived: false, createdOn: '', lastUpdated: '' },
        ]);
      mockedCreateLiveItems.mockResolvedValueOnce([
        { id: 'o1', fieldData: {}, isDraft: false, isArchived: false, createdOn: '', lastUpdated: '' },
        { id: 'o2', fieldData: {}, isDraft: false, isArchived: false, createdOn: '', lastUpdated: '' },
      ]);
      mockedPublishItems.mockResolvedValueOnce(undefined);

      const result = await syncOffersToCMS(env);

      expect(result.created).toBe(2);
      expect(result.updated).toBe(0);
      expect(result.published).toBe(2);
      expect(result.errors).toEqual([]);
      expect(mockedCreateLiveItems).toHaveBeenCalledOnce();
      expect(mockedPublishItems).toHaveBeenCalledOnce();
    });

    it('updates existing items by slug match', async () => {
      const collectionIds = { treatments: 'col_t', pricing: 'col_p', segments: 'col_s', offers: 'col_o' };
      await kv.put(KV_KEYS.CMS_COLLECTION_IDS, JSON.stringify(collectionIds));
      await kv.put(KV_KEYS.SEGMENTS_REGISTRY, JSON.stringify([makeSegments()[0]]));
      await kv.put(KV_KEYS.OFFERS + 'anonymous', JSON.stringify(makeOffersBundle({ coupons: [], loyalty: [], referrals: [], gifts: [] })));

      const existingSlug = buildOfferSlug('promo_summer', 'anonymous');
      mockedListItems
        .mockResolvedValueOnce([
          { id: 'existing_o1', fieldData: { slug: existingSlug, active: true }, isDraft: false, isArchived: false, createdOn: '', lastUpdated: '' },
        ])
        .mockResolvedValueOnce([
          { id: 'existing_o1', fieldData: { slug: existingSlug }, isDraft: false, isArchived: false, createdOn: '', lastUpdated: '' },
        ]);
      mockedUpdateLiveItems.mockResolvedValueOnce(undefined);
      mockedPublishItems.mockResolvedValueOnce(undefined);

      const result = await syncOffersToCMS(env);

      expect(result.created).toBe(0);
      expect(result.updated).toBe(1);
      expect(result.published).toBe(1);
      expect(mockedCreateLiveItems).not.toHaveBeenCalled();
      expect(mockedUpdateLiveItems).toHaveBeenCalledOnce();
    });

    it('deactivates stale offers', async () => {
      const collectionIds = { treatments: 'col_t', pricing: 'col_p', segments: 'col_s', offers: 'col_o' };
      await kv.put(KV_KEYS.CMS_COLLECTION_IDS, JSON.stringify(collectionIds));
      await kv.put(KV_KEYS.SEGMENTS_REGISTRY, JSON.stringify([makeSegments()[0]]));
      // Empty offers bundle — no current offers
      await kv.put(KV_KEYS.OFFERS + 'anonymous', JSON.stringify({
        promotions: [], coupons: [], loyalty: [], referrals: [], gifts: [],
      }));

      // But CMS has a stale item
      mockedListItems
        .mockResolvedValueOnce([
          { id: 'stale_o1', fieldData: { slug: 'old-promo--anonymous', active: true }, isDraft: false, isArchived: false, createdOn: '', lastUpdated: '' },
        ])
        .mockResolvedValueOnce([
          { id: 'stale_o1', fieldData: { slug: 'old-promo--anonymous', active: false }, isDraft: false, isArchived: false, createdOn: '', lastUpdated: '' },
        ]);
      mockedUpdateLiveItems.mockResolvedValueOnce(undefined);
      mockedPublishItems.mockResolvedValueOnce(undefined);

      const result = await syncOffersToCMS(env);

      expect(result.updated).toBe(1);
      // Verify the update set active: false
      const updateCall = mockedUpdateLiveItems.mock.calls[0];
      expect(updateCall[2][0].fieldData.active).toBe(false);
    });

    it('skips already-inactive items during stale cleanup', async () => {
      const collectionIds = { treatments: 'col_t', pricing: 'col_p', segments: 'col_s', offers: 'col_o' };
      await kv.put(KV_KEYS.CMS_COLLECTION_IDS, JSON.stringify(collectionIds));
      await kv.put(KV_KEYS.SEGMENTS_REGISTRY, JSON.stringify([makeSegments()[0]]));
      await kv.put(KV_KEYS.OFFERS + 'anonymous', JSON.stringify({
        promotions: [], coupons: [], loyalty: [], referrals: [], gifts: [],
      }));

      // Already-inactive stale item
      mockedListItems.mockResolvedValueOnce([
        { id: 'stale_o1', fieldData: { slug: 'old-promo--anonymous', active: false }, isDraft: false, isArchived: false, createdOn: '', lastUpdated: '' },
      ]);

      const result = await syncOffersToCMS(env);

      expect(result.created).toBe(0);
      expect(result.updated).toBe(0);
      expect(mockedUpdateLiveItems).not.toHaveBeenCalled();
    });

    it('returns error when collections not set up', async () => {
      mockedListCollections.mockResolvedValueOnce([]);

      const result = await syncOffersToCMS(env);

      expect(result.errors).toContain('CMS collections not set up. Run POST /api/cms/setup first.');
      expect(result.created).toBe(0);
    });

    it('returns error when offers collection ID is empty', async () => {
      const collectionIds = { treatments: 'col_t', pricing: 'col_p', segments: 'col_s', offers: '' };
      await kv.put(KV_KEYS.CMS_COLLECTION_IDS, JSON.stringify(collectionIds));

      const result = await syncOffersToCMS(env);

      expect(result.errors).toContain('Offers collection not set up. Run POST /api/cms/setup first.');
    });

    it('returns error when no segments', async () => {
      const collectionIds = { treatments: 'col_t', pricing: 'col_p', segments: 'col_s', offers: 'col_o' };
      await kv.put(KV_KEYS.CMS_COLLECTION_IDS, JSON.stringify(collectionIds));
      // No segments in KV

      const result = await syncOffersToCMS(env);

      expect(result.errors).toContain('No segments found');
    });

    it('skips segments with no offers in KV', async () => {
      const collectionIds = { treatments: 'col_t', pricing: 'col_p', segments: 'col_s', offers: 'col_o' };
      await kv.put(KV_KEYS.CMS_COLLECTION_IDS, JSON.stringify(collectionIds));
      await kv.put(KV_KEYS.SEGMENTS_REGISTRY, JSON.stringify(makeSegments()));
      // No offers data for any segment

      mockedListItems.mockResolvedValueOnce([]);

      const result = await syncOffersToCMS(env);

      expect(result.created).toBe(0);
      expect(result.updated).toBe(0);
      expect(mockedCreateLiveItems).not.toHaveBeenCalled();
    });

    it('handles create errors gracefully', async () => {
      const collectionIds = { treatments: 'col_t', pricing: 'col_p', segments: 'col_s', offers: 'col_o' };
      await kv.put(KV_KEYS.CMS_COLLECTION_IDS, JSON.stringify(collectionIds));
      await kv.put(KV_KEYS.SEGMENTS_REGISTRY, JSON.stringify([makeSegments()[0]]));
      await kv.put(KV_KEYS.OFFERS + 'anonymous', JSON.stringify(makeOffersBundle()));

      mockedListItems.mockResolvedValueOnce([]);
      mockedCreateLiveItems.mockRejectedValueOnce(new Error('Webflow API error 500'));

      const result = await syncOffersToCMS(env);

      expect(result.created).toBe(0);
      expect(result.errors).toContain('Create failed: Webflow API error 500');
    });

    it('handles update errors gracefully', async () => {
      const collectionIds = { treatments: 'col_t', pricing: 'col_p', segments: 'col_s', offers: 'col_o' };
      await kv.put(KV_KEYS.CMS_COLLECTION_IDS, JSON.stringify(collectionIds));
      await kv.put(KV_KEYS.SEGMENTS_REGISTRY, JSON.stringify([makeSegments()[0]]));
      await kv.put(KV_KEYS.OFFERS + 'anonymous', JSON.stringify(makeOffersBundle({ coupons: [], loyalty: [], referrals: [], gifts: [] })));

      const existingSlug = buildOfferSlug('promo_summer', 'anonymous');
      mockedListItems.mockResolvedValueOnce([
        { id: 'existing_o1', fieldData: { slug: existingSlug, active: true }, isDraft: false, isArchived: false, createdOn: '', lastUpdated: '' },
      ]);
      mockedUpdateLiveItems.mockRejectedValueOnce(new Error('Webflow API error 429'));

      const result = await syncOffersToCMS(env);

      expect(result.updated).toBe(0);
      expect(result.errors).toContain('Update failed: Webflow API error 429');
    });

    it('handles publish errors gracefully', async () => {
      const collectionIds = { treatments: 'col_t', pricing: 'col_p', segments: 'col_s', offers: 'col_o' };
      await kv.put(KV_KEYS.CMS_COLLECTION_IDS, JSON.stringify(collectionIds));
      await kv.put(KV_KEYS.SEGMENTS_REGISTRY, JSON.stringify([makeSegments()[0]]));
      await kv.put(KV_KEYS.OFFERS + 'anonymous', JSON.stringify(makeOffersBundle()));

      mockedListItems
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 'o1', fieldData: {}, isDraft: false, isArchived: false, createdOn: '', lastUpdated: '' }]);
      mockedCreateLiveItems.mockResolvedValueOnce([
        { id: 'o1', fieldData: {}, isDraft: false, isArchived: false, createdOn: '', lastUpdated: '' },
      ]);
      mockedPublishItems.mockRejectedValueOnce(new Error('Publish timeout'));

      const result = await syncOffersToCMS(env);

      expect(result.created).toBe(1);
      expect(result.errors).toContain('Publish failed: Publish timeout');
    });

    it('computes correct sort order (promotion > coupon)', async () => {
      const promoEntry = makeOfferEntry({ category: 'promotion' });
      const couponEntry = makeOfferEntry({ id: 'coupon_1', category: 'coupon' });
      const loyaltyEntry = makeOfferEntry({ id: 'loyalty_1', category: 'loyalty' });
      const referralEntry = makeOfferEntry({ id: 'ref_1', category: 'referral' });
      const giftEntry = makeOfferEntry({ id: 'gift_1', category: 'gift' });

      // Index 0 for all
      expect(computeSortOrder(promoEntry, 0)).toBe(600); // 500 + 100
      expect(computeSortOrder(couponEntry, 0)).toBe(500); // 400 + 100
      expect(computeSortOrder(loyaltyEntry, 0)).toBe(400); // 300 + 100
      expect(computeSortOrder(referralEntry, 0)).toBe(300); // 200 + 100
      expect(computeSortOrder(giftEntry, 0)).toBe(200); // 100 + 100

      // Higher index = lower sort (within category)
      expect(computeSortOrder(promoEntry, 5)).toBe(595); // 500 + 95
    });

    it('generates correct sanitized slugs', () => {
      expect(buildOfferSlug('promo_summer', 'anonymous')).toBe('promo-summer--anonymous');
      expect(buildOfferSlug('VOUCHER_ABC.123', 'member')).toBe('voucher-abc-123--member');
      expect(buildOfferSlug('simple', 'anon')).toBe('simple--anon');
    });

    it('flattens all fields correctly', () => {
      const entry = makeOfferEntry({
        id: 'loyalty_1',
        category: 'loyalty',
        title: 'Rewards',
        description: 'Earn points',
        discount: { type: 'NONE', label: '' },
        loyalty: { points: 500, balance: 350 },
        gift: { amount: 5000, balance: 3500 },
        applicableProductIds: ['prod-a', 'prod-b'],
        campaignName: 'Loyalty Program',
      });

      const fieldData = buildOfferFieldData(entry, 'member', 400);

      expect(fieldData.slug).toBe('loyalty-1--member');
      expect(fieldData.name).toBe('loyalty_1__member');
      expect(fieldData['offer-id']).toBe('loyalty_1');
      expect(fieldData.segment).toBe('member');
      expect(fieldData.category).toBe('loyalty');
      expect(fieldData.title).toBe('Rewards');
      expect(fieldData.description).toBe('Earn points');
      expect(fieldData['discount-type']).toBe('NONE');
      expect(fieldData['discount-label']).toBe('');
      expect(fieldData['loyalty-balance']).toBe(350);
      expect(fieldData['gift-balance']).toBe(35); // 3500 / 100
      expect(fieldData['applicable-products']).toBe('prod-a,prod-b');
      expect(fieldData['sort-order']).toBe(400);
      expect(fieldData.active).toBe(true);
      expect(fieldData['campaign-name']).toBe('Loyalty Program');
    });

    it('handles discount amount correctly (already in dollars from buildOfferDiscount)', () => {
      const entry = makeOfferEntry({
        discount: { type: 'AMOUNT', amountOff: 15, label: '$15 OFF' },
      });
      const fieldData = buildOfferFieldData(entry, 'anonymous', 500);
      expect(fieldData['discount-amount-off']).toBe(15);
      expect(fieldData['discount-percent-off']).toBe(0);
    });
  });

  // =====================================================
  // syncTreatmentsToCMS
  // =====================================================

  describe('syncTreatmentsToCMS', () => {
    it('creates treatment items from product catalog', async () => {
      const collectionIds = { treatments: 'col_t', pricing: 'col_p', segments: 'col_s', offers: 'col_o' };
      await kv.put(KV_KEYS.CMS_COLLECTION_IDS, JSON.stringify(collectionIds));
      await kv.put(KV_KEYS.PRODUCTS_CATALOG, JSON.stringify(makeProducts()));

      mockedListItems.mockResolvedValueOnce([]); // existing items
      mockedCreateLiveItems.mockResolvedValueOnce([
        { id: 't1', fieldData: { slug: 'hair-loss' } },
        { id: 't2', fieldData: { slug: 'weight-loss' } },
      ]);
      mockedPublishItems.mockResolvedValueOnce(undefined);

      await syncTreatmentsToCMS(env);

      expect(mockedCreateLiveItems).toHaveBeenCalledOnce();
      const createCall = mockedCreateLiveItems.mock.calls[0];
      expect(createCall[1]).toBe('col_t');
      expect(createCall[2]).toHaveLength(2);
      expect(mockedPublishItems).toHaveBeenCalledOnce();
    });

    it('updates existing treatments', async () => {
      const collectionIds = { treatments: 'col_t', pricing: 'col_p', segments: 'col_s', offers: 'col_o' };
      await kv.put(KV_KEYS.CMS_COLLECTION_IDS, JSON.stringify(collectionIds));
      await kv.put(KV_KEYS.PRODUCTS_CATALOG, JSON.stringify({ 'hair-loss': { basePrice: 60, lastSeen: Date.now() } }));

      mockedListItems.mockResolvedValueOnce([
        { id: 'existing_t1', fieldData: { slug: 'hair-loss' }, isDraft: false, isArchived: false, createdOn: '', lastUpdated: '' },
      ]);
      mockedUpdateLiveItems.mockResolvedValueOnce(undefined);
      mockedPublishItems.mockResolvedValueOnce(undefined);

      await syncTreatmentsToCMS(env);

      expect(mockedCreateLiveItems).not.toHaveBeenCalled();
      expect(mockedUpdateLiveItems).toHaveBeenCalledOnce();
    });

    it('does nothing when no collection IDs', async () => {
      mockedListCollections.mockResolvedValueOnce([]);
      await syncTreatmentsToCMS(env);
      expect(mockedListItems).not.toHaveBeenCalled();
    });

    it('does nothing when product catalog is empty', async () => {
      const collectionIds = { treatments: 'col_t', pricing: 'col_p', segments: 'col_s', offers: 'col_o' };
      await kv.put(KV_KEYS.CMS_COLLECTION_IDS, JSON.stringify(collectionIds));
      // No products

      await syncTreatmentsToCMS(env);
      expect(mockedListItems).not.toHaveBeenCalled();
    });
  });

  // =====================================================
  // syncSegmentsToCMS
  // =====================================================

  describe('syncSegmentsToCMS', () => {
    it('creates segment items', async () => {
      const collectionIds = { treatments: 'col_t', pricing: 'col_p', segments: 'col_s', offers: 'col_o' };
      await kv.put(KV_KEYS.CMS_COLLECTION_IDS, JSON.stringify(collectionIds));
      await kv.put(KV_KEYS.SEGMENTS_REGISTRY, JSON.stringify(makeSegments()));

      mockedListItems.mockResolvedValueOnce([]);
      mockedCreateLiveItems.mockResolvedValueOnce([
        { id: 's1', fieldData: { slug: 'anonymous' } },
        { id: 's2', fieldData: { slug: 'member' } },
      ]);
      mockedPublishItems.mockResolvedValueOnce(undefined);

      await syncSegmentsToCMS(env);

      expect(mockedCreateLiveItems).toHaveBeenCalledOnce();
      const createCall = mockedCreateLiveItems.mock.calls[0];
      expect(createCall[2]).toHaveLength(2);
      // Verify is-default flag
      expect(createCall[2][0].fieldData['is-default']).toBe(true);
      expect(createCall[2][1].fieldData['is-default']).toBe(true);
    });

    it('does nothing when no collection IDs', async () => {
      mockedListCollections.mockResolvedValueOnce([]);
      await syncSegmentsToCMS(env);
      expect(mockedListItems).not.toHaveBeenCalled();
    });

    it('does nothing when no segments', async () => {
      const collectionIds = { treatments: 'col_t', pricing: 'col_p', segments: 'col_s', offers: 'col_o' };
      await kv.put(KV_KEYS.CMS_COLLECTION_IDS, JSON.stringify(collectionIds));
      // No segments registry

      await syncSegmentsToCMS(env);
      expect(mockedListItems).not.toHaveBeenCalled();
    });
  });

  // =====================================================
  // getCMSStatus
  // =====================================================

  describe('getCMSStatus', () => {
    it('returns status with collections and counts', async () => {
      const collectionIds = { treatments: 'col_t', pricing: 'col_p', segments: 'col_s', offers: 'col_o' };
      await kv.put(KV_KEYS.CMS_COLLECTION_IDS, JSON.stringify(collectionIds));
      await kv.put(KV_KEYS.META_LAST_CMS_SYNC, '2026-03-19T00:00:00Z');

      mockedListItems
        .mockResolvedValueOnce([{ id: 't1' }, { id: 't2' }] as any)
        .mockResolvedValueOnce([{ id: 'p1' }] as any)
        .mockResolvedValueOnce([{ id: 's1' }, { id: 's2' }] as any)
        .mockResolvedValueOnce([{ id: 'o1' }, { id: 'o2' }, { id: 'o3' }] as any);

      const status = await getCMSStatus(env);

      expect(status.enabled).toBe(true);
      expect(status.collections).toEqual(collectionIds);
      expect(status.lastSync).toBe('2026-03-19T00:00:00Z');
      expect(status.itemCounts).toEqual({ treatments: 2, pricing: 1, segments: 2, offers: 3 });
    });

    it('returns minimal status when no collections set up', async () => {
      const status = await getCMSStatus(env);

      expect(status.enabled).toBe(true);
      expect(status.collections).toBeNull();
      expect(status.lastSync).toBeNull();
      expect(status.itemCounts).toBeNull();
    });

    it('returns enabled=false when CMS_SYNC_ENABLED is false', async () => {
      env = mockEnv({ PRICING_KV: kv as unknown as KVNamespace, CMS_SYNC_ENABLED: 'false' });

      const status = await getCMSStatus(env);
      expect(status.enabled).toBe(false);
    });

    it('handles listItems failure gracefully', async () => {
      const collectionIds = { treatments: 'col_t', pricing: 'col_p', segments: 'col_s', offers: 'col_o' };
      await kv.put(KV_KEYS.CMS_COLLECTION_IDS, JSON.stringify(collectionIds));

      mockedListItems.mockRejectedValue(new Error('Network error'));

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const status = await getCMSStatus(env);

      expect(status.collections).toEqual(collectionIds);
      expect(status.itemCounts).toBeNull();
      consoleSpy.mockRestore();
    });
  });
});
