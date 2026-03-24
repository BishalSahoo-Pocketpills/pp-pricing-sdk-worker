import { sanitizeProductIds, sanitizeString, corsHeaders, readBodyWithLimit } from '@/security';
import { getPricing, updateProducts, getSegments, getMeta, getOffers } from '@/store';
import { fetchValidations, fetchQualifications } from '@/voucherify-client';
import { setupCollections, getCMSStatus, performCMSSync } from '@/cms';
import { KV_KEYS, CATALOG } from '@/config';
import type { Env, PricingEntry, PricingResponse, OffersResponse } from '@/types';

export async function handlePrices(
  request: Request,
  env: Env,
  segment: string,
  ctx?: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url);
  const rawProducts = url.searchParams.get('products') || '';
  const rawBasePrices = url.searchParams.get('basePrices') || '';

  const productIds = sanitizeProductIds(rawProducts);
  if (productIds.length === 0) {
    return jsonResponse(
      { error: 'Missing products parameter' },
      400,
      request,
      env,
    );
  }
  if (productIds.length > CATALOG.MAX_PRODUCT_IDS_PER_REQUEST) {
    return jsonResponse(
      { error: `Too many products (max ${CATALOG.MAX_PRODUCT_IDS_PER_REQUEST})` },
      400,
      request,
      env,
    );
  }

  const basePrices = rawBasePrices
    .split(',')
    .map((p) => parseFloat(p.trim()))
    .filter((p) => !isNaN(p));

  const sanitizedSegment = sanitizeString(segment, 128);

  // Read pricing from KV
  const pricing = await getPricing(env.PRICING_KV, sanitizedSegment);

  // Build response, filling in missing products with base prices
  const products: Record<string, PricingEntry> = {};
  const newProducts: Record<string, number> = {};

  for (let i = 0; i < productIds.length; i++) {
    const id = productIds[i];
    const basePrice = basePrices[i] ?? 0;

    if (pricing && pricing[id]) {
      products[id] = pricing[id];
    } else {
      // No cached pricing — return base price with no discount
      products[id] = {
        basePrice,
        discountedPrice: basePrice,
        discountAmount: 0,
        discountLabel: '',
        discountType: 'NONE',
        applicableVouchers: [],
      };
      // Register for future recomputation
      if (basePrice > 0) {
        newProducts[id] = basePrice;
      }
    }
  }

  // Register unknown products in catalog (background)
  if (Object.keys(newProducts).length > 0) {
    const updatePromise = updateProducts(env.PRICING_KV, newProducts).catch(
      (err) =>
        console.error('[pp-pricing-worker] Failed to update products:', err),
    );
    if (ctx) {
      ctx.waitUntil(updatePromise);
    }
  }

  const body: PricingResponse = {
    segment: sanitizedSegment,
    products,
    timestamp: Date.now(),
  };

  return jsonResponse(body, 200, request, env);
}

export async function handleValidate(
  request: Request,
  env: Env,
): Promise<Response> {
  const { body: rawBody, error: sizeError } = await readBodyWithLimit(request);
  if (sizeError) {
    return jsonResponse({ error: sizeError }, 413, request, env);
  }

  let body: any;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400, request, env);
  }

  // Wrap voucher code into Voucherify validations format if needed
  if (body.code && !body.redeemables) {
    body = {
      redeemables: [
        { object: 'voucher', id: sanitizeString(body.code, 64) },
      ],
      customer: body.customer,
      order: body.order,
    };
  } else if (body.code) {
    body.code = sanitizeString(body.code, 64);
  }

  // Strip fields that could be used for data enumeration
  body = sanitizeVoucherifyBody(body);

  try {
    const result = await fetchValidations(env, body);
    return jsonResponse(sanitizeValidationResponse(result), 200, request, env);
  } catch (error: any) {
    return jsonResponse(
      { error: error.message || 'Validation failed' },
      502,
      request,
      env,
    );
  }
}

export async function handleQualify(
  request: Request,
  env: Env,
): Promise<Response> {
  const { body: rawBody, error: sizeError } = await readBodyWithLimit(request);
  if (sizeError) {
    return jsonResponse({ error: sizeError }, 413, request, env);
  }

  let body: any;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400, request, env);
  }

  // Strip fields that could be used for data enumeration
  body = sanitizeVoucherifyBody(body);

  try {
    const result = await fetchQualifications(env, body);
    return jsonResponse(result, 200, request, env);
  } catch (error: any) {
    return jsonResponse(
      { error: error.message || 'Qualification failed' },
      502,
      request,
      env,
    );
  }
}

export async function handleSegments(
  request: Request,
  env: Env,
): Promise<Response> {
  const segments = await getSegments(env.PRICING_KV);
  return jsonResponse(segments, 200, request, env);
}

export async function handleHealth(
  request: Request,
  env: Env,
): Promise<Response> {
  const [lastRevalidation, segments, revalidationLock] = await Promise.all([
    getMeta(env.PRICING_KV, KV_KEYS.META_LAST_REVALIDATION),
    getSegments(env.PRICING_KV),
    env.PRICING_KV.get(KV_KEYS.REVALIDATION_LOCK),
  ]);

  return jsonResponse(
    {
      status: 'ok',
      lastRevalidation: lastRevalidation || null,
      segmentCount: segments.length,
      revalidating: revalidationLock !== null,
    },
    200,
    request,
    env,
  );
}

export async function handleCMSSetup(
  request: Request,
  env: Env,
): Promise<Response> {
  try {
    const ids = await setupCollections(env);
    return jsonResponse(ids, 200, request, env);
  } catch (error: any) {
    return jsonResponse(
      { error: error.message || 'CMS setup failed' },
      502,
      request,
      env,
    );
  }
}

export async function handleCMSStatus(
  request: Request,
  env: Env,
): Promise<Response> {
  try {
    const status = await getCMSStatus(env);
    return jsonResponse(status, 200, request, env);
  } catch (error: any) {
    return jsonResponse(
      { error: error.message || 'CMS status check failed' },
      502,
      request,
      env,
    );
  }
}

export async function handleCMSSync(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  // Fire-and-forget: sync in background, respond immediately
  ctx.waitUntil(
    performCMSSync(env)
      .then((syncResult) =>
        env.PRICING_KV.put(
          KV_KEYS.META_LAST_CMS_SYNC_RESULT,
          JSON.stringify({ status: 'ok', ...syncResult, timestamp: new Date().toISOString() }),
        ),
      )
      .catch((err) => {
        console.error('[pp-pricing-worker] CMS sync failed:', err);
        env.PRICING_KV.put(
          KV_KEYS.META_LAST_CMS_SYNC_RESULT,
          JSON.stringify({ status: 'error', error: (err as Error).message, timestamp: new Date().toISOString() }),
        ).catch(() => {});
      }),
  );

  return jsonResponse({ status: 'accepted', message: 'CMS sync started' }, 202, request, env);
}

export async function handleOffers(
  request: Request,
  env: Env,
  segment: string,
): Promise<Response> {
  const sanitizedSegment = sanitizeString(segment, 128);
  if (!sanitizedSegment) {
    return jsonResponse(
      { error: 'Missing segment parameter' },
      400,
      request,
      env,
    );
  }

  const offers = await getOffers(env.PRICING_KV, sanitizedSegment);

  const body: OffersResponse = {
    segment: sanitizedSegment,
    offers: offers || {
      coupons: [],
      promotions: [],
      loyalty: [],
      referrals: [],
      gifts: [],
    },
    timestamp: Date.now(),
  };

  return jsonResponse(body, 200, request, env);
}

function sanitizeValidationResponse(response: any): any {
  if (!response || typeof response !== 'object') return response;

  const sanitized: Record<string, any> = {
    valid: response.valid,
    tracking_id: undefined, // strip
  };

  if (Array.isArray(response.redeemables)) {
    sanitized.redeemables = response.redeemables.map((r: any) => ({
      id: r.id,
      object: r.object,
      status: r.status,
      result: r.result ? {
        discount: r.result.discount,
      } : undefined,
      applicable_to: r.applicable_to,
    }));
  }

  return sanitized;
}

const ALLOWED_VOUCHERIFY_KEYS = new Set([
  'redeemables', 'customer', 'order', 'code', 'scenario', 'options', 'metadata',
]);

function sanitizeVoucherifyBody(body: any): any {
  if (!body || typeof body !== 'object') return body;

  // Strip unknown top-level keys
  const sanitized: Record<string, any> = {};
  for (const key of Object.keys(body)) {
    if (ALLOWED_VOUCHERIFY_KEYS.has(key)) {
      sanitized[key] = body[key];
    }
  }

  // Restrict options to safe fields (prevent data enumeration via expand)
  if (sanitized.options && typeof sanitized.options === 'object') {
    const { limit, sorting_rule } = sanitized.options;
    sanitized.options = {
      ...(limit !== undefined && { limit: Math.min(Number(limit) || 50, 50) }),
      ...(sorting_rule && { sorting_rule }),
    };
  }

  return sanitized;
}

function jsonResponse(
  data: any,
  status: number,
  request: Request,
  env: Env,
): Response {
  const headers = corsHeaders(request, env.ALLOWED_ORIGINS);
  headers.set('Content-Type', 'application/json');

  if (status === 200) {
    headers.set('Cache-Control', 'public, max-age=60, s-maxage=300');
  }

  return new Response(JSON.stringify(data), { status, headers });
}
