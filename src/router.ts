import { PATHS } from './config';
import { handleCorsPreflight } from './security';
import { handleWebhook } from './webhook';
import {
  handlePrices,
  handleValidate,
  handleQualify,
  handleSegments,
  handleHealth,
} from './api';
import type { Env } from './types';

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
    return handlePrices(request, env, segment);
  }

  // Validate
  if (method === 'POST' && pathname === PATHS.VALIDATE) {
    return handleValidate(request, env);
  }

  // Qualify
  if (method === 'POST' && pathname === PATHS.QUALIFY) {
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

  return new Response('Not Found', { status: 404 });
}
