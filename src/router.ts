import { PATHS } from '@/config';
import { handleCorsPreflight, verifyAdminToken } from '@/security';
import { handleWebhook } from '@/webhook';
import {
  handlePrices,
  handleOffers,
  handleValidate,
  handleQualify,
  handleSegments,
  handleHealth,
  handleCMSSetup,
  handleCMSStatus,
  handleCMSSync,
} from '@/api';
import type { Env } from '@/types';

export async function router(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method;

  // CORS preflight
  if (method === 'OPTIONS') {
    return handleCorsPreflight(request, env.ALLOWED_ORIGINS);
  }

  // Webhook
  if (method === 'POST' && pathname === PATHS.WEBHOOK) {
    return handleWebhook(request, env, ctx);
  }

  // Prices — /api/prices/:segment
  if (method === 'GET' && pathname.startsWith(PATHS.PRICES)) {
    const segment = pathname.slice(PATHS.PRICES.length);
    if (!segment) {
      return new Response('Missing segment', { status: 400 });
    }
    return handlePrices(request, env, segment, ctx);
  }

  // Offers — /api/offers/:segment
  if (method === 'GET' && pathname.startsWith(PATHS.OFFERS)) {
    const segment = pathname.slice(PATHS.OFFERS.length);
    if (!segment) {
      return new Response('Missing segment', { status: 400 });
    }
    return handleOffers(request, env, segment);
  }

  // Validate
  if (method === 'POST' && pathname === PATHS.VALIDATE) {
    return handleValidate(request, env);
  }

  // Qualify — requires admin token (internal use only)
  if (method === 'POST' && pathname === PATHS.QUALIFY) {
    if (!verifyAdminToken(request, env.ADMIN_API_TOKEN)) {
      return new Response('Unauthorized', { status: 401 });
    }
    return handleQualify(request, env);
  }

  // Segments
  if (method === 'GET' && pathname === PATHS.SEGMENTS) {
    return handleSegments(request, env);
  }

  // Health
  if (method === 'GET' && pathname === PATHS.HEALTH) {
    return handleHealth(request, env);
  }

  // CMS admin routes — require admin token
  if (
    pathname === PATHS.CMS_SETUP ||
    pathname === PATHS.CMS_STATUS ||
    pathname === PATHS.CMS_SYNC
  ) {
    if (!verifyAdminToken(request, env.ADMIN_API_TOKEN)) {
      return new Response('Unauthorized', { status: 401 });
    }

    // CMS Setup
    if (method === 'POST' && pathname === PATHS.CMS_SETUP) {
      return handleCMSSetup(request, env);
    }

    // CMS Status
    if (method === 'GET' && pathname === PATHS.CMS_STATUS) {
      return handleCMSStatus(request, env);
    }

    // CMS Sync
    if (method === 'POST' && pathname === PATHS.CMS_SYNC) {
      return handleCMSSync(request, env, ctx);
    }

    return new Response('Method Not Allowed', { status: 405 });
  }

  return new Response('Not Found', { status: 404 });
}
