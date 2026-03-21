import { KV_KEYS, WEBFLOW } from './config';
import { getPricing, getProducts, getSegments, getMeta, setMeta } from './store';
import {
  listCollections,
  createCollection,
  createField,
  listItems,
  createLiveItems,
  updateLiveItems,
  publishItems,
} from './webflow-client';
import type {
  Env,
  CMSCollectionIds,
  CMSSyncResult,
  CMSStatus,
  PricingEntry,
  ProductEntry,
  SegmentDefinition,
} from './types';

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

  const ids: CMSCollectionIds = { treatments, pricing, segments };
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

  if (treatments && pricing && segments) {
    const ids: CMSCollectionIds = {
      treatments: treatments.id,
      pricing: pricing.id,
      segments: segments.id,
    };
    await env.PRICING_KV.put(KV_KEYS.CMS_COLLECTION_IDS, JSON.stringify(ids));
    return ids;
  }

  return null;
}

// --- Pricing sync ---

function buildPricingSlug(productSlug: string, segment: string): string {
  return `${productSlug}--${segment}`;
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

  // For each segment, read pricing from KV and build CMS items
  for (const segment of segmentDefs) {
    const pricing = await getPricing(env.PRICING_KV, segment.key);
    if (!pricing) continue;

    for (const productId of productIds) {
      const entry = pricing[productId];
      if (!entry) continue;

      const fieldData = buildPricingFieldData(productId, segment.key, entry);
      const slug = fieldData.slug;
      const existingItemId = slugToItemId.get(slug);

      if (existingItemId) {
        toUpdate.push({ id: existingItemId, fieldData });
      } else {
        toCreate.push({ fieldData });
      }
    }
  }

  // Batch create
  if (toCreate.length > 0) {
    try {
      const created = await createLiveItems(env, ids.pricing, toCreate);
      result.created = created.length;
    } catch (error) {
      result.errors.push(`Create failed: ${(error as Error).message}`);
    }
  }

  // Batch update
  if (toUpdate.length > 0) {
    try {
      await updateLiveItems(env, ids.pricing, toUpdate);
      result.updated = toUpdate.length;
    } catch (error) {
      result.errors.push(`Update failed: ${(error as Error).message}`);
    }
  }

  // Publish all affected items
  const allItemIds = [
    ...toCreate.map((_, i) => `new_${i}`), // Placeholder — real IDs from create
    ...toUpdate.map((item) => item.id),
  ];

  // Re-read to get actual IDs after creation
  if (result.created > 0 || result.updated > 0) {
    try {
      const allItems = await listItems(env, ids.pricing);
      const idsToPublish = allItems.map((item) => item.id);
      if (idsToPublish.length > 0) {
        await publishItems(env, ids.pricing, idsToPublish);
        result.published = idsToPublish.length;
      }
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
    const [treatments, pricing, segments] = await Promise.all([
      listItems(env, ids.treatments),
      listItems(env, ids.pricing),
      listItems(env, ids.segments),
    ]);
    itemCounts = {
      treatments: treatments.length,
      pricing: pricing.length,
      segments: segments.length,
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
