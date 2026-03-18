import { KV_KEYS } from './config';
import type { PricingEntry, SegmentDefinition, ProductEntry } from './types';

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
  const existing = await getProducts(kv);
  const now = Date.now();

  for (const [id, basePrice] of Object.entries(incoming)) {
    existing[id] = { basePrice, lastSeen: now };
  }

  await setProducts(kv, existing);
  return existing;
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
