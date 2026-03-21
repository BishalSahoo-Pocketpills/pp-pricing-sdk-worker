import { PRICING_EVENTS, KV_KEYS } from '@/config';
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
import { performCMSSync } from '@/cms';
import type { Env } from '@/types';

export async function handleWebhook(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const valid = await verifyWebhookSignature(
    request,
    env.VOUCHERIFY_WEBHOOK_SECRET,
  );
  if (!valid) {
    return new Response('Unauthorized', { status: 401 });
  }

  let payload: any;
  try {
    payload = await request.json();
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
}

export async function revalidateAllSegments(env: Env): Promise<void> {
  // Re-discover segments (campaign changes may add new ones)
  const segments = await discoverSegments(env);
  await setSegments(env.PRICING_KV, segments);

  // Read product catalog
  const products = await getProducts(env.PRICING_KV);
  if (Object.keys(products).length === 0) {
    console.warn('[pp-pricing-worker] Product catalog is empty, skipping revalidation');
    return;
  }

  // Qualify each segment in parallel
  const results = await Promise.all(
    segments.map(async (segment) => {
      try {
        const orderItems = Object.entries(products).map(
          ([id, product]) => ({
            source_id: id,
            related_object: 'product',
            quantity: 1,
            price: product.basePrice * 100, // cents
          }),
        );

        const response = await fetchQualifications(env, {
          customer: segment.customerContext,
          order: { items: orderItems },
          scenario: 'ALL',
          options: {
            expand: ['redeemable'],
            limit: 50,
            sorting_rule: 'BEST_DEAL',
          },
        });

        const redeemables = parseQualificationResponse(response);
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
    }),
  );

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

  // Sync pricing and offers to Webflow CMS if enabled
  if (env.CMS_SYNC_ENABLED === 'true') {
    try {
      await performCMSSync(env);
    } catch (error) {
      console.error('[pp-pricing-worker] CMS sync failed:', error);
    }
  }
}
