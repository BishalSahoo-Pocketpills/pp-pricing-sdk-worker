import { KV_KEYS, WEBFLOW, DEFAULT_CATEGORIES, DEFAULT_PRODUCT_CATEGORY } from '@/config';
import { getPricing, getProducts, getSegments, getOffers, getMeta, setMeta } from '@/store';
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
import type {
  Env,
  CMSCollectionIds,
  CMSSyncResult,
  CMSStatus,
  OfferEntry,
  OfferCategory,
  OffersBundle,
} from '@/types';

// --- Field schemas ---

const PRODUCT_FIELDS = [
  { type: 'Number', displayName: 'Base Price', slug: 'base-price', isRequired: false },
  { type: 'Number', displayName: 'Discounted Price', slug: 'discounted-price', isRequired: false },
  { type: 'Number', displayName: 'Discount Amount', slug: 'discount-amount', isRequired: false },
  { type: 'PlainText', displayName: 'Discount Label', slug: 'discount-label', isRequired: false },
  { type: 'PlainText', displayName: 'Discount Type', slug: 'discount-type', isRequired: false },
  { type: 'Switch', displayName: 'Has Discount', slug: 'has-discount', isRequired: false },
  { type: 'PlainText', displayName: 'Formatted Price', slug: 'formatted-price', isRequired: false },
  { type: 'PlainText', displayName: 'Campaign Name', slug: 'campaign-name', isRequired: false },
  { type: 'PlainText', displayName: 'Category', slug: 'category', isRequired: false },
  { type: 'Switch', displayName: 'Active', slug: 'active', isRequired: false },
  { type: 'PlainText', displayName: 'Last Updated', slug: 'last-updated', isRequired: false },
  { type: 'PlainText', displayName: 'Default Text', slug: 'default-text', isRequired: false },
  { type: 'Number', displayName: 'Default Price', slug: 'default-price', isRequired: false },
];

const CATEGORY_FIELDS = [
  { type: 'PlainText', displayName: 'Description', slug: 'description', isRequired: false },
  { type: 'Switch', displayName: 'Active', slug: 'active', isRequired: false },
];

const SEGMENT_FIELDS = [
  { type: 'PlainText', displayName: 'Description', slug: 'description', isRequired: false },
  { type: 'Switch', displayName: 'Is Default', slug: 'is-default', isRequired: false },
];

const OFFER_BASE_FIELDS = [
  { type: 'PlainText', displayName: 'Offer ID', slug: 'offer-id', isRequired: false },
  { type: 'PlainText', displayName: 'Title', slug: 'title', isRequired: false },
  { type: 'PlainText', displayName: 'Description', slug: 'description', isRequired: false },
  { type: 'PlainText', displayName: 'Code', slug: 'code', isRequired: false },
  { type: 'PlainText', displayName: 'Discount Type', slug: 'discount-type', isRequired: false },
  { type: 'PlainText', displayName: 'Discount Label', slug: 'discount-label', isRequired: false },
  { type: 'Number', displayName: 'Discount Percent Off', slug: 'discount-percent-off', isRequired: false },
  { type: 'Number', displayName: 'Discount Amount Off', slug: 'discount-amount-off', isRequired: false },
  { type: 'PlainText', displayName: 'Campaign Name', slug: 'campaign-name', isRequired: false },
  { type: 'PlainText', displayName: 'Applicable Products', slug: 'applicable-products', isRequired: false },
  { type: 'Number', displayName: 'Sort Order', slug: 'sort-order', isRequired: false },
  { type: 'Switch', displayName: 'Active', slug: 'active', isRequired: false },
  { type: 'PlainText', displayName: 'Last Updated', slug: 'last-updated', isRequired: false },
];

const LOYALTY_EXTRA_FIELDS = [
  { type: 'Number', displayName: 'Loyalty Balance', slug: 'loyalty-balance', isRequired: false },
  { type: 'Number', displayName: 'Gift Balance', slug: 'gift-balance', isRequired: false },
  { type: 'PlainText', displayName: 'Offer Type', slug: 'offer-type', isRequired: false },
];

// --- Category mapping ---

const OFFER_CATEGORY_MAP: Record<OfferCategory, keyof CMSCollectionIds> = {
  coupon: 'discountCoupons',
  promotion: 'promotions',
  loyalty: 'loyaltyPrograms',
  referral: 'referralCodes',
  gift: 'loyaltyPrograms',
};

const OFFER_COLLECTION_KEYS: ReadonlyArray<keyof CMSCollectionIds> = [
  'discountCoupons',
  'vouchers',
  'referralCodes',
  'promotions',
  'loyaltyPrograms',
] as const;

const CATEGORY_SORT_PRIORITY: Record<OfferCategory, number> = {
  promotion: 500,
  coupon: 400,
  loyalty: 300,
  referral: 200,
  gift: 100,
};

// --- Types ---

export interface MergedOffer {
  entry: OfferEntry;
  segmentKeys: Set<string>;
}

// --- Idempotent field helpers ---

async function ensureFieldMultiRef(
  env: Env, collectionId: string,
  field: { displayName: string; slug: string },
  targetCollectionId: string,
): Promise<void> {
  try {
    await createFieldMultiRef(env, collectionId, field, targetCollectionId);
  } catch (error) {
    if ((error as Error).message.includes('409')) return;
    throw error;
  }
}

async function ensureField(
  env: Env, collectionId: string,
  field: { type: string; displayName: string; slug: string; isRequired?: boolean },
): Promise<void> {
  try {
    await createField(env, collectionId, field);
  } catch (error) {
    if ((error as Error).message.includes('409')) return;
    throw error;
  }
}

// --- Collection setup ---

async function findOrCreateCollection(
  env: Env,
  existing: Array<{ id: string; slug: string }>,
  schema: { displayName: string; singularName: string; slug: string },
  fields: Array<{ type: string; displayName: string; slug: string; isRequired?: boolean }>,
): Promise<{ id: string; created: boolean }> {
  const match = existing.find((c) => c.slug === schema.slug);
  if (match) return { id: match.id, created: false };

  const collection = await createCollection(env, schema);

  // Create custom fields (name and slug are built-in)
  for (const field of fields) {
    await createField(env, collection.id, field);
  }

  return { id: collection.id, created: true };
}

export async function setupCollections(env: Env): Promise<CMSCollectionIds> {
  const existing = await listCollections(env);

  // Phase 1: Categories, Products, and Segments (needed for multi-ref targets)
  const categories = await findOrCreateCollection(
    env,
    existing,
    WEBFLOW.COLLECTIONS.CATEGORIES,
    CATEGORY_FIELDS,
  );

  const products = await findOrCreateCollection(
    env,
    existing,
    WEBFLOW.COLLECTIONS.PRODUCTS,
    PRODUCT_FIELDS,
  );

  // Multi-ref: Products → Categories
  await ensureFieldMultiRef(
    env, products.id,
    { displayName: 'Categories', slug: 'categories' },
    categories.id,
  );

  const segments = await findOrCreateCollection(
    env,
    existing,
    WEBFLOW.COLLECTIONS.SEGMENTS,
    SEGMENT_FIELDS,
  );

  // Phase 2: 5 offer collections with multi-ref fields
  const offerCollectionConfigs: Array<{
    key: keyof CMSCollectionIds;
    schema: { displayName: string; singularName: string; slug: string };
    extraFields: Array<{ type: string; displayName: string; slug: string; isRequired?: boolean }>;
  }> = [
    { key: 'discountCoupons', schema: WEBFLOW.COLLECTIONS.DISCOUNT_COUPONS, extraFields: [] },
    { key: 'vouchers', schema: WEBFLOW.COLLECTIONS.VOUCHERS, extraFields: [] },
    { key: 'referralCodes', schema: WEBFLOW.COLLECTIONS.REFERRAL_CODES, extraFields: [] },
    { key: 'promotions', schema: WEBFLOW.COLLECTIONS.PROMOTIONS, extraFields: [] },
    { key: 'loyaltyPrograms', schema: WEBFLOW.COLLECTIONS.LOYALTY_PROGRAMS, extraFields: LOYALTY_EXTRA_FIELDS },
  ];

  const ids: CMSCollectionIds = {
    products: products.id,
    categories: categories.id,
    segments: segments.id,
    discountCoupons: '',
    vouchers: '',
    referralCodes: '',
    promotions: '',
    loyaltyPrograms: '',
  };

  for (const config of offerCollectionConfigs) {
    const fields = [...OFFER_BASE_FIELDS, ...config.extraFields];
    const result = await findOrCreateCollection(env, existing, config.schema, fields);
    ids[config.key] = result.id;

    // Idempotent: always ensure multi-ref fields exist (swallows 409)
    await ensureFieldMultiRef(
      env, result.id,
      { displayName: 'Products', slug: 'products' },
      products.id,
    );
    await ensureFieldMultiRef(
      env, result.id,
      { displayName: 'Segments', slug: 'segments' },
      segments.id,
    );

    // Ensure offer-type field on loyalty programs (upgrade path)
    if (config.key === 'loyaltyPrograms') {
      await ensureField(env, result.id, {
        type: 'PlainText', displayName: 'Offer Type', slug: 'offer-type', isRequired: false,
      });
    }
  }

  await env.PRICING_KV.put(KV_KEYS.CMS_COLLECTION_IDS, JSON.stringify(ids));

  return ids;
}

// --- Collection ID resolution ---

async function getCollectionIds(env: Env): Promise<CMSCollectionIds | null> {
  const stored = await env.PRICING_KV.get(KV_KEYS.CMS_COLLECTION_IDS, 'json');
  if (stored) return stored as CMSCollectionIds;

  // Try to discover from existing collections
  const collections = await listCollections(env);
  const find = (slug: string) => collections.find((c) => c.slug === slug)?.id || '';

  const productsId = find(WEBFLOW.COLLECTIONS.PRODUCTS.slug);
  const segmentsId = find(WEBFLOW.COLLECTIONS.SEGMENTS.slug);

  if (!productsId || !segmentsId) return null;

  const ids: CMSCollectionIds = {
    products: productsId,
    categories: find(WEBFLOW.COLLECTIONS.CATEGORIES.slug),
    segments: segmentsId,
    discountCoupons: find(WEBFLOW.COLLECTIONS.DISCOUNT_COUPONS.slug),
    vouchers: find(WEBFLOW.COLLECTIONS.VOUCHERS.slug),
    referralCodes: find(WEBFLOW.COLLECTIONS.REFERRAL_CODES.slug),
    promotions: find(WEBFLOW.COLLECTIONS.PROMOTIONS.slug),
    loyaltyPrograms: find(WEBFLOW.COLLECTIONS.LOYALTY_PROGRAMS.slug),
  };

  await env.PRICING_KV.put(KV_KEYS.CMS_COLLECTION_IDS, JSON.stringify(ids));
  return ids;
}

// --- Slug helpers ---

function sanitizeSlugPart(s: string): string {
  return s.toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function truncateField(value: string, maxLength = 256): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

// --- Sort order ---

export function computeSortOrder(entry: OfferEntry, index: number): number {
  return CATEGORY_SORT_PRIORITY[entry.category] + (100 - index);
}

// --- Offer merge & field data ---

export function mergeOffersByCategory(
  offerResults: Array<{ key: string; bundle: OffersBundle | null }>,
): Map<keyof CMSCollectionIds, Map<string, MergedOffer>> {
  const result = new Map<keyof CMSCollectionIds, Map<string, MergedOffer>>();

  for (const { key, bundle } of offerResults) {
    if (!bundle) continue;

    const allEntries: OfferEntry[] = [
      ...bundle.promotions,
      ...bundle.coupons,
      ...bundle.loyalty,
      ...bundle.referrals,
      ...bundle.gifts,
    ];

    for (const entry of allEntries) {
      const collectionKey = OFFER_CATEGORY_MAP[entry.category];

      if (!result.has(collectionKey)) {
        result.set(collectionKey, new Map());
      }

      const categoryMap = result.get(collectionKey)!;
      const existing = categoryMap.get(entry.id);

      if (existing) {
        existing.segmentKeys.add(key);
      } else {
        categoryMap.set(entry.id, {
          entry,
          segmentKeys: new Set([key]),
        });
      }
    }
  }

  return result;
}

export function buildOfferCollectionFieldData(
  entry: OfferEntry,
  segmentIds: string[],
  productIds: string[],
  sortOrder: number,
): Record<string, any> {
  const slug = sanitizeSlugPart(entry.id);
  const fieldData: Record<string, any> = {
    name: truncateField(entry.title || entry.id),
    slug,
    'offer-id': entry.id,
    title: truncateField(entry.title),
    description: truncateField(entry.description),
    code: entry.code || '',
    'discount-type': entry.discount?.type || 'NONE',
    'discount-label': entry.discount?.label || '',
    'discount-percent-off': entry.discount?.percentOff || 0,
    'discount-amount-off': entry.discount?.amountOff || 0,
    'campaign-name': entry.campaignName || '',
    'applicable-products': truncateField(entry.applicableProductIds.join(',')),
    'sort-order': sortOrder,
    active: true,
    'last-updated': new Date().toISOString(),
    products: productIds,
    segments: segmentIds,
  };

  // Loyalty/gift extras — only present on Loyalty Programs collection items
  if (entry.category === 'loyalty' || entry.category === 'gift') {
    fieldData['offer-type'] = entry.category;
  }
  if (entry.loyalty) {
    fieldData['loyalty-balance'] = entry.loyalty.balance;
  }
  if (entry.gift) {
    fieldData['gift-balance'] = entry.gift.balance / 100;
  }

  return fieldData;
}

// --- Offer collection sync ---

export async function syncOfferCollectionToCMS(
  env: Env,
  collectionId: string,
  offers: Map<string, MergedOffer>,
  productSlugToId: Map<string, string>,
  segmentSlugToId: Map<string, string>,
): Promise<CMSSyncResult> {
  const result: CMSSyncResult = { created: 0, updated: 0, published: 0, errors: [] };

  // List existing items in this collection
  const existingItems = await listItems(env, collectionId);
  const slugToItemId = new Map<string, string>();
  for (const item of existingItems) {
    if (item.fieldData?.slug) {
      slugToItemId.set(item.fieldData.slug, item.id);
    }
  }

  const toCreate: Array<{ fieldData: Record<string, any> }> = [];
  const toUpdate: Array<{ id: string; fieldData: Record<string, any> }> = [];
  const currentSlugs = new Set<string>();

  let index = 0;
  for (const [, merged] of offers) {
    const segmentIds = [...merged.segmentKeys]
      .map((k) => segmentSlugToId.get(k))
      .filter((id): id is string => !!id);

    const productIds = merged.entry.applicableProductIds
      .map((pid) => productSlugToId.get(pid))
      .filter((id): id is string => !!id);

    const sortOrder = computeSortOrder(merged.entry, index);
    const fieldData = buildOfferCollectionFieldData(merged.entry, segmentIds, productIds, sortOrder);
    const slug = fieldData.slug;
    currentSlugs.add(slug);

    const existingItemId = slugToItemId.get(slug);
    if (existingItemId) {
      toUpdate.push({ id: existingItemId, fieldData });
    } else {
      toCreate.push({ fieldData });
    }
    index++;
  }

  // Stale cleanup: deactivate items not in current offers
  for (const item of existingItems) {
    const slug = item.fieldData?.slug;
    if (slug && !currentSlugs.has(slug) && item.fieldData?.active !== false) {
      toUpdate.push({
        id: item.id,
        fieldData: { active: false, 'last-updated': new Date().toISOString() },
      });
    }
  }

  // Batch create
  if (toCreate.length > 0) {
    try {
      const created = await createItems(env, collectionId, toCreate);
      result.created = created.length;
    } catch (error) {
      result.errors.push(`Create failed: ${(error as Error).message}`);
    }
  }

  // Batch update
  if (toUpdate.length > 0) {
    try {
      await updateItems(env, collectionId, toUpdate);
      result.updated = toUpdate.length;
    } catch (error) {
      result.errors.push(`Update failed: ${(error as Error).message}`);
    }
  }

  return result;
}

// --- Treatments sync ---

function formatPriceText(
  basePrice: number,
  discountedPrice: number,
  discountLabel: string,
  symbol: string,
): string {
  if (discountedPrice >= basePrice || !discountLabel) {
    return `${symbol}${basePrice}`;
  }
  return `${symbol}${basePrice} ${symbol}${discountedPrice} (${discountLabel})`;
}

export async function syncCategoriesToCMS(env: Env): Promise<void> {
  const ids = await getCollectionIds(env);
  if (!ids) return;
  if (!ids.categories) return;

  const existingItems = await listItems(env, ids.categories);
  const slugToItemId = new Map<string, string>();
  for (const item of existingItems) {
    if (item.fieldData?.slug) {
      slugToItemId.set(item.fieldData.slug, item.id);
    }
  }

  const toCreate: Array<{ fieldData: Record<string, any> }> = [];
  const toUpdate: Array<{ id: string; fieldData: Record<string, any> }> = [];

  for (const category of DEFAULT_CATEGORIES) {
    const fieldData = {
      name: category.name,
      slug: category.slug,
      description: category.description,
      active: true,
    };

    const existingItemId = slugToItemId.get(category.slug);
    if (existingItemId) {
      toUpdate.push({ id: existingItemId, fieldData });
    } else {
      toCreate.push({ fieldData });
    }
  }

  if (toCreate.length > 0) {
    await createItems(env, ids.categories, toCreate);
  }
  if (toUpdate.length > 0) {
    await updateItems(env, ids.categories, toUpdate);
  }
}

export async function syncProductsToCMS(
  env: Env,
  categorySlugToId: Map<string, string>,
): Promise<void> {
  const ids = await getCollectionIds(env);
  if (!ids) return;

  const products = await getProducts(env.PRICING_KV);
  const productIds = Object.keys(products);
  if (productIds.length === 0) return;

  // Fetch anonymous segment pricing to embed in products
  const anonymousPricing = await getPricing(env.PRICING_KV, 'anonymous');
  const symbol = env.PRICING_CURRENCY_SYMBOL || '$';

  const existingItems = await listItems(env, ids.products);
  const slugToItemId = new Map<string, string>();
  for (const item of existingItems) {
    if (item.fieldData?.slug) {
      slugToItemId.set(item.fieldData.slug, item.id);
    }
  }

  const toCreate: Array<{ fieldData: Record<string, any> }> = [];
  const toUpdate: Array<{ id: string; fieldData: Record<string, any> }> = [];

  // Resolve default category multi-ref
  const defaultCategoryId = categorySlugToId.get(DEFAULT_PRODUCT_CATEGORY);
  const categoryIds = defaultCategoryId ? [defaultCategoryId] : [];

  for (const [productId, product] of Object.entries(products)) {
    const pricing = anonymousPricing?.[productId];
    const hasDiscount = pricing
      ? pricing.discountedPrice < pricing.basePrice && pricing.discountAmount > 0
      : false;

    const fieldData: Record<string, any> = {
      name: productId,
      slug: productId,
      'base-price': product.basePrice,
      'discounted-price': pricing?.discountedPrice ?? product.basePrice,
      'discount-amount': pricing?.discountAmount ?? 0,
      'discount-label': hasDiscount ? (pricing!.discountLabel || '') : '',
      'discount-type': pricing?.discountType ?? 'NONE',
      'has-discount': hasDiscount,
      'formatted-price': formatPriceText(
        product.basePrice,
        pricing?.discountedPrice ?? product.basePrice,
        hasDiscount ? (pricing!.discountLabel || '') : '',
        symbol,
      ),
      'campaign-name': pricing?.campaignName ?? '',
      category: DEFAULT_PRODUCT_CATEGORY,
      categories: categoryIds,
      active: true,
      'last-updated': new Date().toISOString(),
    };

    const existingItemId = slugToItemId.get(productId);
    if (existingItemId) {
      toUpdate.push({ id: existingItemId, fieldData });
    } else {
      toCreate.push({ fieldData });
    }
  }

  if (toCreate.length > 0) {
    await createItems(env, ids.products, toCreate);
  }
  if (toUpdate.length > 0) {
    await updateItems(env, ids.products, toUpdate);
  }
}

// --- Segments sync ---

export async function syncSegmentsToCMS(env: Env): Promise<void> {
  const ids = await getCollectionIds(env);
  if (!ids) return;

  const segmentDefs = await getSegments(env.PRICING_KV);
  if (segmentDefs.length === 0) return;

  const existingItems = await listItems(env, ids.segments);
  const slugToItemId = new Map<string, string>();
  for (const item of existingItems) {
    if (item.fieldData?.slug) {
      slugToItemId.set(item.fieldData.slug, item.id);
    }
  }

  const toCreate: Array<{ fieldData: Record<string, any> }> = [];
  const toUpdate: Array<{ id: string; fieldData: Record<string, any> }> = [];

  for (const segment of segmentDefs) {
    const fieldData = {
      name: segment.label,
      slug: segment.key,
      description: segment.discoveredFrom || '',
      'is-default': segment.key === 'anonymous' || segment.key === 'member',
    };

    const existingItemId = slugToItemId.get(segment.key);
    if (existingItemId) {
      toUpdate.push({ id: existingItemId, fieldData });
    } else {
      toCreate.push({ fieldData });
    }
  }

  if (toCreate.length > 0) {
    await createItems(env, ids.segments, toCreate);
  }
  if (toUpdate.length > 0) {
    await updateItems(env, ids.segments, toUpdate);
  }
}

// --- Orchestrated CMS sync with concurrency lock ---

const CMS_SYNC_LOCK_TTL_MS = 300_000; // 5 minutes

export async function performCMSSync(env: Env): Promise<CMSSyncResult> {
  const lockKey = KV_KEYS.CMS_SYNC_LOCK;
  const existing = await env.PRICING_KV.get(lockKey);

  if (existing) {
    const lockTime = parseInt(existing, 10);
    if (Date.now() - lockTime < CMS_SYNC_LOCK_TTL_MS) {
      return {
        created: 0, updated: 0, published: 0,
        errors: ['CMS sync already in progress'],
      };
    }
  }

  await env.PRICING_KV.put(lockKey, String(Date.now()), {
    expirationTtl: 300, // 5 minutes
  });

  // Declare aggregated early so Phase 1 errors can be captured
  const aggregated: CMSSyncResult = { created: 0, updated: 0, published: 0, errors: [], collections: {} };

  try {
    const ids = await getCollectionIds(env);
    if (!ids) {
      return {
        created: 0, updated: 0, published: 0,
        errors: ['CMS collections not set up. Run POST /api/cms/setup first.'],
      };
    }

    // Phase 1: Sync categories, products, and segments (catch individually)
    try { await syncCategoriesToCMS(env); }
    catch (error) { aggregated.errors.push(`Categories sync failed: ${(error as Error).message}`); }

    // Build category slug→id map for products
    const categorySlugToId = new Map<string, string>();
    if (ids.categories) {
      const categoryItems = await listItems(env, ids.categories);
      for (const item of categoryItems) {
        if (item.fieldData?.slug) {
          categorySlugToId.set(item.fieldData.slug, item.id);
        }
      }
    }

    try { await syncProductsToCMS(env, categorySlugToId); }
    catch (error) { aggregated.errors.push(`Products sync failed: ${(error as Error).message}`); }

    try { await syncSegmentsToCMS(env); }
    catch (error) { aggregated.errors.push(`Segments sync failed: ${(error as Error).message}`); }

    // Build ID lookup maps from synced collections
    const productItems = await listItems(env, ids.products);
    const productSlugToId = new Map<string, string>();
    for (const item of productItems) {
      if (item.fieldData?.slug) {
        productSlugToId.set(item.fieldData.slug, item.id);
      }
    }

    const segmentItems = await listItems(env, ids.segments);
    const segmentSlugToId = new Map<string, string>();
    for (const item of segmentItems) {
      if (item.fieldData?.slug) {
        segmentSlugToId.set(item.fieldData.slug, item.id);
      }
    }

    // Guard: abort Phase 2 if both maps are empty (Phase 1 failed completely)
    if (productSlugToId.size === 0 && segmentSlugToId.size === 0) {
      aggregated.errors.push('Phase 1 produced empty ID maps — skipping offer sync');
      await env.PRICING_KV.delete(lockKey);
      return aggregated;
    }

    // Phase 2: Merge offers across segments and sync per-category collections
    const segmentDefs = await getSegments(env.PRICING_KV);
    const offerResults = await Promise.all(
      segmentDefs.map(async (segment) => ({
        key: segment.key,
        bundle: await getOffers(env.PRICING_KV, segment.key),
      })),
    );

    // Guard: skip Phase 2 when all bundles are null (Voucherify outage)
    const hasAnyOfferData = offerResults.some((r) => r.bundle !== null);
    if (!hasAnyOfferData && offerResults.length > 0) {
      aggregated.errors.push('All segment offer bundles are empty — skipping offer sync to prevent mass deactivation');
      await setMeta(env.PRICING_KV, KV_KEYS.META_LAST_CMS_SYNC, new Date().toISOString());
      await env.PRICING_KV.delete(lockKey);
      return aggregated;
    }

    const mergedByCategory = mergeOffersByCategory(offerResults);

    // Parallel offer collection sync (Fix 6) with per-collection breakdown (Fix 5)
    const syncResults = await Promise.all(
      OFFER_COLLECTION_KEYS
        .filter((key) => ids[key])
        .map(async (collectionKey) => {
          const offers = mergedByCategory.get(collectionKey) || new Map();
          const syncResult = await syncOfferCollectionToCMS(
            env, ids[collectionKey], offers, productSlugToId, segmentSlugToId,
          );
          return { collectionKey, syncResult };
        }),
    );

    for (const { collectionKey, syncResult } of syncResults) {
      aggregated.collections![collectionKey] = {
        created: syncResult.created,
        updated: syncResult.updated,
        errors: syncResult.errors,
      };
      aggregated.created += syncResult.created;
      aggregated.updated += syncResult.updated;
      aggregated.errors.push(...syncResult.errors.map((e) => `[${collectionKey}] ${e}`));
    }

    // Publish site to make draft items live
    if (aggregated.created + aggregated.updated > 0) {
      try {
        await publishSite(env);
        aggregated.published = aggregated.created + aggregated.updated;
      } catch (error) {
        aggregated.errors.push(`Site publish failed: ${(error as Error).message}`);
      }
    }

    await setMeta(env.PRICING_KV, KV_KEYS.META_LAST_CMS_SYNC, new Date().toISOString());

    // Only delete lock on success
    await env.PRICING_KV.delete(lockKey);
    return aggregated;
  } catch (error) {
    // Lock remains with TTL — prevents immediate retry
    throw error;
  }
}

// --- Status ---

export async function getCMSStatus(env: Env): Promise<CMSStatus> {
  const ids = await env.PRICING_KV.get(KV_KEYS.CMS_COLLECTION_IDS, 'json') as CMSCollectionIds | null;
  const lastSync = await getMeta(env.PRICING_KV, KV_KEYS.META_LAST_CMS_SYNC);

  if (!ids) {
    return {
      enabled: env.CMS_SYNC_ENABLED === 'true',
      collections: null,
      lastSync: null,
      itemCounts: null,
    };
  }

  let itemCounts: CMSStatus['itemCounts'] = null;
  try {
    const [
      productsList,
      categoriesList,
      segmentsList,
      discountCouponsList,
      vouchersList,
      referralCodesList,
      promotionsList,
      loyaltyProgramsList,
    ] = await Promise.all([
      listItems(env, ids.products),
      ids.categories ? listItems(env, ids.categories) : Promise.resolve([]),
      listItems(env, ids.segments),
      ids.discountCoupons ? listItems(env, ids.discountCoupons) : Promise.resolve([]),
      ids.vouchers ? listItems(env, ids.vouchers) : Promise.resolve([]),
      ids.referralCodes ? listItems(env, ids.referralCodes) : Promise.resolve([]),
      ids.promotions ? listItems(env, ids.promotions) : Promise.resolve([]),
      ids.loyaltyPrograms ? listItems(env, ids.loyaltyPrograms) : Promise.resolve([]),
    ]);
    itemCounts = {
      products: productsList.length,
      categories: categoriesList.length,
      segments: segmentsList.length,
      discountCoupons: discountCouponsList.length,
      vouchers: vouchersList.length,
      referralCodes: referralCodesList.length,
      promotions: promotionsList.length,
      loyaltyPrograms: loyaltyProgramsList.length,
    };
  } catch (error) {
    console.error('[pp-pricing-worker] Failed to count CMS items:', error);
  }

  return {
    enabled: env.CMS_SYNC_ENABLED === 'true',
    collections: ids,
    lastSync: lastSync || null,
    itemCounts,
  };
}
