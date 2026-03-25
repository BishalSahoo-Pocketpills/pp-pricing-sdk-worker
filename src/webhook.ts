import { PRICING_EVENTS, KV_KEYS, QUALIFICATION } from '@/config';
import { processPendingCMSSync } from '@/cron';
import { verifyWebhookSignature } from '@/security';
import { getProducts, setPricing, setOffers, getMeta, setMeta } from '@/store';
import { fetchQualifications } from '@/voucherify-client';
import {
  parseQualificationResponse,
  buildPricingMatrix,
} from '@/pricing';
import { buildOffersBundle } from '@/offers';
import { discoverSegments } from '@/segments';
import { setSegments } from '@/store';
import type { Env, ProductEntry, VoucherifyRedeemable } from '@/types';

export async function handleWebhook(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const { valid, body: rawBody } = await verifyWebhookSignature(
    request,
    env.VOUCHERIFY_WEBHOOK_SECRET,
  );
  if (!valid) {
    return new Response('Unauthorized', { status: 401 });
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response('Bad Request', { status: 400 });
  }

  const eventType = payload?.type;

  // Respond immediately, process in background
  ctx.waitUntil(processWebhook(eventType, env));

  return new Response('OK', { status: 200 });
}

export async function processWebhook(
  eventType: string | undefined,
  env: Env,
): Promise<void> {
  // Increment webhook counter
  const countStr = await getMeta(env.PRICING_KV, KV_KEYS.META_WEBHOOK_COUNT);
  const count = countStr ? parseInt(countStr, 10) : 0;
  await setMeta(env.PRICING_KV, KV_KEYS.META_WEBHOOK_COUNT, String(count + 1));

  // Filter irrelevant events
  if (eventType && !PRICING_EVENTS.includes(eventType as any)) {
    return;
  }

  await revalidateAllSegments(env);
  await processPendingCMSSync(env);
}

const REVALIDATION_LOCK_TTL = 30; // seconds
const SEGMENT_BATCH_SIZE = 5;

export async function revalidateAllSegments(env: Env): Promise<void> {
  // Debounce: skip if another revalidation is already in progress
  const lockKey = KV_KEYS.REVALIDATION_LOCK;
  const existing = await env.PRICING_KV.get(lockKey);
  if (existing) {
    console.warn('[pp-pricing-worker] Revalidation already in progress, skipping');
    return;
  }

  await env.PRICING_KV.put(lockKey, String(Date.now()), {
    expirationTtl: REVALIDATION_LOCK_TTL,
  });

  try {
    await revalidateAllSegmentsInner(env);
  } finally {
    await env.PRICING_KV.delete(lockKey);
  }
}

async function revalidateAllSegmentsInner(env: Env): Promise<void> {
  // Re-discover segments (campaign changes may add new ones)
  const segments = await discoverSegments(env);
  await setSegments(env.PRICING_KV, segments);

  // Read product catalog
  const products = await getProducts(env.PRICING_KV);
  if (Object.keys(products).length === 0) {
    console.warn('[pp-pricing-worker] Product catalog is empty, skipping revalidation');
    return;
  }

  // Qualify segments in batches to avoid Voucherify rate limiting
  const results: Array<{ segment: string; matrix: any; offers: any } | null> = [];
  for (let i = 0; i < segments.length; i += SEGMENT_BATCH_SIZE) {
    const batch = segments.slice(i, i + SEGMENT_BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map((segment) => qualifySegment(segment, products, env)),
    );
    results.push(...batchResults);
  }

  // Write pricing matrices and offers to KV in parallel
  const writes: Promise<void>[] = [];
  for (const result of results) {
    if (result) {
      writes.push(setPricing(env.PRICING_KV, result.segment, result.matrix));
      writes.push(setOffers(env.PRICING_KV, result.segment, result.offers));
    }
  }
  await Promise.all(writes);

  await setMeta(
    env.PRICING_KV,
    KV_KEYS.META_LAST_REVALIDATION,
    new Date().toISOString(),
  );

  // Flag CMS sync as pending for the cron job to pick up (decoupled from revalidation)
  if (env.CMS_SYNC_ENABLED === 'true') {
    await setMeta(env.PRICING_KV, KV_KEYS.CMS_SYNC_PENDING, new Date().toISOString());
  }
}

async function fetchAllQualifications(
  env: Env,
  body: any,
): Promise<VoucherifyRedeemable[]> {
  const allRedeemables: VoucherifyRedeemable[] = [];
  let page = 1;

  while (page <= QUALIFICATION.MAX_PAGES) {
    const response = await fetchQualifications(env, {
      ...body,
      options: { ...body.options, limit: QUALIFICATION.PAGE_LIMIT, page },
    });

    const redeemables = parseQualificationResponse(response);
    allRedeemables.push(...redeemables);

    const total = response?.qualifications?.redeemables?.total
      ?? response?.redeemables?.total
      ?? redeemables.length;

    if (allRedeemables.length >= total || redeemables.length < QUALIFICATION.PAGE_LIMIT) break;
    page++;
  }

  return allRedeemables;
}

async function qualifySegment(
  segment: { key: string; customerContext: Record<string, any> },
  products: Record<string, ProductEntry>,
  env: Env,
): Promise<{ segment: string; matrix: any; offers: any } | null> {
  try {
    const orderItems = Object.entries(products).map(
      ([id, product]) => ({
        source_id: id,
        related_object: 'product',
        quantity: 1,
        price: product.basePrice * 100, // cents
      }),
    );

    const redeemables = await fetchAllQualifications(env, {
      customer: segment.customerContext,
      order: { items: orderItems },
      scenario: 'ALL',
      options: {
        expand: ['redeemable'],
        sorting_rule: 'BEST_DEAL',
      },
    });

    const matrix = buildPricingMatrix(products, redeemables, env);
    const offers = buildOffersBundle(redeemables, env);
    return { segment: segment.key, matrix, offers };
  } catch (error) {
    console.error(
      `[pp-pricing-worker] Failed to qualify segment "${segment.key}":`,
      error,
    );
    return null;
  }
}
