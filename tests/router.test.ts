import { describe, it, expect, vi, beforeEach } from 'vitest';
import { router } from '../src/router';
import { MockKV } from './helpers/mock-kv';
import { mockEnv } from './helpers/fixtures';

function makeCtx(): ExecutionContext {
  return {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
  } as unknown as ExecutionContext;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('router', () => {
  const env = mockEnv();

  it('handles OPTIONS preflight', async () => {
    const req = new Request('https://worker.test/api/prices/anonymous', {
      method: 'OPTIONS',
      headers: { Origin: 'https://example.com' },
    });
    const res = await router(req, env, makeCtx());
    expect(res.status).toBe(204);
  });

  it('routes GET /health', async () => {
    const req = new Request('https://worker.test/health');
    const res = await router(req, env, makeCtx());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('ok');
  });

  it('routes GET /api/segments', async () => {
    const req = new Request('https://worker.test/api/segments');
    const res = await router(req, env, makeCtx());
    expect(res.status).toBe(200);
  });

  it('routes GET /api/prices/:segment', async () => {
    const req = new Request(
      'https://worker.test/api/prices/anonymous?products=p1&basePrices=10',
    );
    const res = await router(req, env, makeCtx());
    expect(res.status).toBe(200);
  });

  it('returns 400 for /api/prices/ without segment', async () => {
    const req = new Request('https://worker.test/api/prices/');
    const res = await router(req, env, makeCtx());
    expect(res.status).toBe(400);
  });

  it('routes POST /api/validate', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ valid: true })),
    );
    const req = new Request('https://worker.test/api/validate', {
      method: 'POST',
      body: JSON.stringify({ code: 'TEST' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await router(req, env, makeCtx());
    expect(res.status).toBe(200);
  });

  it('routes POST /api/qualify', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ redeemables: { data: [] } })),
    );
    const req = new Request('https://worker.test/api/qualify', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await router(req, env, makeCtx());
    expect(res.status).toBe(200);
  });

  it('routes POST /webhook', async () => {
    const req = new Request('https://worker.test/webhook', {
      method: 'POST',
      body: '{}',
      headers: { 'x-voucherify-signature': 'bad' },
    });
    const res = await router(req, env, makeCtx());
    // Fails HMAC — 401
    expect(res.status).toBe(401);
  });

  it('returns 404 for unknown paths', async () => {
    const req = new Request('https://worker.test/unknown');
    const res = await router(req, env, makeCtx());
    expect(res.status).toBe(404);
  });

  it('returns 404 for wrong method', async () => {
    const req = new Request('https://worker.test/health', {
      method: 'POST',
    });
    const res = await router(req, env, makeCtx());
    expect(res.status).toBe(404);
  });
});
