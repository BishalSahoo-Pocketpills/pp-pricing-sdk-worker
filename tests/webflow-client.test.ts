import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  listCollections,
  createCollection,
  createField,
  listItems,
  createItem,
  createItems,
  updateItem,
  updateItems,
  publishSite,
} from '@/webflow-client';
import { mockEnv } from './helpers/fixtures';
import type { Env } from '@/types';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function jsonResponse(data: any, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function textResponse(text: string, status: number): Response {
  return new Response(text, { status });
}

describe('webflow-client', () => {
  let env: Env;

  beforeEach(() => {
    vi.useFakeTimers();
    env = mockEnv();
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // =====================================================
  // listCollections
  // =====================================================

  describe('listCollections', () => {
    it('returns collections from Webflow API', async () => {
      const collections = [
        { id: 'col_1', displayName: 'Products', singularName: 'Product', slug: 'products', fields: [] },
      ];
      mockFetch.mockResolvedValueOnce(jsonResponse({ collections }));

      const result = await listCollections(env);

      expect(result).toEqual(collections);
      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe('https://api.webflow.com/v2/sites/test-site-id/collections');
      expect(init.method).toBe('GET');
      expect(init.headers.Authorization).toBe('Bearer test-webflow-token');
    });

    it('returns empty array when no collections field', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}));

      const result = await listCollections(env);
      expect(result).toEqual([]);
    });
  });

  // =====================================================
  // createCollection
  // =====================================================

  describe('createCollection', () => {
    it('creates a collection and returns it', async () => {
      const schema = { displayName: 'Pricing', singularName: 'Pricing', slug: 'pricing' };
      const created = { id: 'col_2', ...schema, fields: [] };
      mockFetch.mockResolvedValueOnce(jsonResponse(created));

      const result = await createCollection(env, schema);

      expect(result).toEqual(created);
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe('https://api.webflow.com/v2/sites/test-site-id/collections');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body)).toEqual(schema);
    });
  });

  // =====================================================
  // createField
  // =====================================================

  describe('createField', () => {
    it('creates a field on a collection', async () => {
      const field = { type: 'Number', displayName: 'Base Price', slug: 'base-price' };
      const created = { id: 'field_1', ...field };
      mockFetch.mockResolvedValueOnce(jsonResponse(created));

      const result = await createField(env, 'col_1', field);

      expect(result).toEqual(created);
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe('https://api.webflow.com/v2/collections/col_1/fields');
      expect(init.method).toBe('POST');
    });
  });

  // =====================================================
  // listItems
  // =====================================================

  describe('listItems', () => {
    it('returns all items with pagination', async () => {
      const page1 = Array.from({ length: 100 }, (_, i) => ({
        id: `item_${i}`,
        fieldData: { name: `Item ${i}` },
        isDraft: false,
        isArchived: false,
        createdOn: '',
        lastUpdated: '',
      }));
      const page2 = [
        { id: 'item_100', fieldData: { name: 'Item 100' }, isDraft: false, isArchived: false, createdOn: '', lastUpdated: '' },
      ];

      mockFetch.mockResolvedValueOnce(jsonResponse({ items: page1 }));
      mockFetch.mockResolvedValueOnce(jsonResponse({ items: page2 }));

      const result = await listItems(env, 'col_1');

      expect(result).toHaveLength(101);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch.mock.calls[0][0]).toContain('offset=0&limit=100');
      expect(mockFetch.mock.calls[1][0]).toContain('offset=100&limit=100');
    });

    it('returns items from single page', async () => {
      const items = [
        { id: 'item_1', fieldData: {}, isDraft: false, isArchived: false, createdOn: '', lastUpdated: '' },
      ];
      mockFetch.mockResolvedValueOnce(jsonResponse({ items }));

      const result = await listItems(env, 'col_1');
      expect(result).toHaveLength(1);
      expect(mockFetch).toHaveBeenCalledOnce();
    });

    it('returns empty array when no items', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ items: [] }));

      const result = await listItems(env, 'col_1');
      expect(result).toEqual([]);
    });
  });

  // =====================================================
  // createItem
  // =====================================================

  describe('createItem', () => {
    it('creates a single item', async () => {
      const fieldData = { name: 'Test', slug: 'test' };
      const created = { id: 'item_1', fieldData, isDraft: false, isArchived: false, createdOn: '', lastUpdated: '' };
      mockFetch.mockResolvedValueOnce(jsonResponse(created));

      const result = await createItem(env, 'col_1', fieldData);

      expect(result).toEqual(created);
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe('https://api.webflow.com/v2/collections/col_1/items');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body)).toEqual({ fieldData });
    });
  });

  // =====================================================
  // createItems (bulk)
  // =====================================================

  describe('createItems', () => {
    it('creates items in bulk', async () => {
      const items = [
        { fieldData: { name: 'A', slug: 'a' } },
        { fieldData: { name: 'B', slug: 'b' } },
      ];
      const created = [
        { id: 'item_1', fieldData: items[0].fieldData, isDraft: false, isArchived: false, createdOn: '', lastUpdated: '' },
        { id: 'item_2', fieldData: items[1].fieldData, isDraft: false, isArchived: false, createdOn: '', lastUpdated: '' },
      ];
      mockFetch.mockResolvedValueOnce(jsonResponse({ items: created }));

      const result = await createItems(env, 'col_1', items);

      expect(result).toHaveLength(2);
      expect(mockFetch).toHaveBeenCalledOnce();
    });

    it('batches items exceeding BULK_LIMIT', async () => {
      const items = Array.from({ length: 150 }, (_, i) => ({
        fieldData: { name: `Item ${i}`, slug: `item-${i}` },
      }));
      const batch1Result = Array.from({ length: 100 }, (_, i) => ({
        id: `item_${i}`, fieldData: items[i].fieldData,
        isDraft: false, isArchived: false, createdOn: '', lastUpdated: '',
      }));
      const batch2Result = Array.from({ length: 50 }, (_, i) => ({
        id: `item_${100 + i}`, fieldData: items[100 + i].fieldData,
        isDraft: false, isArchived: false, createdOn: '', lastUpdated: '',
      }));

      mockFetch.mockResolvedValueOnce(jsonResponse({ items: batch1Result }));
      mockFetch.mockResolvedValueOnce(jsonResponse({ items: batch2Result }));

      const result = await createItems(env, 'col_1', items);

      expect(result).toHaveLength(150);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('handles empty items response', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}));

      const result = await createItems(env, 'col_1', [{ fieldData: { name: 'X' } }]);
      expect(result).toEqual([]);
    });
  });

  // =====================================================
  // updateItem
  // =====================================================

  describe('updateItem', () => {
    it('updates a single item', async () => {
      const fieldData = { name: 'Updated' };
      const updated = { id: 'item_1', fieldData, isDraft: false, isArchived: false, createdOn: '', lastUpdated: '' };
      mockFetch.mockResolvedValueOnce(jsonResponse(updated));

      const result = await updateItem(env, 'col_1', 'item_1', fieldData);

      expect(result).toEqual(updated);
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe('https://api.webflow.com/v2/collections/col_1/items/item_1');
      expect(init.method).toBe('PATCH');
    });
  });

  // =====================================================
  // updateItems (bulk)
  // =====================================================

  describe('updateItems', () => {
    it('updates items in bulk', async () => {
      const items = [
        { id: 'item_1', fieldData: { name: 'Updated A' } },
        { id: 'item_2', fieldData: { name: 'Updated B' } },
      ];
      mockFetch.mockResolvedValueOnce(jsonResponse(null));

      await updateItems(env, 'col_1', items);

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe('https://api.webflow.com/v2/collections/col_1/items');
      expect(init.method).toBe('PATCH');
    });

    it('batches updates exceeding BULK_LIMIT', async () => {
      const items = Array.from({ length: 150 }, (_, i) => ({
        id: `item_${i}`,
        fieldData: { name: `Updated ${i}` },
      }));

      mockFetch.mockResolvedValueOnce(jsonResponse(null));
      mockFetch.mockResolvedValueOnce(jsonResponse(null));

      await updateItems(env, 'col_1', items);

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  // =====================================================
  // publishSite
  // =====================================================

  describe('publishSite', () => {
    it('publishes the site', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ queued: true }));

      await publishSite(env);

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe('https://api.webflow.com/v2/sites/test-site-id/publish');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body)).toEqual({ publishToWebflowSubdomain: true });
    });
  });

  // =====================================================
  // Retry and error handling
  // =====================================================

  describe('retry behavior', () => {
    it('retries on 429 rate limit', async () => {
      mockFetch.mockResolvedValueOnce(textResponse('Rate limited', 429));
      mockFetch.mockResolvedValueOnce(textResponse('Rate limited', 429));
      mockFetch.mockResolvedValueOnce(jsonResponse({ collections: [] }));

      const promise = listCollections(env);

      // Advance past retry delays (500ms, 1000ms)
      await vi.advanceTimersByTimeAsync(500);
      await vi.advanceTimersByTimeAsync(1000);

      const result = await promise;
      expect(result).toEqual([]);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('retries on 5xx server error', async () => {
      mockFetch.mockResolvedValueOnce(textResponse('Server error', 500));
      mockFetch.mockResolvedValueOnce(jsonResponse({ collections: [] }));

      const promise = listCollections(env);
      await vi.advanceTimersByTimeAsync(500);

      const result = await promise;
      expect(result).toEqual([]);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('does not retry on 4xx client error (except 429)', async () => {
      mockFetch.mockResolvedValueOnce(textResponse('Not found', 404));

      await expect(listCollections(env)).rejects.toThrow('Webflow API error 404');
      expect(mockFetch).toHaveBeenCalledOnce();
    });

    it('does not retry on 400 error', async () => {
      mockFetch.mockResolvedValueOnce(textResponse('Bad request', 400));

      await expect(createCollection(env, { displayName: 'X', singularName: 'X', slug: 'x' })).rejects.toThrow(
        'Webflow API error 400',
      );
      expect(mockFetch).toHaveBeenCalledOnce();
    });

    it('throws after exhausting retries on 5xx', async () => {
      mockFetch.mockResolvedValue(textResponse('Server error', 500));

      const promise = listCollections(env);
      // Prevent unhandled rejection before timers advance
      promise.catch(() => {});

      // 4 attempts: initial + 3 retries
      await vi.runAllTimersAsync();

      await expect(promise).rejects.toThrow('Webflow API error 500');
      expect(mockFetch).toHaveBeenCalledTimes(4);
    });

    it('retries on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network failure'));
      mockFetch.mockResolvedValueOnce(jsonResponse({ collections: [] }));

      const promise = listCollections(env);
      await vi.advanceTimersByTimeAsync(500);

      const result = await promise;
      expect(result).toEqual([]);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  // =====================================================
  // Rate limit header handling
  // =====================================================

  describe('rate limit awareness', () => {
    it('delays when X-RateLimit-Remaining is low', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ collections: [] }, 200, { 'X-RateLimit-Remaining': '3' }),
      );

      const promise = listCollections(env);
      await vi.advanceTimersByTimeAsync(1000);

      const result = await promise;
      expect(result).toEqual([]);
    });
  });

  // =====================================================
  // Empty response body handling
  // =====================================================

  describe('empty response body', () => {
    it('handles 204 No Content', async () => {
      mockFetch.mockResolvedValueOnce(new Response('', { status: 200 }));

      const result = await publishSite(env);
      expect(result).toBeUndefined();
    });
  });
});
