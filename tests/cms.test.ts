import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  setupCollections,
  syncCategoriesToCMS,
  syncProductsToCMS,
  syncSegmentsToCMS,
  syncOfferCollectionToCMS,
  performCMSSync,
  computeSortOrder,
  buildOfferCollectionFieldData,
  mergeOffersByCategory,
  getCMSStatus,
} from '@/cms';
import type { MergedOffer } from '@/cms';
import { KV_KEYS } from '@/config';
import { mockEnv } from './helpers/fixtures';
import { MockKV } from './helpers/mock-kv';
import type { Env, PricingEntry, ProductEntry, SegmentDefinition, OfferEntry, OffersBundle, CMSCollectionIds } from '@/types';

// Mock webflow-client module
vi.mock('@/webflow-client', () => ({
  listCollections: vi.fn(),
  createCollection: vi.fn(),
  createField: vi.fn(),
  createFieldMultiRef: vi.fn(),
  listItems: vi.fn(),
  createItems: vi.fn(),
  updateItems: vi.fn(),
  publishSite: vi.fn(),
}));

import {
  listCollections,
  createCollection,
  createField,
  createFieldMultiRef,
  listItems,
  createItems,
  updateItems,
  publishSite,
} from '@/webflow-client';

const mockedListCollections = vi.mocked(listCollections);
const mockedCreateCollection = vi.mocked(createCollection);
const mockedCreateField = vi.mocked(createField);
const mockedCreateFieldMultiRef = vi.mocked(createFieldMultiRef);
const mockedListItems = vi.mocked(listItems);
const mockedCreateItems = vi.mocked(createItems);
const mockedUpdateItems = vi.mocked(updateItems);
const mockedPublishSite = vi.mocked(publishSite);

// --- Test data ---

const COLLECTION_KEYS = [
  'products', 'categories', 'segments', 'discountCoupons', 'vouchers',
  'referralCodes', 'promotions', 'loyaltyPrograms',
] as const;

function makeCollectionIds(overrides: Partial<CMSCollectionIds> = {}): CMSCollectionIds {
  return {
    products: 'col_prod',
    categories: 'col_cat',
    segments: 'col_s',
    discountCoupons: 'col_dc',
    vouchers: 'col_v',
    referralCodes: 'col_rc',
    promotions: 'col_p',
    loyaltyPrograms: 'col_lp',
    ...overrides,
  };
}

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
    it('creates all eight collections when none exist', async () => {
      mockedListCollections.mockResolvedValueOnce([]);
      mockedCreateCollection
        .mockResolvedValueOnce({ id: 'col_cat', displayName: 'Categories', singularName: 'Category', slug: 'categories', fields: [] })
        .mockResolvedValueOnce({ id: 'col_prod', displayName: 'Products', singularName: 'Product', slug: 'products', fields: [] })
        .mockResolvedValueOnce({ id: 'col_seg', displayName: 'Segments', singularName: 'Segment', slug: 'segments', fields: [] })
        .mockResolvedValueOnce({ id: 'col_dc', displayName: 'Discount Coupons', singularName: 'Discount Coupon', slug: 'discount-coupons', fields: [] })
        .mockResolvedValueOnce({ id: 'col_v', displayName: 'Vouchers', singularName: 'Voucher', slug: 'vouchers', fields: [] })
        .mockResolvedValueOnce({ id: 'col_rc', displayName: 'Referral Codes', singularName: 'Referral Code', slug: 'referral-codes', fields: [] })
        .mockResolvedValueOnce({ id: 'col_p', displayName: 'Promotions', singularName: 'Promotion', slug: 'promotions', fields: [] })
        .mockResolvedValueOnce({ id: 'col_lp', displayName: 'Loyalty Programs', singularName: 'Loyalty Program', slug: 'loyalty-programs', fields: [] });
      mockedCreateField.mockResolvedValue({ id: 'f1', type: 'PlainText', slug: 'test', displayName: 'Test' });
      mockedCreateFieldMultiRef.mockResolvedValue({ id: 'f_ref', type: 'ItemRefSet', slug: 'ref', displayName: 'Ref' });

      const ids = await setupCollections(env);

      expect(ids).toEqual({
        products: 'col_prod',
        categories: 'col_cat',
        segments: 'col_seg',
        discountCoupons: 'col_dc',
        vouchers: 'col_v',
        referralCodes: 'col_rc',
        promotions: 'col_p',
        loyaltyPrograms: 'col_lp',
      });
      expect(mockedCreateCollection).toHaveBeenCalledTimes(8);
      // Categories: 2 fields, Products: 13 (11+2 default-text/default-price), Segments: 2, 4 offer collections: 13 each = 52, Loyalty: 13+3=16
      // Total: 2 + 13 + 2 + 52 + 16 = 85
      // +1 ensureField for offer-type on loyaltyPrograms = 86
      expect(mockedCreateField).toHaveBeenCalledTimes(86);
      // 1 Products→Categories + 5 offer collections × 2 ensureFieldMultiRef calls = 11
      expect(mockedCreateFieldMultiRef).toHaveBeenCalledTimes(11);

      // Verify stored in KV
      const stored = await kv.get(KV_KEYS.CMS_COLLECTION_IDS, 'json');
      expect(stored).toEqual(ids);
    });

    it('reuses existing collections by slug and ensures multi-ref fields', async () => {
      mockedListCollections.mockResolvedValueOnce([
        { id: 'e_cat', displayName: 'Categories', singularName: 'Category', slug: 'categories', fields: [] },
        { id: 'e_prod', displayName: 'Products', singularName: 'Product', slug: 'products', fields: [] },
        { id: 'e_seg', displayName: 'Segments', singularName: 'Segment', slug: 'segments', fields: [] },
        { id: 'e_dc', displayName: 'Discount Coupons', singularName: 'Discount Coupon', slug: 'discount-coupons', fields: [] },
        { id: 'e_v', displayName: 'Vouchers', singularName: 'Voucher', slug: 'vouchers', fields: [] },
        { id: 'e_rc', displayName: 'Referral Codes', singularName: 'Referral Code', slug: 'referral-codes', fields: [] },
        { id: 'e_p', displayName: 'Promotions', singularName: 'Promotion', slug: 'promotions', fields: [] },
        { id: 'e_lp', displayName: 'Loyalty Programs', singularName: 'Loyalty Program', slug: 'loyalty-programs', fields: [] },
      ]);
      mockedCreateFieldMultiRef.mockResolvedValue({ id: 'f_ref', type: 'ItemRefSet', slug: 'ref', displayName: 'Ref' });
      mockedCreateField.mockResolvedValue({ id: 'f1', type: 'PlainText', slug: 'test', displayName: 'Test' });

      const ids = await setupCollections(env);

      expect(ids).toEqual({
        products: 'e_prod',
        categories: 'e_cat',
        segments: 'e_seg',
        discountCoupons: 'e_dc',
        vouchers: 'e_v',
        referralCodes: 'e_rc',
        promotions: 'e_p',
        loyaltyPrograms: 'e_lp',
      });
      expect(mockedCreateCollection).not.toHaveBeenCalled();
      // 1 Products→Categories + 5 offer collections × 2 ensureFieldMultiRef = 11
      expect(mockedCreateFieldMultiRef).toHaveBeenCalledTimes(11);
      // 1 ensureField call for offer-type on loyaltyPrograms
      expect(mockedCreateField).toHaveBeenCalledTimes(1);
    });

    it('creates only missing collections and adds multi-ref fields to new offer collections', async () => {
      mockedListCollections.mockResolvedValueOnce([
        { id: 'e_cat', displayName: 'Categories', singularName: 'Category', slug: 'categories', fields: [] },
        { id: 'e_prod', displayName: 'Products', singularName: 'Product', slug: 'products', fields: [] },
        { id: 'e_seg', displayName: 'Segments', singularName: 'Segment', slug: 'segments', fields: [] },
        { id: 'e_dc', displayName: 'Discount Coupons', singularName: 'Discount Coupon', slug: 'discount-coupons', fields: [] },
      ]);
      mockedCreateCollection
        .mockResolvedValueOnce({ id: 'col_v', displayName: 'Vouchers', singularName: 'Voucher', slug: 'vouchers', fields: [] })
        .mockResolvedValueOnce({ id: 'col_rc', displayName: 'Referral Codes', singularName: 'Referral Code', slug: 'referral-codes', fields: [] })
        .mockResolvedValueOnce({ id: 'col_p', displayName: 'Promotions', singularName: 'Promotion', slug: 'promotions', fields: [] })
        .mockResolvedValueOnce({ id: 'col_lp', displayName: 'Loyalty Programs', singularName: 'Loyalty Program', slug: 'loyalty-programs', fields: [] });
      mockedCreateField.mockResolvedValue({ id: 'f1', type: 'PlainText', slug: 'test', displayName: 'Test' });
      mockedCreateFieldMultiRef.mockResolvedValue({ id: 'f_ref', type: 'ItemRefSet', slug: 'ref', displayName: 'Ref' });

      const ids = await setupCollections(env);

      expect(ids.products).toBe('e_prod');
      expect(ids.categories).toBe('e_cat');
      expect(ids.segments).toBe('e_seg');
      expect(ids.discountCoupons).toBe('e_dc');
      expect(ids.vouchers).toBe('col_v');
      expect(ids.referralCodes).toBe('col_rc');
      expect(ids.promotions).toBe('col_p');
      expect(ids.loyaltyPrograms).toBe('col_lp');
      expect(mockedCreateCollection).toHaveBeenCalledTimes(4);
      // 1 Products→Categories + 5 offer collections × 2 ensureFieldMultiRef = 11
      expect(mockedCreateFieldMultiRef).toHaveBeenCalledTimes(11);
    });

    it('ignores 409 from createFieldMultiRef', async () => {
      mockedListCollections.mockResolvedValueOnce([
        { id: 'e_cat', displayName: 'Categories', singularName: 'Category', slug: 'categories', fields: [] },
        { id: 'e_prod', displayName: 'Products', singularName: 'Product', slug: 'products', fields: [] },
        { id: 'e_seg', displayName: 'Segments', singularName: 'Segment', slug: 'segments', fields: [] },
        { id: 'e_dc', displayName: 'Discount Coupons', singularName: 'Discount Coupon', slug: 'discount-coupons', fields: [] },
        { id: 'e_v', displayName: 'Vouchers', singularName: 'Voucher', slug: 'vouchers', fields: [] },
        { id: 'e_rc', displayName: 'Referral Codes', singularName: 'Referral Code', slug: 'referral-codes', fields: [] },
        { id: 'e_p', displayName: 'Promotions', singularName: 'Promotion', slug: 'promotions', fields: [] },
        { id: 'e_lp', displayName: 'Loyalty Programs', singularName: 'Loyalty Program', slug: 'loyalty-programs', fields: [] },
      ]);
      mockedCreateFieldMultiRef.mockRejectedValue(new Error('Webflow API error 409: field already exists'));
      mockedCreateField.mockResolvedValue({ id: 'f1', type: 'PlainText', slug: 'test', displayName: 'Test' });

      // Should not throw — 409 is swallowed
      const ids = await setupCollections(env);
      expect(ids.products).toBe('e_prod');
      expect(mockedCreateFieldMultiRef).toHaveBeenCalledTimes(11);
    });

    it('propagates non-409 errors from createFieldMultiRef', async () => {
      mockedListCollections.mockResolvedValueOnce([
        { id: 'e_cat', displayName: 'Categories', singularName: 'Category', slug: 'categories', fields: [] },
        { id: 'e_prod', displayName: 'Products', singularName: 'Product', slug: 'products', fields: [] },
        { id: 'e_seg', displayName: 'Segments', singularName: 'Segment', slug: 'segments', fields: [] },
        { id: 'e_dc', displayName: 'Discount Coupons', singularName: 'Discount Coupon', slug: 'discount-coupons', fields: [] },
        { id: 'e_v', displayName: 'Vouchers', singularName: 'Voucher', slug: 'vouchers', fields: [] },
        { id: 'e_rc', displayName: 'Referral Codes', singularName: 'Referral Code', slug: 'referral-codes', fields: [] },
        { id: 'e_p', displayName: 'Promotions', singularName: 'Promotion', slug: 'promotions', fields: [] },
        { id: 'e_lp', displayName: 'Loyalty Programs', singularName: 'Loyalty Program', slug: 'loyalty-programs', fields: [] },
      ]);
      mockedCreateFieldMultiRef.mockRejectedValue(new Error('Webflow API error 500: internal error'));
      mockedCreateField.mockResolvedValue({ id: 'f1', type: 'PlainText', slug: 'test', displayName: 'Test' });

      await expect(setupCollections(env)).rejects.toThrow('500');
    });
  });

  // =====================================================
  // mergeOffersByCategory
  // =====================================================

  describe('mergeOffersByCategory', () => {
    it('groups offers by category and deduplicates across segments', () => {
      const promoEntry = makeOfferEntry({ id: 'promo_1', category: 'promotion' });
      const couponEntry = makeOfferEntry({ id: 'coupon_1', category: 'coupon' });

      const results = [
        {
          key: 'anonymous',
          bundle: { promotions: [promoEntry], coupons: [couponEntry], loyalty: [], referrals: [], gifts: [] },
        },
        {
          key: 'member',
          bundle: { promotions: [promoEntry], coupons: [], loyalty: [], referrals: [], gifts: [] },
        },
      ];

      const merged = mergeOffersByCategory(results);

      // Promo goes to promotions collection
      const promos = merged.get('promotions')!;
      expect(promos.size).toBe(1);
      expect(promos.get('promo_1')!.segmentKeys).toEqual(new Set(['anonymous', 'member']));

      // Coupon goes to discountCoupons collection
      const coupons = merged.get('discountCoupons')!;
      expect(coupons.size).toBe(1);
      expect(coupons.get('coupon_1')!.segmentKeys).toEqual(new Set(['anonymous']));
    });

    it('maps gift category to loyaltyPrograms collection', () => {
      const giftEntry = makeOfferEntry({
        id: 'gift_1',
        category: 'gift',
        gift: { amount: 5000, balance: 3500 },
      });

      const merged = mergeOffersByCategory([
        { key: 'member', bundle: { promotions: [], coupons: [], loyalty: [], referrals: [], gifts: [giftEntry] } },
      ]);

      expect(merged.has('loyaltyPrograms')).toBe(true);
      expect(merged.get('loyaltyPrograms')!.has('gift_1')).toBe(true);
    });

    it('skips null bundles', () => {
      const merged = mergeOffersByCategory([
        { key: 'anonymous', bundle: null },
        { key: 'member', bundle: null },
      ]);

      expect(merged.size).toBe(0);
    });

    it('handles empty bundles', () => {
      const merged = mergeOffersByCategory([
        { key: 'anonymous', bundle: { promotions: [], coupons: [], loyalty: [], referrals: [], gifts: [] } },
      ]);

      expect(merged.size).toBe(0);
    });
  });

  // =====================================================
  // buildOfferCollectionFieldData
  // =====================================================

  describe('buildOfferCollectionFieldData', () => {
    it('builds field data with multi-ref arrays', () => {
      const entry = makeOfferEntry({
        id: 'promo_summer',
        title: 'Summer Sale',
        applicableProductIds: ['hair-loss', 'weight-loss'],
      });

      const fieldData = buildOfferCollectionFieldData(
        entry,
        ['seg_id_1', 'seg_id_2'],
        ['treat_id_1', 'treat_id_2'],
        500,
      );

      expect(fieldData.slug).toBe('promo-summer');
      expect(fieldData.name).toBe('Summer Sale');
      expect(fieldData['offer-id']).toBe('promo_summer');
      expect(fieldData.products).toEqual(['treat_id_1', 'treat_id_2']);
      expect(fieldData.segments).toEqual(['seg_id_1', 'seg_id_2']);
      expect(fieldData['sort-order']).toBe(500);
      expect(fieldData.active).toBe(true);
    });

    it('includes loyalty fields for loyalty entries', () => {
      const entry = makeOfferEntry({
        id: 'loyalty_1',
        category: 'loyalty',
        loyalty: { points: 500, balance: 350 },
      });

      const fieldData = buildOfferCollectionFieldData(entry, [], [], 300);

      expect(fieldData['loyalty-balance']).toBe(350);
      expect(fieldData['gift-balance']).toBeUndefined();
    });

    it('includes gift balance for gift entries', () => {
      const entry = makeOfferEntry({
        id: 'gift_1',
        category: 'gift',
        gift: { amount: 5000, balance: 3500 },
      });

      const fieldData = buildOfferCollectionFieldData(entry, [], [], 100);

      expect(fieldData['gift-balance']).toBe(35); // 3500 / 100
    });

    it('omits loyalty/gift fields for non-loyalty entries', () => {
      const entry = makeOfferEntry({ id: 'coupon_1', category: 'coupon' });

      const fieldData = buildOfferCollectionFieldData(entry, [], [], 400);

      expect(fieldData['loyalty-balance']).toBeUndefined();
      expect(fieldData['gift-balance']).toBeUndefined();
    });

    it('sets offer-type for loyalty entries', () => {
      const entry = makeOfferEntry({
        id: 'loyalty_1',
        category: 'loyalty',
        loyalty: { points: 500, balance: 350 },
      });

      const fieldData = buildOfferCollectionFieldData(entry, [], [], 300);

      expect(fieldData['offer-type']).toBe('loyalty');
    });

    it('sets offer-type for gift entries', () => {
      const entry = makeOfferEntry({
        id: 'gift_1',
        category: 'gift',
        gift: { amount: 5000, balance: 3500 },
      });

      const fieldData = buildOfferCollectionFieldData(entry, [], [], 100);

      expect(fieldData['offer-type']).toBe('gift');
    });

    it('does not set offer-type for non-loyalty entries', () => {
      const entry = makeOfferEntry({ id: 'coupon_1', category: 'coupon' });

      const fieldData = buildOfferCollectionFieldData(entry, [], [], 400);

      expect(fieldData['offer-type']).toBeUndefined();
    });

    it('handles discount amount correctly', () => {
      const entry = makeOfferEntry({
        discount: { type: 'AMOUNT', amountOff: 15, label: '$15 OFF' },
      });
      const fieldData = buildOfferCollectionFieldData(entry, [], [], 500);
      expect(fieldData['discount-amount-off']).toBe(15);
      expect(fieldData['discount-percent-off']).toBe(0);
    });

    it('computes correct sort order (promotion > coupon)', () => {
      const promoEntry = makeOfferEntry({ category: 'promotion' });
      const couponEntry = makeOfferEntry({ id: 'coupon_1', category: 'coupon' });
      const loyaltyEntry = makeOfferEntry({ id: 'loyalty_1', category: 'loyalty' });
      const referralEntry = makeOfferEntry({ id: 'ref_1', category: 'referral' });
      const giftEntry = makeOfferEntry({ id: 'gift_1', category: 'gift' });

      expect(computeSortOrder(promoEntry, 0)).toBe(600); // 500 + 100
      expect(computeSortOrder(couponEntry, 0)).toBe(500); // 400 + 100
      expect(computeSortOrder(loyaltyEntry, 0)).toBe(400); // 300 + 100
      expect(computeSortOrder(referralEntry, 0)).toBe(300); // 200 + 100
      expect(computeSortOrder(giftEntry, 0)).toBe(200); // 100 + 100

      // Higher index = lower sort (within category)
      expect(computeSortOrder(promoEntry, 5)).toBe(595); // 500 + 95
    });
  });

  // =====================================================
  // syncOfferCollectionToCMS
  // =====================================================

  describe('syncOfferCollectionToCMS', () => {
    it('creates new items when collection is empty', async () => {
      const offers = new Map<string, MergedOffer>([
        ['promo_1', {
          entry: makeOfferEntry({ id: 'promo_1', category: 'promotion', applicableProductIds: ['hair-loss'] }),
          segmentKeys: new Set(['anonymous', 'member']),
        }],
      ]);

      const productMap = new Map([['hair-loss', 'wf_prod_1']]);
      const segmentMap = new Map([['anonymous', 'wf_seg_1'], ['member', 'wf_seg_2']]);

      mockedListItems.mockResolvedValueOnce([]);
      mockedCreateItems.mockResolvedValueOnce([
        { id: 'o1', fieldData: {}, isDraft: false, isArchived: false, createdOn: '', lastUpdated: '' },
      ]);

      const result = await syncOfferCollectionToCMS(env, 'col_p', offers, productMap, segmentMap);

      expect(result.created).toBe(1);
      expect(result.updated).toBe(0);
      expect(result.errors).toEqual([]);

      // Verify multi-ref arrays in create call
      const createCall = mockedCreateItems.mock.calls[0];
      const fieldData = createCall[2][0].fieldData;
      expect(fieldData.products).toEqual(['wf_prod_1']);
      expect(fieldData.segments).toEqual(expect.arrayContaining(['wf_seg_1', 'wf_seg_2']));
    });

    it('updates existing items by slug match', async () => {
      const offers = new Map<string, MergedOffer>([
        ['promo_1', {
          entry: makeOfferEntry({ id: 'promo_1', category: 'promotion' }),
          segmentKeys: new Set(['anonymous']),
        }],
      ]);

      mockedListItems.mockResolvedValueOnce([
        { id: 'existing_1', fieldData: { slug: 'promo-1', active: true }, isDraft: false, isArchived: false, createdOn: '', lastUpdated: '' },
      ]);
      mockedUpdateItems.mockResolvedValueOnce(undefined);

      const result = await syncOfferCollectionToCMS(env, 'col_p', offers, new Map(), new Map());

      expect(result.created).toBe(0);
      expect(result.updated).toBe(1);
      expect(mockedCreateItems).not.toHaveBeenCalled();
    });

    it('deactivates stale items', async () => {
      const offers = new Map<string, MergedOffer>(); // empty — no current offers

      mockedListItems.mockResolvedValueOnce([
        { id: 'stale_1', fieldData: { slug: 'old-promo', active: true }, isDraft: false, isArchived: false, createdOn: '', lastUpdated: '' },
      ]);
      mockedUpdateItems.mockResolvedValueOnce(undefined);

      const result = await syncOfferCollectionToCMS(env, 'col_p', offers, new Map(), new Map());

      expect(result.updated).toBe(1);
      const updateCall = mockedUpdateItems.mock.calls[0];
      expect(updateCall[2][0].fieldData.active).toBe(false);
    });

    it('skips already-inactive items during stale cleanup', async () => {
      const offers = new Map<string, MergedOffer>();

      mockedListItems.mockResolvedValueOnce([
        { id: 'stale_1', fieldData: { slug: 'old-promo', active: false }, isDraft: false, isArchived: false, createdOn: '', lastUpdated: '' },
      ]);

      const result = await syncOfferCollectionToCMS(env, 'col_p', offers, new Map(), new Map());

      expect(result.created).toBe(0);
      expect(result.updated).toBe(0);
      expect(mockedUpdateItems).not.toHaveBeenCalled();
    });

    it('handles create errors gracefully', async () => {
      const offers = new Map<string, MergedOffer>([
        ['promo_1', {
          entry: makeOfferEntry({ id: 'promo_1' }),
          segmentKeys: new Set(['anonymous']),
        }],
      ]);

      mockedListItems.mockResolvedValueOnce([]);
      mockedCreateItems.mockRejectedValueOnce(new Error('Webflow API error 500'));

      const result = await syncOfferCollectionToCMS(env, 'col_p', offers, new Map(), new Map());

      expect(result.created).toBe(0);
      expect(result.errors).toContain('Create failed: Webflow API error 500');
    });

    it('handles update errors gracefully', async () => {
      const offers = new Map<string, MergedOffer>([
        ['promo_1', {
          entry: makeOfferEntry({ id: 'promo_1' }),
          segmentKeys: new Set(['anonymous']),
        }],
      ]);

      mockedListItems.mockResolvedValueOnce([
        { id: 'existing_1', fieldData: { slug: 'promo-1', active: true }, isDraft: false, isArchived: false, createdOn: '', lastUpdated: '' },
      ]);
      mockedUpdateItems.mockRejectedValueOnce(new Error('Webflow API error 429'));

      const result = await syncOfferCollectionToCMS(env, 'col_p', offers, new Map(), new Map());

      expect(result.updated).toBe(0);
      expect(result.errors).toContain('Update failed: Webflow API error 429');
    });

    it('resolves product and segment references correctly', async () => {
      const offers = new Map<string, MergedOffer>([
        ['promo_1', {
          entry: makeOfferEntry({
            id: 'promo_1',
            applicableProductIds: ['hair-loss', 'unknown-product'],
          }),
          segmentKeys: new Set(['anonymous', 'nonexistent-segment']),
        }],
      ]);

      const productMap = new Map([['hair-loss', 'wf_t1']]);
      const segmentMap = new Map([['anonymous', 'wf_s1']]);

      mockedListItems.mockResolvedValueOnce([]);
      mockedCreateItems.mockResolvedValueOnce([
        { id: 'o1', fieldData: {}, isDraft: false, isArchived: false, createdOn: '', lastUpdated: '' },
      ]);

      await syncOfferCollectionToCMS(env, 'col_p', offers, productMap, segmentMap);

      const createCall = mockedCreateItems.mock.calls[0];
      const fieldData = createCall[2][0].fieldData;
      // Only resolved IDs included (unknown ones filtered out)
      expect(fieldData.products).toEqual(['wf_t1']);
      expect(fieldData.segments).toEqual(['wf_s1']);
    });
  });

  // =====================================================
  // syncCategoriesToCMS
  // =====================================================

  describe('syncCategoriesToCMS', () => {
    it('creates category items from DEFAULT_CATEGORIES', async () => {
      const collectionIds = makeCollectionIds();
      await kv.put(KV_KEYS.CMS_COLLECTION_IDS, JSON.stringify(collectionIds));

      mockedListItems.mockResolvedValueOnce([]);
      mockedCreateItems.mockResolvedValueOnce([
        { id: 'cat1', fieldData: { slug: 'treatment' }, isDraft: false, isArchived: false, createdOn: '', lastUpdated: '' },
      ]);

      await syncCategoriesToCMS(env);

      expect(mockedCreateItems).toHaveBeenCalledOnce();
      const createCall = mockedCreateItems.mock.calls[0];
      expect(createCall[1]).toBe('col_cat');
      expect(createCall[2]).toHaveLength(1);
      expect(createCall[2][0].fieldData.name).toBe('Treatment');
      expect(createCall[2][0].fieldData.slug).toBe('treatment');
      expect(createCall[2][0].fieldData.description).toBe('Prescription treatments');
      expect(createCall[2][0].fieldData.active).toBe(true);
    });

    it('updates existing category items by slug match', async () => {
      const collectionIds = makeCollectionIds();
      await kv.put(KV_KEYS.CMS_COLLECTION_IDS, JSON.stringify(collectionIds));

      mockedListItems.mockResolvedValueOnce([
        { id: 'existing_cat1', fieldData: { slug: 'treatment' }, isDraft: false, isArchived: false, createdOn: '', lastUpdated: '' },
      ]);
      mockedUpdateItems.mockResolvedValueOnce(undefined);

      await syncCategoriesToCMS(env);

      expect(mockedCreateItems).not.toHaveBeenCalled();
      expect(mockedUpdateItems).toHaveBeenCalledOnce();
    });

    it('does nothing when no collection IDs', async () => {
      mockedListCollections.mockResolvedValueOnce([]);
      await syncCategoriesToCMS(env);
      expect(mockedListItems).not.toHaveBeenCalled();
    });

    it('does nothing when categories collection ID is empty', async () => {
      const collectionIds = makeCollectionIds({ categories: '' });
      await kv.put(KV_KEYS.CMS_COLLECTION_IDS, JSON.stringify(collectionIds));

      await syncCategoriesToCMS(env);
      expect(mockedListItems).not.toHaveBeenCalled();
    });
  });

  // =====================================================
  // syncProductsToCMS
  // =====================================================

  describe('syncProductsToCMS', () => {
    it('creates product items with embedded pricing from anonymous segment', async () => {
      const collectionIds = makeCollectionIds();
      await kv.put(KV_KEYS.CMS_COLLECTION_IDS, JSON.stringify(collectionIds));
      await kv.put(KV_KEYS.PRODUCTS_CATALOG, JSON.stringify(makeProducts()));
      await kv.put(KV_KEYS.PRICES + 'anonymous', JSON.stringify({
        'hair-loss': makePricingEntry(),
        'weight-loss': makePricingEntry({ basePrice: 100, discountedPrice: 100, discountAmount: 0, discountLabel: '', discountType: 'NONE' }),
      }));

      const categorySlugToId = new Map([['treatment', 'wf_cat_1']]);

      mockedListItems.mockResolvedValueOnce([]); // existing items
      mockedCreateItems.mockResolvedValueOnce([
        { id: 't1', fieldData: { slug: 'hair-loss' } },
        { id: 't2', fieldData: { slug: 'weight-loss' } },
      ]);

      await syncProductsToCMS(env, categorySlugToId);

      expect(mockedCreateItems).toHaveBeenCalledOnce();
      const createCall = mockedCreateItems.mock.calls[0];
      expect(createCall[1]).toBe('col_prod');
      expect(createCall[2]).toHaveLength(2);

      // Hair-loss has a discount
      const hairLoss = createCall[2].find((i: any) => i.fieldData.slug === 'hair-loss');
      expect(hairLoss.fieldData['discounted-price']).toBe(30);
      expect(hairLoss.fieldData['discount-label']).toBe('50% OFF');
      expect(hairLoss.fieldData['has-discount']).toBe(true);
      expect(hairLoss.fieldData['formatted-price']).toBe('$60 $30 (50% OFF)');
      expect(hairLoss.fieldData['campaign-name']).toBe('Summer Sale');
      expect(hairLoss.fieldData.category).toBe('treatment');
      expect(hairLoss.fieldData.categories).toEqual(['wf_cat_1']);

      // Weight-loss has no discount
      const weightLoss = createCall[2].find((i: any) => i.fieldData.slug === 'weight-loss');
      expect(weightLoss.fieldData['discounted-price']).toBe(100);
      expect(weightLoss.fieldData['discount-label']).toBe('');
      expect(weightLoss.fieldData['has-discount']).toBe(false);
      expect(weightLoss.fieldData['formatted-price']).toBe('$100');
      expect(weightLoss.fieldData.category).toBe('treatment');
      expect(weightLoss.fieldData.categories).toEqual(['wf_cat_1']);

      expect(mockedPublishSite).not.toHaveBeenCalled();
    });

    it('sets defaults when no anonymous pricing exists', async () => {
      const collectionIds = makeCollectionIds();
      await kv.put(KV_KEYS.CMS_COLLECTION_IDS, JSON.stringify(collectionIds));
      await kv.put(KV_KEYS.PRODUCTS_CATALOG, JSON.stringify({ 'hair-loss': { basePrice: 60, lastSeen: Date.now() } }));
      // No pricing data

      const categorySlugToId = new Map([['treatment', 'wf_cat_1']]);

      mockedListItems.mockResolvedValueOnce([]);
      mockedCreateItems.mockResolvedValueOnce([
        { id: 't1', fieldData: { slug: 'hair-loss' } },
      ]);

      await syncProductsToCMS(env, categorySlugToId);

      const createCall = mockedCreateItems.mock.calls[0];
      const item = createCall[2][0];
      expect(item.fieldData['discounted-price']).toBe(60); // falls back to base price
      expect(item.fieldData['discount-amount']).toBe(0);
      expect(item.fieldData['has-discount']).toBe(false);
      expect(item.fieldData['formatted-price']).toBe('$60');
    });

    it('updates existing products', async () => {
      const collectionIds = makeCollectionIds();
      await kv.put(KV_KEYS.CMS_COLLECTION_IDS, JSON.stringify(collectionIds));
      await kv.put(KV_KEYS.PRODUCTS_CATALOG, JSON.stringify({ 'hair-loss': { basePrice: 60, lastSeen: Date.now() } }));

      mockedListItems.mockResolvedValueOnce([
        { id: 'existing_t1', fieldData: { slug: 'hair-loss' }, isDraft: false, isArchived: false, createdOn: '', lastUpdated: '' },
      ]);
      mockedUpdateItems.mockResolvedValueOnce(undefined);

      await syncProductsToCMS(env, new Map());

      expect(mockedCreateItems).not.toHaveBeenCalled();
      expect(mockedUpdateItems).toHaveBeenCalledOnce();
    });

    it('does nothing when no collection IDs', async () => {
      mockedListCollections.mockResolvedValueOnce([]);
      await syncProductsToCMS(env, new Map());
      expect(mockedListItems).not.toHaveBeenCalled();
    });

    it('does nothing when product catalog is empty', async () => {
      const collectionIds = makeCollectionIds();
      await kv.put(KV_KEYS.CMS_COLLECTION_IDS, JSON.stringify(collectionIds));
      // No products

      await syncProductsToCMS(env, new Map());
      expect(mockedListItems).not.toHaveBeenCalled();
    });

    it('sets empty categories array when category not in map', async () => {
      const collectionIds = makeCollectionIds();
      await kv.put(KV_KEYS.CMS_COLLECTION_IDS, JSON.stringify(collectionIds));
      await kv.put(KV_KEYS.PRODUCTS_CATALOG, JSON.stringify({ 'hair-loss': { basePrice: 60, lastSeen: Date.now() } }));

      const emptyCategoryMap = new Map<string, string>();

      mockedListItems.mockResolvedValueOnce([]);
      mockedCreateItems.mockResolvedValueOnce([
        { id: 't1', fieldData: { slug: 'hair-loss' } },
      ]);

      await syncProductsToCMS(env, emptyCategoryMap);

      const createCall = mockedCreateItems.mock.calls[0];
      const item = createCall[2][0];
      expect(item.fieldData.categories).toEqual([]);
      expect(item.fieldData.category).toBe('treatment');
    });
  });

  // =====================================================
  // syncSegmentsToCMS
  // =====================================================

  describe('syncSegmentsToCMS', () => {
    it('creates segment items', async () => {
      const collectionIds = makeCollectionIds();
      await kv.put(KV_KEYS.CMS_COLLECTION_IDS, JSON.stringify(collectionIds));
      await kv.put(KV_KEYS.SEGMENTS_REGISTRY, JSON.stringify(makeSegments()));

      mockedListItems.mockResolvedValueOnce([]);
      mockedCreateItems.mockResolvedValueOnce([
        { id: 's1', fieldData: { slug: 'anonymous' } },
        { id: 's2', fieldData: { slug: 'member' } },
      ]);

      await syncSegmentsToCMS(env);

      expect(mockedCreateItems).toHaveBeenCalledOnce();
      expect(mockedPublishSite).not.toHaveBeenCalled();
      const createCall = mockedCreateItems.mock.calls[0];
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
      const collectionIds = makeCollectionIds();
      await kv.put(KV_KEYS.CMS_COLLECTION_IDS, JSON.stringify(collectionIds));
      // No segments registry

      await syncSegmentsToCMS(env);
      expect(mockedListItems).not.toHaveBeenCalled();
    });
  });

  // =====================================================
  // performCMSSync
  // =====================================================

  describe('performCMSSync', () => {
    it('runs two-phase sync and publishes site', async () => {
      const collectionIds = makeCollectionIds();
      await kv.put(KV_KEYS.CMS_COLLECTION_IDS, JSON.stringify(collectionIds));
      await kv.put(KV_KEYS.SEGMENTS_REGISTRY, JSON.stringify([makeSegments()[0]]));
      await kv.put(KV_KEYS.PRODUCTS_CATALOG, JSON.stringify({ 'hair-loss': { basePrice: 60, lastSeen: Date.now() } }));
      await kv.put(KV_KEYS.PRICES + 'anonymous', JSON.stringify({ 'hair-loss': makePricingEntry() }));
      await kv.put(KV_KEYS.OFFERS + 'anonymous', JSON.stringify(makeOffersBundle()));

      mockedListItems.mockImplementation(async (_env, collectionId) => {
        if (collectionId === 'col_cat') return [{ id: 'wf_cat1', fieldData: { slug: 'treatment' }, isDraft: false, isArchived: false, createdOn: '', lastUpdated: '' }] as any;
        if (collectionId === 'col_prod') return [{ id: 'wf_t1', fieldData: { slug: 'hair-loss' }, isDraft: false, isArchived: false, createdOn: '', lastUpdated: '' }] as any;
        if (collectionId === 'col_s') return [{ id: 'wf_s1', fieldData: { slug: 'anonymous' }, isDraft: false, isArchived: false, createdOn: '', lastUpdated: '' }] as any;
        return [];
      });
      mockedCreateItems.mockResolvedValue([
        { id: 'item_1', fieldData: {}, isDraft: false, isArchived: false, createdOn: '', lastUpdated: '' },
      ]);
      mockedPublishSite.mockResolvedValueOnce(undefined);

      const result = await performCMSSync(env);

      expect(mockedPublishSite).toHaveBeenCalledOnce();
      // Should have created items across offer collections
      expect(result.created).toBeGreaterThan(0);
      expect(result.errors).toEqual([]);
    });

    it('skips publish when no changes were made', async () => {
      const collectionIds = makeCollectionIds();
      await kv.put(KV_KEYS.CMS_COLLECTION_IDS, JSON.stringify(collectionIds));
      await kv.put(KV_KEYS.SEGMENTS_REGISTRY, JSON.stringify([]));
      await kv.put(KV_KEYS.PRODUCTS_CATALOG, JSON.stringify({ 'hair-loss': { basePrice: 60, lastSeen: Date.now() } }));

      mockedListItems.mockImplementation(async (_env, collectionId) => {
        if (collectionId === 'col_cat') return [{ id: 'wf_cat1', fieldData: { slug: 'treatment' }, isDraft: false, isArchived: false, createdOn: '', lastUpdated: '' }] as any;
        if (collectionId === 'col_prod') return [{ id: 'wf_t1', fieldData: { slug: 'hair-loss' }, isDraft: false, isArchived: false, createdOn: '', lastUpdated: '' }] as any;
        return [];
      });
      mockedCreateItems.mockResolvedValue([{ id: 't1', fieldData: { slug: 'hair-loss' } } as any]);

      const result = await performCMSSync(env);

      expect(mockedPublishSite).not.toHaveBeenCalled();
      expect(result.published).toBe(0);
    });

    it('handles site publish failure gracefully', async () => {
      const collectionIds = makeCollectionIds();
      await kv.put(KV_KEYS.CMS_COLLECTION_IDS, JSON.stringify(collectionIds));
      await kv.put(KV_KEYS.SEGMENTS_REGISTRY, JSON.stringify([makeSegments()[0]]));
      await kv.put(KV_KEYS.PRODUCTS_CATALOG, JSON.stringify({ 'hair-loss': { basePrice: 60, lastSeen: Date.now() } }));
      await kv.put(KV_KEYS.PRICES + 'anonymous', JSON.stringify({ 'hair-loss': makePricingEntry() }));
      await kv.put(KV_KEYS.OFFERS + 'anonymous', JSON.stringify(makeOffersBundle()));

      mockedListItems.mockImplementation(async (_env, collectionId) => {
        if (collectionId === 'col_cat') return [{ id: 'wf_cat1', fieldData: { slug: 'treatment' }, isDraft: false, isArchived: false, createdOn: '', lastUpdated: '' }] as any;
        if (collectionId === 'col_prod') return [{ id: 'wf_t1', fieldData: { slug: 'hair-loss' }, isDraft: false, isArchived: false, createdOn: '', lastUpdated: '' }] as any;
        if (collectionId === 'col_s') return [{ id: 'wf_s1', fieldData: { slug: 'anonymous' }, isDraft: false, isArchived: false, createdOn: '', lastUpdated: '' }] as any;
        return [];
      });
      mockedCreateItems.mockResolvedValue([
        { id: 'item_1', fieldData: {}, isDraft: false, isArchived: false, createdOn: '', lastUpdated: '' },
      ]);
      mockedPublishSite.mockRejectedValueOnce(new Error('Publish timeout'));

      const result = await performCMSSync(env);

      expect(result.errors).toContain('Site publish failed: Publish timeout');
      expect(result.published).toBe(0);
    });

    it('skips when sync lock is active', async () => {
      await kv.put(KV_KEYS.CMS_SYNC_LOCK, String(Date.now()), { expirationTtl: 300 });

      const result = await performCMSSync(env);

      expect(result.errors).toContain('CMS sync already in progress');
      expect(mockedListCollections).not.toHaveBeenCalled();
    });

    it('returns error when collections not set up', async () => {
      mockedListCollections.mockResolvedValueOnce([]);

      const result = await performCMSSync(env);

      expect(result.errors).toContain('CMS collections not set up. Run POST /api/cms/setup first.');
      expect(result.created).toBe(0);
    });

    it('builds product and segment ID maps after Phase 1', async () => {
      const collectionIds = makeCollectionIds();
      await kv.put(KV_KEYS.CMS_COLLECTION_IDS, JSON.stringify(collectionIds));
      await kv.put(KV_KEYS.SEGMENTS_REGISTRY, JSON.stringify([makeSegments()[0]])); // anonymous only
      await kv.put(KV_KEYS.PRODUCTS_CATALOG, JSON.stringify({ 'hair-loss': { basePrice: 60, lastSeen: Date.now() } }));
      await kv.put(KV_KEYS.PRICES + 'anonymous', JSON.stringify({ 'hair-loss': makePricingEntry() }));
      await kv.put(KV_KEYS.OFFERS + 'anonymous', JSON.stringify(makeOffersBundle({
        promotions: [makeOfferEntry({ id: 'promo_1', applicableProductIds: ['hair-loss'] })],
        coupons: [],
      })));

      // Phase 1: categories sync, products sync, segments sync
      // Phase 2: build maps — products list, segments list
      // Phase 2: per-collection sync — list items per collection
      let listItemsCallCount = 0;
      mockedListItems.mockImplementation(async (_env, collectionId) => {
        listItemsCallCount++;
        if (collectionId === 'col_cat') return [{ id: 'wf_cat1', fieldData: { slug: 'treatment' }, isDraft: false, isArchived: false, createdOn: '', lastUpdated: '' }] as any;
        if (collectionId === 'col_prod') {
          return [{ id: 'wf_t1', fieldData: { slug: 'hair-loss' }, isDraft: false, isArchived: false, createdOn: '', lastUpdated: '' }] as any;
        }
        if (collectionId === 'col_s') {
          return [{ id: 'wf_s1', fieldData: { slug: 'anonymous' }, isDraft: false, isArchived: false, createdOn: '', lastUpdated: '' }] as any;
        }
        return [];
      });

      mockedCreateItems.mockResolvedValue([
        { id: 'o1', fieldData: {}, isDraft: false, isArchived: false, createdOn: '', lastUpdated: '' },
      ]);
      mockedPublishSite.mockResolvedValueOnce(undefined);

      const result = await performCMSSync(env);

      expect(result.errors).toEqual([]);
      // The promotion collection should have received items with resolved multi-ref IDs
      const promoCalls = mockedCreateItems.mock.calls.filter(
        (call) => call[1] === 'col_p',
      );
      if (promoCalls.length > 0) {
        const fieldData = promoCalls[0][2][0].fieldData;
        expect(fieldData.products).toContain('wf_t1');
        expect(fieldData.segments).toContain('wf_s1');
      }
    });

    it('reports Phase 1 product sync failure in errors', async () => {
      const collectionIds = makeCollectionIds();
      await kv.put(KV_KEYS.CMS_COLLECTION_IDS, JSON.stringify(collectionIds));
      await kv.put(KV_KEYS.SEGMENTS_REGISTRY, JSON.stringify([]));
      await kv.put(KV_KEYS.PRODUCTS_CATALOG, JSON.stringify({ 'hair-loss': { basePrice: 60, lastSeen: Date.now() } }));
      await kv.put(KV_KEYS.PRICES + 'anonymous', JSON.stringify({ 'hair-loss': makePricingEntry() }));

      // First call to col_prod (inside syncProductsToCMS) throws, subsequent calls return empty
      let productCallCount = 0;
      mockedListItems.mockImplementation(async (_env, collectionId) => {
        if (collectionId === 'col_cat') return [{ id: 'wf_cat1', fieldData: { slug: 'treatment' }, isDraft: false, isArchived: false, createdOn: '', lastUpdated: '' }] as any;
        if (collectionId === 'col_prod') {
          productCallCount++;
          if (productCallCount === 1) throw new Error('Products API down');
        }
        return [];
      });

      const result = await performCMSSync(env);

      expect(result.errors).toContain('Products sync failed: Products API down');
    });

    it('reports Phase 1 segment sync failure in errors', async () => {
      const collectionIds = makeCollectionIds();
      await kv.put(KV_KEYS.CMS_COLLECTION_IDS, JSON.stringify(collectionIds));
      await kv.put(KV_KEYS.SEGMENTS_REGISTRY, JSON.stringify(makeSegments()));
      await kv.put(KV_KEYS.PRODUCTS_CATALOG, JSON.stringify({}));

      // First call to col_s (inside syncSegmentsToCMS) throws, subsequent calls return empty
      let segmentCallCount = 0;
      mockedListItems.mockImplementation(async (_env, collectionId) => {
        if (collectionId === 'col_cat') return [{ id: 'wf_cat1', fieldData: { slug: 'treatment' }, isDraft: false, isArchived: false, createdOn: '', lastUpdated: '' }] as any;
        if (collectionId === 'col_s') {
          segmentCallCount++;
          if (segmentCallCount === 1) throw new Error('Segments API down');
        }
        return [];
      });

      const result = await performCMSSync(env);

      expect(result.errors).toContain('Segments sync failed: Segments API down');
    });

    it('aborts Phase 2 when both ID maps are empty after Phase 1', async () => {
      const collectionIds = makeCollectionIds();
      await kv.put(KV_KEYS.CMS_COLLECTION_IDS, JSON.stringify(collectionIds));
      await kv.put(KV_KEYS.SEGMENTS_REGISTRY, JSON.stringify([]));
      await kv.put(KV_KEYS.PRODUCTS_CATALOG, JSON.stringify({}));

      // Return empty for both products and segments (categories returns items)
      mockedListItems.mockResolvedValue([]);
      mockedCreateItems.mockResolvedValue([{ id: 'cat1', fieldData: { slug: 'treatment' } } as any]);

      const result = await performCMSSync(env);

      expect(result.errors).toContain('Phase 1 produced empty ID maps — skipping offer sync');
      // createItems may be called for categories seed, but not for any offer collection
      const offerCreateCalls = mockedCreateItems.mock.calls.filter(
        (call) => call[1] !== 'col_cat',
      );
      expect(offerCreateCalls).toHaveLength(0);
    });

    it('continues Phase 2 when only one map is empty', async () => {
      const collectionIds = makeCollectionIds();
      await kv.put(KV_KEYS.CMS_COLLECTION_IDS, JSON.stringify(collectionIds));
      await kv.put(KV_KEYS.SEGMENTS_REGISTRY, JSON.stringify([makeSegments()[0]]));
      await kv.put(KV_KEYS.PRODUCTS_CATALOG, JSON.stringify({}));
      await kv.put(KV_KEYS.OFFERS + 'anonymous', JSON.stringify(makeOffersBundle({ promotions: [], coupons: [], loyalty: [], referrals: [], gifts: [] })));

      // Products empty, but segments has items
      mockedListItems.mockImplementation(async (_env, collectionId) => {
        if (collectionId === 'col_cat') return [{ id: 'wf_cat1', fieldData: { slug: 'treatment' }, isDraft: false, isArchived: false, createdOn: '', lastUpdated: '' }] as any;
        if (collectionId === 'col_s') {
          return [{ id: 'wf_s1', fieldData: { slug: 'anonymous' }, isDraft: false, isArchived: false, createdOn: '', lastUpdated: '' }] as any;
        }
        return [];
      });

      const result = await performCMSSync(env);

      // Should NOT have the empty maps error
      expect(result.errors).not.toContain('Phase 1 produced empty ID maps — skipping offer sync');
    });

    it('skips Phase 2 when all segment offer bundles are null', async () => {
      const collectionIds = makeCollectionIds();
      await kv.put(KV_KEYS.CMS_COLLECTION_IDS, JSON.stringify(collectionIds));
      await kv.put(KV_KEYS.SEGMENTS_REGISTRY, JSON.stringify(makeSegments()));
      await kv.put(KV_KEYS.PRODUCTS_CATALOG, JSON.stringify({ 'hair-loss': { basePrice: 60, lastSeen: Date.now() } }));
      // No offers keys in KV — getOffers returns null

      mockedListItems.mockImplementation(async (_env, collectionId) => {
        if (collectionId === 'col_cat') return [{ id: 'wf_cat1', fieldData: { slug: 'treatment' }, isDraft: false, isArchived: false, createdOn: '', lastUpdated: '' }] as any;
        if (collectionId === 'col_prod') {
          return [{ id: 'wf_t1', fieldData: { slug: 'hair-loss' }, isDraft: false, isArchived: false, createdOn: '', lastUpdated: '' }] as any;
        }
        if (collectionId === 'col_s') {
          return [{ id: 'wf_s1', fieldData: { slug: 'anonymous' }, isDraft: false, isArchived: false, createdOn: '', lastUpdated: '' }] as any;
        }
        return [];
      });
      mockedCreateItems.mockResolvedValue([
        { id: 't1', fieldData: { slug: 'hair-loss' } } as any,
      ]);

      const result = await performCMSSync(env);

      expect(result.errors).toContain('All segment offer bundles are empty — skipping offer sync to prevent mass deactivation');
      expect(result.created).toBe(0);
    });

    it('proceeds when at least one segment has offers', async () => {
      const collectionIds = makeCollectionIds();
      await kv.put(KV_KEYS.CMS_COLLECTION_IDS, JSON.stringify(collectionIds));
      await kv.put(KV_KEYS.SEGMENTS_REGISTRY, JSON.stringify(makeSegments()));
      await kv.put(KV_KEYS.PRODUCTS_CATALOG, JSON.stringify({ 'hair-loss': { basePrice: 60, lastSeen: Date.now() } }));
      // Only anonymous has offers, member has none
      await kv.put(KV_KEYS.OFFERS + 'anonymous', JSON.stringify(makeOffersBundle()));

      mockedListItems.mockImplementation(async (_env, collectionId) => {
        if (collectionId === 'col_cat') return [{ id: 'wf_cat1', fieldData: { slug: 'treatment' }, isDraft: false, isArchived: false, createdOn: '', lastUpdated: '' }] as any;
        if (collectionId === 'col_prod') {
          return [{ id: 'wf_t1', fieldData: { slug: 'hair-loss' }, isDraft: false, isArchived: false, createdOn: '', lastUpdated: '' }] as any;
        }
        if (collectionId === 'col_s') {
          return [{ id: 'wf_s1', fieldData: { slug: 'anonymous' }, isDraft: false, isArchived: false, createdOn: '', lastUpdated: '' }] as any;
        }
        return [];
      });
      mockedCreateItems.mockResolvedValue([
        { id: 'o1', fieldData: {}, isDraft: false, isArchived: false, createdOn: '', lastUpdated: '' },
      ]);
      mockedPublishSite.mockResolvedValueOnce(undefined);

      const result = await performCMSSync(env);

      expect(result.errors.filter((e) => e.includes('empty'))).toEqual([]);
      expect(result.created).toBeGreaterThan(0);
    });

    it('proceeds when no segments defined', async () => {
      const collectionIds = makeCollectionIds();
      await kv.put(KV_KEYS.CMS_COLLECTION_IDS, JSON.stringify(collectionIds));
      await kv.put(KV_KEYS.SEGMENTS_REGISTRY, JSON.stringify([]));
      await kv.put(KV_KEYS.PRODUCTS_CATALOG, JSON.stringify({ 'hair-loss': { basePrice: 60, lastSeen: Date.now() } }));

      mockedListItems.mockImplementation(async (_env, collectionId) => {
        if (collectionId === 'col_cat') return [{ id: 'wf_cat1', fieldData: { slug: 'treatment' }, isDraft: false, isArchived: false, createdOn: '', lastUpdated: '' }] as any;
        if (collectionId === 'col_prod') {
          return [{ id: 'wf_t1', fieldData: { slug: 'hair-loss' }, isDraft: false, isArchived: false, createdOn: '', lastUpdated: '' }] as any;
        }
        return [];
      });
      mockedCreateItems.mockResolvedValue([
        { id: 't1', fieldData: { slug: 'hair-loss' } } as any,
      ]);

      const result = await performCMSSync(env);

      // No "empty bundles" error — empty segments array is legitimate
      expect(result.errors.filter((e) => e.includes('empty'))).toEqual([]);
    });

    it('includes per-collection breakdown in result', async () => {
      const collectionIds = makeCollectionIds();
      await kv.put(KV_KEYS.CMS_COLLECTION_IDS, JSON.stringify(collectionIds));
      await kv.put(KV_KEYS.SEGMENTS_REGISTRY, JSON.stringify([makeSegments()[0]]));
      await kv.put(KV_KEYS.PRODUCTS_CATALOG, JSON.stringify({ 'hair-loss': { basePrice: 60, lastSeen: Date.now() } }));
      await kv.put(KV_KEYS.PRICES + 'anonymous', JSON.stringify({ 'hair-loss': makePricingEntry() }));
      await kv.put(KV_KEYS.OFFERS + 'anonymous', JSON.stringify(makeOffersBundle()));

      mockedListItems.mockImplementation(async (_env, collectionId) => {
        if (collectionId === 'col_cat') return [{ id: 'wf_cat1', fieldData: { slug: 'treatment' }, isDraft: false, isArchived: false, createdOn: '', lastUpdated: '' }] as any;
        if (collectionId === 'col_prod') return [{ id: 'wf_t1', fieldData: { slug: 'hair-loss' }, isDraft: false, isArchived: false, createdOn: '', lastUpdated: '' }] as any;
        if (collectionId === 'col_s') return [{ id: 'wf_s1', fieldData: { slug: 'anonymous' }, isDraft: false, isArchived: false, createdOn: '', lastUpdated: '' }] as any;
        return [];
      });
      mockedCreateItems.mockResolvedValue([
        { id: 'item_1', fieldData: {}, isDraft: false, isArchived: false, createdOn: '', lastUpdated: '' },
      ]);
      mockedPublishSite.mockResolvedValueOnce(undefined);

      const result = await performCMSSync(env);

      expect(result.collections).toBeDefined();
      // Should have entries for synced collections
      expect(result.collections!['promotions']).toBeDefined();
      expect(result.collections!['promotions'].created).toBeGreaterThanOrEqual(0);
      expect(result.collections!['discountCoupons']).toBeDefined();
    });

    it('tags errors with collection name prefix', async () => {
      const collectionIds = makeCollectionIds();
      await kv.put(KV_KEYS.CMS_COLLECTION_IDS, JSON.stringify(collectionIds));
      await kv.put(KV_KEYS.SEGMENTS_REGISTRY, JSON.stringify([makeSegments()[0]]));
      await kv.put(KV_KEYS.PRODUCTS_CATALOG, JSON.stringify({ 'hair-loss': { basePrice: 60, lastSeen: Date.now() } }));
      await kv.put(KV_KEYS.OFFERS + 'anonymous', JSON.stringify(makeOffersBundle()));

      // Make listItems succeed for Phase 1 maps but createItems fail for promotions
      mockedListItems.mockImplementation(async (_env, collectionId) => {
        if (collectionId === 'col_cat') return [{ id: 'wf_cat1', fieldData: { slug: 'treatment' }, isDraft: false, isArchived: false, createdOn: '', lastUpdated: '' }] as any;
        if (collectionId === 'col_prod') {
          return [{ id: 'wf_t1', fieldData: { slug: 'hair-loss' }, isDraft: false, isArchived: false, createdOn: '', lastUpdated: '' }] as any;
        }
        if (collectionId === 'col_s') {
          return [{ id: 'wf_s1', fieldData: { slug: 'anonymous' }, isDraft: false, isArchived: false, createdOn: '', lastUpdated: '' }] as any;
        }
        return [];
      });
      mockedCreateItems.mockRejectedValue(new Error('Bulk create failed'));

      const result = await performCMSSync(env);

      // Errors should be prefixed with collection key
      const taggedErrors = result.errors.filter((e) => /^\[/.test(e));
      expect(taggedErrors.length).toBeGreaterThan(0);
      expect(taggedErrors.some((e) => e.startsWith('[promotions]') || e.startsWith('[discountCoupons]'))).toBe(true);
    });

    it('records last sync timestamp in KV', async () => {
      const collectionIds = makeCollectionIds();
      await kv.put(KV_KEYS.CMS_COLLECTION_IDS, JSON.stringify(collectionIds));
      await kv.put(KV_KEYS.SEGMENTS_REGISTRY, JSON.stringify([]));
      await kv.put(KV_KEYS.PRODUCTS_CATALOG, JSON.stringify({ 'hair-loss': { basePrice: 60, lastSeen: Date.now() } }));

      mockedListItems.mockImplementation(async (_env, collectionId) => {
        if (collectionId === 'col_cat') return [{ id: 'wf_cat1', fieldData: { slug: 'treatment' }, isDraft: false, isArchived: false, createdOn: '', lastUpdated: '' }] as any;
        if (collectionId === 'col_prod') return [{ id: 'wf_t1', fieldData: { slug: 'hair-loss' }, isDraft: false, isArchived: false, createdOn: '', lastUpdated: '' }] as any;
        return [];
      });
      mockedCreateItems.mockResolvedValue([{ id: 't1', fieldData: { slug: 'hair-loss' } } as any]);

      await performCMSSync(env);

      const lastSync = await kv.get(KV_KEYS.META_LAST_CMS_SYNC);
      expect(lastSync).toBeTruthy();
      expect(new Date(lastSync!).toISOString()).toBe(lastSync);
    });
  });

  // =====================================================
  // getCMSStatus
  // =====================================================

  describe('getCMSStatus', () => {
    it('returns status with collections and counts', async () => {
      const collectionIds = makeCollectionIds();
      await kv.put(KV_KEYS.CMS_COLLECTION_IDS, JSON.stringify(collectionIds));
      await kv.put(KV_KEYS.META_LAST_CMS_SYNC, '2026-03-19T00:00:00Z');

      mockedListItems
        .mockResolvedValueOnce([{ id: 't1' }, { id: 't2' }] as any)        // products
        .mockResolvedValueOnce([{ id: 'cat1' }] as any)                     // categories
        .mockResolvedValueOnce([{ id: 's1' }, { id: 's2' }] as any)        // segments
        .mockResolvedValueOnce([{ id: 'dc1' }] as any)                      // discountCoupons
        .mockResolvedValueOnce([] as any)                                    // vouchers
        .mockResolvedValueOnce([{ id: 'rc1' }] as any)                      // referralCodes
        .mockResolvedValueOnce([{ id: 'p1' }, { id: 'p2' }] as any)        // promotions
        .mockResolvedValueOnce([{ id: 'lp1' }] as any);                     // loyaltyPrograms

      const status = await getCMSStatus(env);

      expect(status.enabled).toBe(true);
      expect(status.collections).toEqual(collectionIds);
      expect(status.lastSync).toBe('2026-03-19T00:00:00Z');
      expect(status.itemCounts).toEqual({
        products: 2,
        categories: 1,
        segments: 2,
        discountCoupons: 1,
        vouchers: 0,
        referralCodes: 1,
        promotions: 2,
        loyaltyPrograms: 1,
      });
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
      const collectionIds = makeCollectionIds();
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
