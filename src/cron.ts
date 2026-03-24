import { revalidateAllSegments } from '@/webhook';
import { KV_KEYS } from '@/config';
import { performCMSSync } from '@/cms';
import type { Env } from '@/types';

export async function handleScheduled(env: Env): Promise<void> {
  console.log('[pp-pricing-worker] Scheduled revalidation started');
  try {
    await revalidateAllSegments(env);
    console.log('[pp-pricing-worker] Scheduled revalidation complete');
  } catch (error) {
    console.error('[pp-pricing-worker] Scheduled revalidation failed:', error);
  }

  // Process pending CMS sync (decoupled from revalidation)
  try {
    await processPendingCMSSync(env);
  } catch (error) {
    console.error('[pp-pricing-worker] CMS sync check failed:', error);
  }
}

export async function processPendingCMSSync(env: Env): Promise<void> {
  const pending = await env.PRICING_KV.get(KV_KEYS.CMS_SYNC_PENDING);
  if (!pending) return;

  // Clear flag before sync to avoid re-entry from overlapping cron runs
  await env.PRICING_KV.delete(KV_KEYS.CMS_SYNC_PENDING);

  try {
    await performCMSSync(env);
    console.log('[pp-pricing-worker] CMS sync complete (from pending flag)');
  } catch (error) {
    console.error('[pp-pricing-worker] CMS sync failed:', error);
  }
}
