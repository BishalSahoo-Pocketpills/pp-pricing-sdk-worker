import { RETRY } from './config';
import type { Env } from './types';

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
      const response = await fetch(url, init);

      if (response.ok) {
        return response.json();
      }

      // Don't retry client errors (4xx)
      if (response.status >= 400 && response.status < 500) {
        const body = await response.text();
        throw new Error(
          `Voucherify API error ${response.status}: ${body}`,
        );
      }

      // Server error — retry
      lastError = new Error(`Voucherify API error ${response.status}`);
    } catch (error) {
      lastError = error as Error;
      // Don't retry if it was a 4xx we threw above
      if (lastError.message.includes('API error 4')) throw lastError;
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
