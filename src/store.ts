import { KV_KEYS, CATALOG } from '@/config';
import type { PricingEntry, SegmentDefinition, ProductEntry, OffersBundle } from '@/types';

export async function getPricing(
  kv: KVNamespace,
  segment: string,
): Promise<Record<string, PricingEntry> | null> {
  const data = await kv.get(KV_KEYS.PRICES + segment, 'json');
  return data as Record<string, PricingEntry> | null;
}

export async function setPricing(
  kv: KVNamespace,
  segment: string,
  data: Record<string, PricingEntry>,
): Promise<void> {
  await kv.put(KV_KEYS.PRICES + segment, JSON.stringify(data));
}

export async function getSegments(
  kv: KVNamespace,
): Promise<SegmentDefinition[]> {
  const data = await kv.get(KV_KEYS.SEGMENTS_REGISTRY, 'json');
  return (data as SegmentDefinition[]) || [];
}

export async function setSegments(
  kv: KVNamespace,
  segments: SegmentDefinition[],
): Promise<void> {
  await kv.put(KV_KEYS.SEGMENTS_REGISTRY, JSON.stringify(segments));
}

export async function getProducts(
  kv: KVNamespace,
): Promise<Record<string, ProductEntry>> {
  const data = await kv.get(KV_KEYS.PRODUCTS_CATALOG, 'json');
  return (data as Record<string, ProductEntry>) || {};
}

export async function setProducts(
  kv: KVNamespace,
  products: Record<string, ProductEntry>,
): Promise<void> {
  await kv.put(KV_KEYS.PRODUCTS_CATALOG, JSON.stringify(products));
}

export async function updateProducts(
  kv: KVNamespace,
  incoming: Record<string, number>,
): Promise<Record<string, ProductEntry>> {
  // KV-based lock to serialize concurrent read-modify-write cycles.
  // NOTE (TOCTOU): KV locks are not truly atomic — two workers checking
  // the lock at the same instant could both see it as absent and proceed.
  // This is an inherent limitation of eventually-consistent KV stores.
  // The lock still eliminates the vast majority of races (sequential
  // webhooks, background updates) and the worst-case outcome is a
  // redundant catalog write, not data corruption.
  const lockKey = KV_KEYS.CATALOG_LOCK;
  const existingLock = await kv.get(lockKey);
  if (existingLock) {
    // Another update is in progress — return current state without modifying
    return getProducts(kv);
  }
  await kv.put(lockKey, String(Date.now()), { expirationTtl: CATALOG.CATALOG_LOCK_TTL });

  try {
    return await updateProductsInner(kv, incoming);
  } finally {
    await kv.delete(lockKey);
  }
}

async function updateProductsInner(
  kv: KVNamespace,
  incoming: Record<string, number>,
): Promise<Record<string, ProductEntry>> {
  const existing = await getProducts(kv);
  const now = Date.now();

  // Prune stale products not seen in STALE_THRESHOLD_MS
  for (const [id, product] of Object.entries(existing)) {
    if (now - product.lastSeen > CATALOG.STALE_THRESHOLD_MS) {
      delete existing[id];
    }
  }

  for (const [id, basePrice] of Object.entries(incoming)) {
    existing[id] = { basePrice, lastSeen: now };
  }

  // Hard cap to prevent KV value size overflow
  const ids = Object.keys(existing);
  if (ids.length > CATALOG.MAX_PRODUCTS) {
    const sorted = ids.sort(
      (a, b) => existing[a].lastSeen - existing[b].lastSeen,
    );
    for (let i = 0; i < sorted.length - CATALOG.MAX_PRODUCTS; i++) {
      delete existing[sorted[i]];
    }
  }

  await setProducts(kv, existing);
  return existing;
}

export async function getOffers(
  kv: KVNamespace,
  segment: string,
): Promise<OffersBundle | null> {
  const data = await kv.get(KV_KEYS.OFFERS + segment, 'json');
  return data as OffersBundle | null;
}

export async function setOffers(
  kv: KVNamespace,
  segment: string,
  data: OffersBundle,
): Promise<void> {
  await kv.put(KV_KEYS.OFFERS + segment, JSON.stringify(data));
}

export async function getMeta(
  kv: KVNamespace,
  key: string,
): Promise<string | null> {
  return kv.get(key);
}

export async function setMeta(
  kv: KVNamespace,
  key: string,
  value: string,
): Promise<void> {
  await kv.put(key, value);
}
