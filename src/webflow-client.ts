import { RETRY, WEBFLOW } from '@/config';
import type { Env, WebflowCollection, WebflowField, WebflowItem } from '@/types';

function authHeaders(env: Env): Record<string, string> {
  return {
    Authorization: `Bearer ${env.WEBFLOW_API_TOKEN}`,
    'Content-Type': 'application/json',
    accept: 'application/json',
  };
}

async function webflowFetch(
  url: string,
  init: RequestInit,
  retries = RETRY.MAX_RETRIES,
): Promise<any> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, init);

      // Parse rate limit header for proactive delay
      const remaining = response.headers.get('X-RateLimit-Remaining');
      if (remaining !== null && parseInt(remaining, 10) <= 5) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      if (response.ok) {
        // Some endpoints (204) return no body
        const text = await response.text();
        return text ? JSON.parse(text) : null;
      }

      // Don't retry client errors (4xx) except 429
      if (response.status === 429) {
        lastError = new Error(`Webflow rate limited (429)`);
      } else if (response.status >= 400 && response.status < 500) {
        const body = await response.text();
        throw new Error(`Webflow API error ${response.status}: ${body}`);
      } else {
        lastError = new Error(`Webflow API error ${response.status}`);
      }
    } catch (error) {
      lastError = error as Error;
      // Don't retry 4xx (except 429)
      if (lastError.message.includes('API error 4') && !lastError.message.includes('429')) {
        throw lastError;
      }
    }

    if (attempt < retries) {
      const delay = RETRY.BASE_DELAY_MS * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError!;
}

// --- Collection operations ---

export async function listCollections(
  env: Env,
): Promise<WebflowCollection[]> {
  const data = await webflowFetch(
    `${WEBFLOW.API_BASE}/sites/${env.WEBFLOW_SITE_ID}/collections`,
    { method: 'GET', headers: authHeaders(env) },
  );
  return data?.collections || [];
}

export async function createCollection(
  env: Env,
  schema: { displayName: string; singularName: string; slug: string },
): Promise<WebflowCollection> {
  return webflowFetch(
    `${WEBFLOW.API_BASE}/sites/${env.WEBFLOW_SITE_ID}/collections`,
    {
      method: 'POST',
      headers: authHeaders(env),
      body: JSON.stringify(schema),
    },
  );
}

export async function createField(
  env: Env,
  collectionId: string,
  field: { type: string; displayName: string; slug: string; isRequired?: boolean },
): Promise<WebflowField> {
  return webflowFetch(
    `${WEBFLOW.API_BASE}/collections/${collectionId}/fields`,
    {
      method: 'POST',
      headers: authHeaders(env),
      body: JSON.stringify(field),
    },
  );
}

export async function createFieldMultiRef(
  env: Env,
  collectionId: string,
  field: { displayName: string; slug: string },
  targetCollectionId: string,
): Promise<WebflowField> {
  return webflowFetch(
    `${WEBFLOW.API_BASE}/collections/${collectionId}/fields`,
    {
      method: 'POST',
      headers: authHeaders(env),
      body: JSON.stringify({
        type: 'ItemRefSet',
        displayName: field.displayName,
        slug: field.slug,
        metadata: { collectionId: targetCollectionId },
      }),
    },
  );
}

// --- Item operations ---

export async function listItems(
  env: Env,
  collectionId: string,
  opts?: { offset?: number; limit?: number },
): Promise<WebflowItem[]> {
  const allItems: WebflowItem[] = [];
  let offset = opts?.offset ?? 0;
  const limit = opts?.limit ?? 100;

  while (true) {
    const data = await webflowFetch(
      `${WEBFLOW.API_BASE}/collections/${collectionId}/items?offset=${offset}&limit=${limit}`,
      { method: 'GET', headers: authHeaders(env) },
    );

    const items = data?.items || [];
    allItems.push(...items);

    // No more pages
    if (items.length < limit) break;
    offset += limit;
  }

  return allItems;
}

export async function createItem(
  env: Env,
  collectionId: string,
  fieldData: Record<string, any>,
): Promise<WebflowItem> {
  return webflowFetch(
    `${WEBFLOW.API_BASE}/collections/${collectionId}/items`,
    {
      method: 'POST',
      headers: authHeaders(env),
      body: JSON.stringify({ fieldData }),
    },
  );
}

export async function createItems(
  env: Env,
  collectionId: string,
  items: Array<{ fieldData: Record<string, any> }>,
): Promise<WebflowItem[]> {
  const results: WebflowItem[] = [];

  // Batch in chunks of BULK_LIMIT
  for (let i = 0; i < items.length; i += WEBFLOW.BULK_LIMIT) {
    const batch = items.slice(i, i + WEBFLOW.BULK_LIMIT);
    const data = await webflowFetch(
      `${WEBFLOW.API_BASE}/collections/${collectionId}/items`,
      {
        method: 'POST',
        headers: authHeaders(env),
        body: JSON.stringify({ items: batch }),
      },
    );
    if (data?.items) {
      results.push(...data.items);
    }
  }

  return results;
}

export async function updateItem(
  env: Env,
  collectionId: string,
  itemId: string,
  fieldData: Record<string, any>,
): Promise<WebflowItem> {
  return webflowFetch(
    `${WEBFLOW.API_BASE}/collections/${collectionId}/items/${itemId}`,
    {
      method: 'PATCH',
      headers: authHeaders(env),
      body: JSON.stringify({ fieldData }),
    },
  );
}

export async function updateItems(
  env: Env,
  collectionId: string,
  items: Array<{ id: string; fieldData: Record<string, any> }>,
): Promise<void> {
  // Batch in chunks of BULK_LIMIT
  for (let i = 0; i < items.length; i += WEBFLOW.BULK_LIMIT) {
    const batch = items.slice(i, i + WEBFLOW.BULK_LIMIT);
    await webflowFetch(
      `${WEBFLOW.API_BASE}/collections/${collectionId}/items`,
      {
        method: 'PATCH',
        headers: authHeaders(env),
        body: JSON.stringify({ items: batch }),
      },
    );
  }
}

export async function publishSite(env: Env): Promise<void> {
  await webflowFetch(
    `${WEBFLOW.API_BASE}/sites/${env.WEBFLOW_SITE_ID}/publish`,
    {
      method: 'POST',
      headers: authHeaders(env),
      body: JSON.stringify({ publishToWebflowSubdomain: true }),
    },
  );
}
