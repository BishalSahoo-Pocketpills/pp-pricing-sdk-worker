import { KV_KEYS, WEBFLOW } from '@/config';
import { getPricing, getProducts, getSegments, getOffers, getMeta, setMeta } from '@/store';
import {
  listCollections,
  createCollection,
  createField,
  listItems,
  createLiveItems,
  updateLiveItems,
  publishItems,
} from '@/webflow-client';
import type {
  Env,
  CMSCollectionIds,
  CMSSyncResult,
  CMSStatus,
  PricingEntry,
  ProductEntry,
  SegmentDefinition,
  OfferEntry,
  OfferCategory,
} from '@/types';

// --- Collection setup ---

const PRICING_FIELDS = [
  { type: 'PlainText', displayName: 'Treatment', slug: 'treatment', isRequired: false },
  { type: 'PlainText', displayName: 'Segment', slug: 'segment', isRequired: false },
  { type: 'Number', displayName: 'Base Price', slug: 'base-price', isRequired: false },
  { type: 'Number', displayName: 'Discounted Price', slug: 'discounted-price', isRequired: false },
  { type: 'Number', displayName: 'Discount Amount', slug: 'discount-amount', isRequired: false },
  { type: 'PlainText', displayName: 'Discount Label', slug: 'discount-label', isRequired: false },
  { type: 'PlainText', displayName: 'Discount Type', slug: 'discount-type', isRequired: false },
  { type: 'PlainText', displayName: 'Campaign Name', slug: 'campaign-name', isRequired: false },
  { type: 'PlainText', displayName: 'Last Updated', slug: 'last-updated', isRequired: false },
];

const TREATMENT_FIELDS = [
  { type: 'Number', displayName: 'Base Price', slug: 'base-price', isRequired: false },
  { type: 'Switch', displayName: 'Active', slug: 'active', isRequired: false },
];

const SEGMENT_FIELDS = [
  { type: 'PlainText', displayName: 'Description', slug: 'description', isRequired: false },
  { type: 'Switch', displayName: 'Is Default', slug: 'is-default', isRequired: false },
];

const OFFERS_FIELDS = [
  { type: 'PlainText', displayName: 'Offer ID', slug: 'offer-id', isRequired: false },
  { type: 'PlainText', displayName: 'Segment', slug: 'segment', isRequired: false },
  { type: 'PlainText', displayName: 'Category', slug: 'category', isRequired: false },
  { type: 'PlainText', displayName: 'Title', slug: 'title', isRequired: false },
  { type: 'PlainText', displayName: 'Description', slug: 'description', isRequired: false },
  { type: 'PlainText', displayName: 'Code', slug: 'code', isRequired: false },
  { type: 'PlainText', displayName: 'Discount Type', slug: 'discount-type', isRequired: false },
  { type: 'PlainText', displayName: 'Discount Label', slug: 'discount-label', isRequired: false },
  { type: 'Number', displayName: 'Discount Percent Off', slug: 'discount-percent-off', isRequired: false },
  { type: 'Number', displayName: 'Discount Amount Off', slug: 'discount-amount-off', isRequired: false },
  { type: 'Number', displayName: 'Discount Fixed Amount', slug: 'discount-fixed-amount', isRequired: false },
  { type: 'Number', displayName: 'Discount Unit Off', slug: 'discount-unit-off', isRequired: false },
  { type: 'Number', displayName: 'Loyalty Balance', slug: 'loyalty-balance', isRequired: false },
  { type: 'Number', displayName: 'Gift Balance', slug: 'gift-balance', isRequired: false },
  { type: 'PlainText', displayName: 'Campaign Name', slug: 'campaign-name', isRequired: false },
  { type: 'PlainText', displayName: 'Applicable Products', slug: 'applicable-products', isRequired: false },
  { type: 'Number', displayName: 'Sort Order', slug: 'sort-order', isRequired: false },
  { type: 'Switch', displayName: 'Active', slug: 'active', isRequired: false },
  { type: 'PlainText', displayName: 'Last Updated', slug: 'last-updated', isRequired: false },
];

async function findOrCreateCollection(
  env: Env,
  existing: Array<{ id: string; slug: string }>,
  schema: { displayName: string; singularName: string; slug: string },
  fields: Array<{ type: string; displayName: string; slug: string; isRequired?: boolean }>,
): Promise<string> {
  const match = existing.find((c) => c.slug === schema.slug);
  if (match) return match.id;

  const collection = await createCollection(env, schema);

  // Create custom fields (name and slug are built-in)
  for (const field of fields) {
    await createField(env, collection.id, field);
  }

  return collection.id;
}

export async function setupCollections(env: Env): Promise<CMSCollectionIds> {
  const existing = await listCollections(env);

  const treatments = await findOrCreateCollection(
    env,
    existing,
    WEBFLOW.COLLECTIONS.TREATMENTS,
    TREATMENT_FIELDS,
  );

  const pricing = await findOrCreateCollection(
    env,
    existing,
    WEBFLOW.COLLECTIONS.PRICING,
    PRICING_FIELDS,
  );

  const segments = await findOrCreateCollection(
    env,
    existing,
    WEBFLOW.COLLECTIONS.SEGMENTS,
    SEGMENT_FIELDS,
  );

  const offers = await findOrCreateCollection(
    env,
    existing,
    WEBFLOW.COLLECTIONS.OFFERS,
    OFFERS_FIELDS,
  );

  const ids: CMSCollectionIds = { treatments, pricing, segments, offers };
  await env.PRICING_KV.put(KV_KEYS.CMS_COLLECTION_IDS, JSON.stringify(ids));

  return ids;
}

// --- Collection ID resolution ---

async function getCollectionIds(env: Env): Promise<CMSCollectionIds | null> {
  const stored = await env.PRICING_KV.get(KV_KEYS.CMS_COLLECTION_IDS, 'json');
  if (stored) return stored as CMSCollectionIds;

  // Try to discover from existing collections
  const collections = await listCollections(env);
  const treatments = collections.find((c) => c.slug === WEBFLOW.COLLECTIONS.TREATMENTS.slug);
  const pricing = collections.find((c) => c.slug === WEBFLOW.COLLECTIONS.PRICING.slug);
  const segments = collections.find((c) => c.slug === WEBFLOW.COLLECTIONS.SEGMENTS.slug);
  const offers = collections.find((c) => c.slug === WEBFLOW.COLLECTIONS.OFFERS.slug);

  if (treatments && pricing && segments) {
    const ids: CMSCollectionIds = {
      treatments: treatments.id,
      pricing: pricing.id,
      segments: segments.id,
      offers: offers?.id || '',
    };
    await env.PRICING_KV.put(KV_KEYS.CMS_COLLECTION_IDS, JSON.stringify(ids));
    return ids;
  }

  return null;
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

// --- Pricing sync ---

function buildPricingSlug(productSlug: string, segment: string): string {
  return `${sanitizeSlugPart(productSlug)}--${sanitizeSlugPart(segment)}`;
}

function buildPricingFieldData(
  productId: string,
  segment: string,
  entry: PricingEntry,
): Record<string, any> {
  const slug = buildPricingSlug(productId, segment);
  return {
    name: `${productId}__${segment}`,
    slug,
    treatment: productId,
    segment,
    'base-price': entry.basePrice,
    'discounted-price': entry.discountedPrice,
    'discount-amount': entry.discountAmount,
    'discount-label': entry.discountLabel,
    'discount-type': entry.discountType,
    'campaign-name': entry.campaignName || '',
    'last-updated': new Date().toISOString(),
  };
}

export async function syncPricingToCMS(env: Env): Promise<CMSSyncResult> {
  const result: CMSSyncResult = { created: 0, updated: 0, published: 0, errors: [] };

  const ids = await getCollectionIds(env);
  if (!ids) {
    result.errors.push('CMS collections not set up. Run POST /api/cms/setup first.');
    return result;
  }

  // Read segment registry and product catalog
  const segmentDefs = await getSegments(env.PRICING_KV);
  const products = await getProducts(env.PRICING_KV);
  const productIds = Object.keys(products);

  if (productIds.length === 0) {
    result.errors.push('Product catalog is empty');
    return result;
  }

  // List existing pricing items in Webflow (build slug → itemId map)
  const existingItems = await listItems(env, ids.pricing);
  const slugToItemId = new Map<string, string>();
  for (const item of existingItems) {
    if (item.fieldData?.slug) {
      slugToItemId.set(item.fieldData.slug, item.id);
    }
  }

  const toCreate: Array<{ fieldData: Record<string, any> }> = [];
  const toUpdate: Array<{ id: string; fieldData: Record<string, any> }> = [];

  // For each segment, read pricing from KV in parallel
  const pricingResults = await Promise.all(
    segmentDefs.map(async (segment) => ({
      key: segment.key,
      pricing: await getPricing(env.PRICING_KV, segment.key),
    })),
  );

  for (const { key, pricing } of pricingResults) {
    if (!pricing) continue;

    for (const productId of productIds) {
      const entry = pricing[productId];
      if (!entry) continue;

      const fieldData = buildPricingFieldData(productId, key, entry);
      const slug = fieldData.slug;
      const existingItemId = slugToItemId.get(slug);

      if (existingItemId) {
        toUpdate.push({ id: existingItemId, fieldData });
      } else {
        toCreate.push({ fieldData });
      }
    }
  }

  const idsToPublish: string[] = [];

  // Batch create
  if (toCreate.length > 0) {
    try {
      const created = await createLiveItems(env, ids.pricing, toCreate);
      result.created = created.length;
      idsToPublish.push(...created.map((item) => item.id));
    } catch (error) {
      result.errors.push(`Create failed: ${(error as Error).message}`);
    }
  }

  // Batch update
  if (toUpdate.length > 0) {
    try {
      await updateLiveItems(env, ids.pricing, toUpdate);
      result.updated = toUpdate.length;
      idsToPublish.push(...toUpdate.map((item) => item.id));
    } catch (error) {
      result.errors.push(`Update failed: ${(error as Error).message}`);
    }
  }

  // Publish successfully changed items
  if (idsToPublish.length > 0) {
    try {
      await publishItems(env, ids.pricing, idsToPublish);
      result.published = idsToPublish.length;
    } catch (error) {
      result.errors.push(`Publish failed: ${(error as Error).message}`);
    }
  }

  await setMeta(env.PRICING_KV, KV_KEYS.META_LAST_CMS_SYNC, new Date().toISOString());

  return result;
}

// --- Offers sync ---

const CATEGORY_SORT_PRIORITY: Record<OfferCategory, number> = {
  promotion: 500,
  coupon: 400,
  loyalty: 300,
  referral: 200,
  gift: 100,
};

export function buildOfferSlug(offerId: string, segment: string): string {
  return `${sanitizeSlugPart(offerId)}--${sanitizeSlugPart(segment)}`;
}

export function computeSortOrder(entry: OfferEntry, index: number): number {
  return CATEGORY_SORT_PRIORITY[entry.category] + (100 - index);
}

export function buildOfferFieldData(
  entry: OfferEntry,
  segment: string,
  sortOrder: number,
): Record<string, any> {
  const slug = buildOfferSlug(entry.id, segment);
  return {
    name: `${entry.id}__${segment}`,
    slug,
    'offer-id': entry.id,
    segment,
    category: entry.category,
    title: truncateField(entry.title),
    description: truncateField(entry.description),
    code: segment === 'anonymous' ? '' : (entry.code || ''),
    'discount-type': entry.discount?.type || 'NONE',
    'discount-label': entry.discount?.label || '',
    'discount-percent-off': entry.discount?.percentOff || 0,
    'discount-amount-off': entry.discount?.amountOff ? entry.discount.amountOff / 100 : 0,
    'discount-fixed-amount': entry.discount?.fixedAmount ? entry.discount.fixedAmount / 100 : 0,
    'discount-unit-off': entry.discount?.unitOff || 0,
    'loyalty-balance': entry.loyalty?.balance || 0,
    'gift-balance': entry.gift ? entry.gift.balance / 100 : 0,
    'campaign-name': entry.campaignName || '',
    'applicable-products': truncateField(entry.applicableProductIds.join(',')),
    'sort-order': sortOrder,
    active: true,
    'last-updated': new Date().toISOString(),
  };
}

export async function syncOffersToCMS(env: Env): Promise<CMSSyncResult> {
  const result: CMSSyncResult = { created: 0, updated: 0, published: 0, errors: [] };

  const ids = await getCollectionIds(env);
  if (!ids) {
    result.errors.push('CMS collections not set up. Run POST /api/cms/setup first.');
    return result;
  }

  if (!ids.offers) {
    result.errors.push('Offers collection not set up. Run POST /api/cms/setup first.');
    return result;
  }

  const segmentDefs = await getSegments(env.PRICING_KV);
  if (segmentDefs.length === 0) {
    result.errors.push('No segments found');
    return result;
  }

  // List existing offer items in Webflow (build slug → itemId map)
  const existingItems = await listItems(env, ids.offers);
  const slugToItemId = new Map<string, string>();
  for (const item of existingItems) {
    if (item.fieldData?.slug) {
      slugToItemId.set(item.fieldData.slug, item.id);
    }
  }

  const toCreate: Array<{ fieldData: Record<string, any> }> = [];
  const toUpdate: Array<{ id: string; fieldData: Record<string, any> }> = [];
  const currentSlugs = new Set<string>();

  // For each segment, read offers from KV in parallel
  const offerResults = await Promise.all(
    segmentDefs.map(async (segment) => ({
      key: segment.key,
      bundle: await getOffers(env.PRICING_KV, segment.key),
    })),
  );

  for (const { key, bundle } of offerResults) {
    if (!bundle) continue;

    // Flatten all categories into a single array
    const allEntries: OfferEntry[] = [
      ...bundle.promotions,
      ...bundle.coupons,
      ...bundle.loyalty,
      ...bundle.referrals,
      ...bundle.gifts,
    ];

    for (let i = 0; i < allEntries.length; i++) {
      const entry = allEntries[i];
      const sortOrder = computeSortOrder(entry, i);
      const fieldData = buildOfferFieldData(entry, key, sortOrder);
      const slug = fieldData.slug;
      currentSlugs.add(slug);

      const existingItemId = slugToItemId.get(slug);
      if (existingItemId) {
        toUpdate.push({ id: existingItemId, fieldData });
      } else {
        toCreate.push({ fieldData });
      }
    }
  }

  // Stale cleanup: deactivate items not in current offers (only send changed fields)
  for (const item of existingItems) {
    const slug = item.fieldData?.slug;
    if (slug && !currentSlugs.has(slug) && item.fieldData?.active !== false) {
      toUpdate.push({
        id: item.id,
        fieldData: { active: false, 'last-updated': new Date().toISOString() },
      });
    }
  }

  const idsToPublish: string[] = [];

  // Batch create
  if (toCreate.length > 0) {
    try {
      const created = await createLiveItems(env, ids.offers, toCreate);
      result.created = created.length;
      idsToPublish.push(...created.map((item) => item.id));
    } catch (error) {
      result.errors.push(`Create failed: ${(error as Error).message}`);
    }
  }

  // Batch update
  if (toUpdate.length > 0) {
    try {
      await updateLiveItems(env, ids.offers, toUpdate);
      result.updated = toUpdate.length;
      idsToPublish.push(...toUpdate.map((item) => item.id));
    } catch (error) {
      result.errors.push(`Update failed: ${(error as Error).message}`);
    }
  }

  // Publish successfully changed items
  if (idsToPublish.length > 0) {
    try {
      await publishItems(env, ids.offers, idsToPublish);
      result.published = idsToPublish.length;
    } catch (error) {
      result.errors.push(`Publish failed: ${(error as Error).message}`);
    }
  }

  await setMeta(env.PRICING_KV, KV_KEYS.META_LAST_CMS_SYNC, new Date().toISOString());

  return result;
}

// --- Treatments sync ---

export async function syncTreatmentsToCMS(env: Env): Promise<void> {
  const ids = await getCollectionIds(env);
  if (!ids) return;

  const products = await getProducts(env.PRICING_KV);
  const productIds = Object.keys(products);
  if (productIds.length === 0) return;

  const existingItems = await listItems(env, ids.treatments);
  const slugToItemId = new Map<string, string>();
  for (const item of existingItems) {
    if (item.fieldData?.slug) {
      slugToItemId.set(item.fieldData.slug, item.id);
    }
  }

  const toCreate: Array<{ fieldData: Record<string, any> }> = [];
  const toUpdate: Array<{ id: string; fieldData: Record<string, any> }> = [];

  for (const [productId, product] of Object.entries(products)) {
    const fieldData = {
      name: productId,
      slug: productId,
      'base-price': product.basePrice,
      active: true,
    };

    const existingItemId = slugToItemId.get(productId);
    if (existingItemId) {
      toUpdate.push({ id: existingItemId, fieldData });
    } else {
      toCreate.push({ fieldData });
    }
  }

  if (toCreate.length > 0) {
    await createLiveItems(env, ids.treatments, toCreate);
  }
  if (toUpdate.length > 0) {
    await updateLiveItems(env, ids.treatments, toUpdate);
  }

  // Publish all
  const allItems = await listItems(env, ids.treatments);
  const idsToPublish = allItems.map((item) => item.id);
  if (idsToPublish.length > 0) {
    await publishItems(env, ids.treatments, idsToPublish);
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
    await createLiveItems(env, ids.segments, toCreate);
  }
  if (toUpdate.length > 0) {
    await updateLiveItems(env, ids.segments, toUpdate);
  }

  // Publish all
  const allItems = await listItems(env, ids.segments);
  const idsToPublish = allItems.map((item) => item.id);
  if (idsToPublish.length > 0) {
    await publishItems(env, ids.segments, idsToPublish);
  }
}

// --- Orchestrated CMS sync with concurrency lock ---

const CMS_SYNC_LOCK_TTL_MS = 300_000; // 5 minutes

export async function performCMSSync(
  env: Env,
): Promise<{ pricing: CMSSyncResult; offers: CMSSyncResult }> {
  const lockKey = KV_KEYS.CMS_SYNC_LOCK;
  const existing = await env.PRICING_KV.get(lockKey);

  if (existing) {
    const lockTime = parseInt(existing, 10);
    if (Date.now() - lockTime < CMS_SYNC_LOCK_TTL_MS) {
      const skipped: CMSSyncResult = {
        created: 0, updated: 0, published: 0,
        errors: ['CMS sync already in progress'],
      };
      return { pricing: skipped, offers: skipped };
    }
  }

  await env.PRICING_KV.put(lockKey, String(Date.now()));

  try {
    const pricing = await syncPricingToCMS(env);
    const offers = await syncOffersToCMS(env);
    return { pricing, offers };
  } finally {
    await env.PRICING_KV.delete(lockKey);
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
    const [treatments, pricing, segments, offers] = await Promise.all([
      listItems(env, ids.treatments),
      listItems(env, ids.pricing),
      listItems(env, ids.segments),
      ids.offers ? listItems(env, ids.offers) : Promise.resolve([]),
    ]);
    itemCounts = {
      treatments: treatments.length,
      pricing: pricing.length,
      segments: segments.length,
      offers: offers.length,
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
