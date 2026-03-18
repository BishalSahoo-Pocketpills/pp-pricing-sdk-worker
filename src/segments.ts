import { DEFAULT_SEGMENTS } from './config';
import { getSegments, setSegments } from './store';
import {
  listCampaigns,
  listPromotionTiers,
  getValidationRules,
} from './voucherify-client';
import type { Env, SegmentDefinition } from './types';

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
    });

    const campaigns = campaignsResponse?.campaigns || [];

    for (const campaign of campaigns) {
      if (!campaign.id) continue;

      try {
        const tiersResponse = await listPromotionTiers(env, campaign.id);
        const tiers = tiersResponse?.tiers || [];

        for (const tier of tiers) {
          const ruleId =
            tier.validation_rule_assignments?.data?.[0]?.rule_id;
          if (!ruleId) continue;

          try {
            const rule = await getValidationRules(env, ruleId);
            const metadata = parseValidationConditions(rule?.rules);
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
                discoveredFrom: campaign.id,
              });
            }
          } catch {
            // Skip individual rule failures
          }
        }
      } catch {
        // Skip individual campaign failures
      }
    }
  } catch {
    // Discovery failed entirely — return defaults
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
