import { revalidateAllSegments } from './webhook';
import { syncPricingToCMS } from './cms';
import type { Env } from './types';

export async function handleScheduled(env: Env): Promise<void> {
  console.log('[pp-pricing-worker] Scheduled revalidation started');
  try {
    await revalidateAllSegments(env);
    console.log('[pp-pricing-worker] Scheduled revalidation complete');
  } catch (error) {
    console.error('[pp-pricing-worker] Scheduled revalidation failed:', error);
  }
}
