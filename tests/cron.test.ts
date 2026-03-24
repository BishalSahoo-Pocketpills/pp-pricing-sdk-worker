import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleScheduled, processPendingCMSSync } from '@/cron';
import { KV_KEYS } from '@/config';
import { MockKV } from './helpers/mock-kv';
import { mockEnv } from './helpers/fixtures';

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('handleScheduled', () => {
  it('runs revalidation and logs success', async () => {
    const kv = new MockKV();
    await kv.put(
      KV_KEYS.PRODUCTS_CATALOG,
      JSON.stringify({ 'prod-1': { basePrice: 100, lastSeen: 1000 } }),
    );
    const env = mockEnv({ PRICING_KV: kv as unknown as KVNamespace });

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const spy = vi.spyOn(globalThis, 'fetch');
    // discoverSegments fails
    spy.mockRejectedValueOnce(new Error('Network'));
    // anonymous qualifications
    spy.mockResolvedValueOnce(
      new Response(JSON.stringify({ redeemables: { data: [] } })),
    );
    // member qualifications
    spy.mockResolvedValueOnce(
      new Response(JSON.stringify({ redeemables: { data: [] } })),
    );

    await handleScheduled(env);

    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('revalidation started'),
    );
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('revalidation complete'),
    );
  });

  it('logs error when revalidation fails', async () => {
    // Force a KV error by using a broken KV
    const brokenKv = {
      get: vi.fn().mockRejectedValue(new Error('KV down')),
      put: vi.fn().mockRejectedValue(new Error('KV down')),
      delete: vi.fn().mockRejectedValue(new Error('KV down')),
    } as unknown as KVNamespace;
    const env = mockEnv({ PRICING_KV: brokenKv });

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network'));

    await handleScheduled(env);

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('revalidation failed'),
      expect.anything(),
    );
  });

  it('handles empty product catalog gracefully', async () => {
    const kv = new MockKV();
    const env = mockEnv({ PRICING_KV: kv as unknown as KVNamespace });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network'));

    await handleScheduled(env);

    // Should complete without error
    const lastRevalidation = await kv.get(KV_KEYS.META_LAST_REVALIDATION);
    expect(lastRevalidation).toBeNull();
  });
});

describe('processPendingCMSSync', () => {
  it('runs CMS sync when pending flag is set', async () => {
    const kv = new MockKV();
    await kv.put(KV_KEYS.CMS_SYNC_PENDING, new Date().toISOString());
    const env = mockEnv({ PRICING_KV: kv as unknown as KVNamespace });

    const cms = await import('@/cms');
    const syncSpy = vi.spyOn(cms, 'performCMSSync').mockResolvedValue({
      created: 1, updated: 0, published: 1, errors: [],
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});

    await processPendingCMSSync(env);

    expect(syncSpy).toHaveBeenCalledWith(env);
    // Pending flag should be cleared
    const pending = await kv.get(KV_KEYS.CMS_SYNC_PENDING);
    expect(pending).toBeNull();

    syncSpy.mockRestore();
  });

  it('does nothing when no pending flag exists', async () => {
    const kv = new MockKV();
    const env = mockEnv({ PRICING_KV: kv as unknown as KVNamespace });

    const cms = await import('@/cms');
    const syncSpy = vi.spyOn(cms, 'performCMSSync').mockResolvedValue({
      created: 0, updated: 0, published: 0, errors: [],
    });

    await processPendingCMSSync(env);

    expect(syncSpy).not.toHaveBeenCalled();

    syncSpy.mockRestore();
  });

  it('clears flag and logs error when CMS sync fails', async () => {
    const kv = new MockKV();
    await kv.put(KV_KEYS.CMS_SYNC_PENDING, new Date().toISOString());
    const env = mockEnv({ PRICING_KV: kv as unknown as KVNamespace });

    const cms = await import('@/cms');
    const syncSpy = vi.spyOn(cms, 'performCMSSync').mockRejectedValue(new Error('CMS down'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await processPendingCMSSync(env);

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('CMS sync failed'),
      expect.anything(),
    );
    // Pending flag should still be cleared
    const pending = await kv.get(KV_KEYS.CMS_SYNC_PENDING);
    expect(pending).toBeNull();

    syncSpy.mockRestore();
  });
});
