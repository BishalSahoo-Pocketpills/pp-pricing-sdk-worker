import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleScheduled } from '../src/cron';
import { MockKV } from './helpers/mock-kv';
import { mockEnv } from './helpers/fixtures';

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('handleScheduled', () => {
  it('runs revalidation and logs success', async () => {
    const kv = new MockKV();
    await kv.put(
      'products:catalog',
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
    const kv = new MockKV();
    // Force a KV error by using a broken KV
    const brokenKv = {
      get: vi.fn().mockRejectedValue(new Error('KV down')),
      put: vi.fn().mockRejectedValue(new Error('KV down')),
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
    const lastRevalidation = await kv.get('meta:last-revalidation');
    expect(lastRevalidation).toBeNull();
  });
});
