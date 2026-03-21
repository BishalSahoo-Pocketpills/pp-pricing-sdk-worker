import { DEFAULT_SEGMENTS } from '@/config';
import { getSegments, setSegments } from '@/store';
import {
  listCampaigns,
  listPromotionTiers,
  getValidationRules,
} from '@/voucherify-client';
import type { Env, SegmentDefinition } from '@/types';

export function parseValidationConditions(
  conditions: any,
): Record<string, any> | null {
  if (!conditions?.rules) return null;

  const metadata: Record<string, any> = {};

  for (const rule of conditions.rules) {
    // Look for customer.metadata equality checks
    if (
      rule.property &&
      typeof rule.property === 'string' &&
      rule.property.startsWith('customer.metadata.') &&
      rule.comparator === 'is'
    ) {
      const key = rule.property.replace('customer.metadata.', '');
      metadata[key] = rule.value;
    }

    // Recurse into nested rules
    if (rule.rules) {
      const nested = parseValidationConditions(rule);
      if (nested) {
        Object.assign(metadata, nested);
      }
    }
  }

  return Object.keys(metadata).length > 0 ? metadata : null;
}

export async function discoverSegments(
  env: Env,
): Promise<SegmentDefinition[]> {
  const segments: SegmentDefinition[] = [
    ...DEFAULT_SEGMENTS.map((s) => ({ ...s })),
  ];
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

      const key = Object.entries(metadata)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}:${v}`)
        .join(',');

      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        segments.push({
          key,
          label: `Auto: ${key}`,
          customerContext: { metadata },
          discoveredFrom: result.campaignId,
        });
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
