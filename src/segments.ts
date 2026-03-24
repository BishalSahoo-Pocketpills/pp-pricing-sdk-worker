import { DEFAULT_SEGMENTS, getConfiguredSegments } from '@/config';
import { getSegments, setSegments } from '@/store';
import {
  listCampaigns,
  listPromotionTiers,
  getValidationRules,
} from '@/voucherify-client';
import type { Env, SegmentDefinition } from '@/types';

export function parseValidationConditions(
  conditions: any,
  depth = 0,
): Record<string, any> | null {
  if (depth > 10 || !conditions?.rules) return null;

  const metadata: Record<string, any> = {};

  for (const rule of conditions.rules) {
    if (
      rule.property &&
      typeof rule.property === 'string' &&
      rule.property.startsWith('customer.metadata.')
    ) {
      const key = rule.property.replace('customer.metadata.', '');

      // Equality check
      if (rule.comparator === 'is') {
        metadata[key] = rule.value;
      }

      // IN list — store as array for segment expansion
      if (rule.comparator === 'in' && Array.isArray(rule.value)) {
        metadata[key] = rule.value;
      }
    }

    // Recurse into nested rules
    if (rule.rules) {
      const nested = parseValidationConditions(rule, depth + 1);
      if (nested) {
        Object.assign(metadata, nested);
      }
    }
  }

  return Object.keys(metadata).length > 0 ? metadata : null;
}

const MAX_EXPANDED_SEGMENTS = 50;

export function expandMetadata(
  metadata: Record<string, any>,
): Array<Record<string, any>> {
  const entries = Object.entries(metadata);
  const arrayEntries = entries.filter(([, v]) => Array.isArray(v));
  const scalarEntries = entries.filter(([, v]) => !Array.isArray(v));

  if (arrayEntries.length === 0) return [metadata];

  let results: Array<Record<string, any>> = [Object.fromEntries(scalarEntries)];

  for (const [key, values] of arrayEntries) {
    const capped = (values as any[]).slice(0, 10);
    const newResults: Array<Record<string, any>> = [];
    for (const base of results) {
      for (const val of capped) {
        newResults.push({ ...base, [key]: val });
      }
    }
    results = newResults;
    if (results.length >= MAX_EXPANDED_SEGMENTS) {
      results = results.slice(0, MAX_EXPANDED_SEGMENTS);
      break;
    }
  }

  return results;
}

export async function discoverSegments(
  env: Env,
): Promise<SegmentDefinition[]> {
  const segments: SegmentDefinition[] = getConfiguredSegments(env);
  const seenKeys = new Set(segments.map((s) => s.key));

  try {
    const campaignsResponse = await listCampaigns(env, {
      'filters[campaign_type]': 'PROMOTION',
      'filters[active]': 'true',
      limit: '100',
    });

    const campaigns = campaignsResponse?.campaigns || [];

    // Fetch tiers for all campaigns in parallel
    const tierResults = await Promise.all(
      campaigns
        .filter((c: any) => c.id)
        .map(async (campaign: any) => {
          try {
            const tiersResponse = await listPromotionTiers(env, campaign.id);
            return { campaignId: campaign.id, tiers: tiersResponse?.tiers || [] };
          } catch (error) {
            console.warn(`[pp-pricing-worker] Failed to fetch tiers for campaign ${campaign.id}:`, error);
            return { campaignId: campaign.id, tiers: [] };
          }
        }),
    );

    // Collect all rule IDs with their campaign context
    const ruleRequests: Array<{ ruleId: string; campaignId: string }> = [];
    for (const { campaignId, tiers } of tierResults) {
      for (const tier of tiers) {
        const ruleId = tier.validation_rule_assignments?.data?.[0]?.rule_id;
        if (ruleId) {
          ruleRequests.push({ ruleId, campaignId });
        }
      }
    }

    // Fetch all validation rules in parallel
    const ruleResults = await Promise.all(
      ruleRequests.map(async ({ ruleId, campaignId }) => {
        try {
          const rule = await getValidationRules(env, ruleId);
          return { rule, campaignId };
        } catch (error) {
          console.warn(`[pp-pricing-worker] Failed to fetch rule ${ruleId}:`, error);
          return null;
        }
      }),
    );

    for (const result of ruleResults) {
      if (!result) continue;
      const metadata = parseValidationConditions(result.rule?.rules);
      if (!metadata) continue;

      // Expand array values (from `in` comparators) into separate segments
      const expanded = expandMetadata(metadata);

      for (const singleMeta of expanded) {
        const key = Object.entries(singleMeta)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => `${k}:${v}`)
          .join(',');

        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          segments.push({
            key,
            label: `Auto: ${key}`,
            customerContext: { metadata: singleMeta },
            discoveredFrom: result.campaignId,
          });
        }
      }
    }
  } catch (error) {
    console.warn('[pp-pricing-worker] Segment discovery failed:', error);
  }

  return segments;
}

export async function getOrDiscoverSegments(
  env: Env,
): Promise<SegmentDefinition[]> {
  const existing = await getSegments(env.PRICING_KV);
  if (existing.length > 0) return existing;

  const discovered = await discoverSegments(env);
  await setSegments(env.PRICING_KV, discovered);
  return discovered;
}
