import { RETRY } from '@/config';
import type { Env } from '@/types';

function authHeaders(env: Env): Record<string, string> {
  return {
    'X-App-Id': env.VOUCHERIFY_APP_ID,
    'X-App-Token': env.VOUCHERIFY_SECRET_KEY,
    'Content-Type': 'application/json',
  };
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  retries = RETRY.MAX_RETRIES,
): Promise<any> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(RETRY.FETCH_TIMEOUT_MS),
      });

      if (response.ok) {
        return response.json();
      }

      // Retry on 429 rate limit
      if (response.status === 429) {
        const retryAfter = parseInt(response.headers.get('Retry-After') || '0', 10);
        lastError = new Error('Voucherify rate limited (429)');
        if (attempt < retries && retryAfter > 0) {
          await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
          continue;
        }
      } else if (response.status >= 400 && response.status < 500) {
        // Don't retry other client errors (4xx)
        const body = await response.text();
        throw new Error(
          `Voucherify API error ${response.status}: ${body}`,
        );
      }

      // Server error — retry
      if (!lastError) {
        lastError = new Error(`Voucherify API error ${response.status}`);
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Voucherify API error 4')) {
        throw error;
      }
      lastError = error as Error;
    }

    if (attempt < retries) {
      const delay = RETRY.BASE_DELAY_MS * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError!;
}

export async function fetchQualifications(
  env: Env,
  body: any,
): Promise<any> {
  return fetchWithRetry(
    `${env.VOUCHERIFY_BASE_URL}/v1/qualifications`,
    { method: 'POST', headers: authHeaders(env), body: JSON.stringify(body) },
  );
}

export async function fetchValidations(
  env: Env,
  body: any,
): Promise<any> {
  return fetchWithRetry(
    `${env.VOUCHERIFY_BASE_URL}/v1/validations`,
    { method: 'POST', headers: authHeaders(env), body: JSON.stringify(body) },
  );
}

export async function listCampaigns(
  env: Env,
  filters?: Record<string, string>,
): Promise<any> {
  const params = new URLSearchParams();
  if (filters) {
    for (const [key, value] of Object.entries(filters)) {
      params.set(key, value);
    }
  }
  const qs = params.toString();
  const url = `${env.VOUCHERIFY_BASE_URL}/v1/campaigns${qs ? '?' + qs : ''}`;
  return fetchWithRetry(url, { method: 'GET', headers: authHeaders(env) });
}

export async function listPromotionTiers(
  env: Env,
  campaignId: string,
): Promise<any> {
  return fetchWithRetry(
    `${env.VOUCHERIFY_BASE_URL}/v1/promotions/${encodeURIComponent(campaignId)}/tiers`,
    { method: 'GET', headers: authHeaders(env) },
  );
}

export async function getValidationRules(
  env: Env,
  ruleId: string,
): Promise<any> {
  return fetchWithRetry(
    `${env.VOUCHERIFY_BASE_URL}/v1/validation-rules/${encodeURIComponent(ruleId)}`,
    { method: 'GET', headers: authHeaders(env) },
  );
}
