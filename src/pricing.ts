import type {
  Env,
  PricingEntry,
  ProductEntry,
  VoucherifyDiscount,
  VoucherifyRedeemable,
} from '@/types';

export function calculateDiscount(
  discount: VoucherifyDiscount,
  basePrice: number,
): { amount: number; type: PricingEntry['discountType'] } {
  switch (discount.type) {
    case 'PERCENT':
      return {
        amount: basePrice * ((discount.percent_off || 0) / 100),
        type: 'PERCENT',
      };
    case 'AMOUNT':
      return {
        amount: (discount.amount_off || 0) / 100,
        type: 'AMOUNT',
      };
    case 'FIXED':
      return {
        amount: basePrice - (discount.fixed_amount || 0) / 100,
        type: 'FIXED',
      };
    case 'UNIT':
      return {
        amount: (discount.unit_off || 0) * basePrice,
        type: 'UNIT',
      };
    default:
      return { amount: 0, type: 'NONE' };
  }
}

export function selectBestDiscount(
  redeemables: VoucherifyRedeemable[],
  basePrice: number,
): {
  amount: number;
  type: PricingEntry['discountType'];
  vouchers: string[];
  campaign?: string;
} {
  let bestAmount = 0;
  let bestType: PricingEntry['discountType'] = 'NONE';
  let bestCampaign: string | undefined;
  const vouchers: string[] = [];

  for (const redeemable of redeemables) {
    const discount = redeemable.result?.discount;
    if (!discount) continue;

    // Skip UNIT discounts with ADD_MISSING_ITEMS effect
    if (
      discount.type === 'UNIT' &&
      discount.effect === 'ADD_MISSING_ITEMS'
    ) {
      continue;
    }

    const { amount, type } = calculateDiscount(discount, basePrice);

    if (amount > bestAmount) {
      bestAmount = amount;
      bestType = type;
      bestCampaign = redeemable.campaign_name || redeemable.campaign;
    }

    if (amount > 0) {
      vouchers.push(redeemable.id);
    }
  }

  return { amount: bestAmount, type: bestType, vouchers, campaign: bestCampaign };
}

export function buildDiscountLabel(
  type: PricingEntry['discountType'],
  amount: number,
  basePrice: number,
  env: Env,
): string {
  if (type === 'NONE' || amount <= 0) return '';

  if (type === 'PERCENT') {
    const pct = Math.round((amount / basePrice) * 100);
    return `${pct}% OFF`;
  }

  return `${formatPrice(amount, env)} OFF`;
}

export function formatPrice(amount: number, env: Env): string {
  try {
    return new Intl.NumberFormat(env.PRICING_LOCALE, {
      style: 'currency',
      currency: env.PRICING_CURRENCY,
    }).format(amount);
  } catch {
    return `${env.PRICING_CURRENCY_SYMBOL}${amount.toFixed(2)}`;
  }
}

export function buildPricingEntry(
  basePrice: number,
  best: {
    amount: number;
    type: PricingEntry['discountType'];
    vouchers: string[];
    campaign?: string;
  },
  env: Env,
): PricingEntry {
  const discountedPrice = Math.max(0, basePrice - best.amount);

  return {
    basePrice,
    discountedPrice,
    discountAmount: best.amount,
    discountLabel: buildDiscountLabel(best.type, best.amount, basePrice, env),
    discountType: best.type,
    applicableVouchers: best.vouchers,
    campaignName: best.campaign,
  };
}

export function parseQualificationResponse(
  response: any,
): VoucherifyRedeemable[] {
  if (response?.qualifications?.redeemables?.data) {
    return response.qualifications.redeemables.data;
  }
  if (response?.redeemables?.data) {
    return response.redeemables.data;
  }
  if (Array.isArray(response?.data)) {
    return response.data;
  }
  return [];
}

function isApplicableToProduct(
  redeemable: VoucherifyRedeemable,
  productSourceId: string,
): boolean {
  const applicable = redeemable.applicable_to;
  // No applicable_to or empty list means applies to all products
  if (!applicable?.data || applicable.data.length === 0) return true;
  return applicable.data.some(
    (item) =>
      item.source_id === productSourceId || item.id === productSourceId,
  );
}

export function buildPricingMatrix(
  products: Record<string, ProductEntry>,
  redeemables: VoucherifyRedeemable[],
  env: Env,
): Record<string, PricingEntry> {
  const result: Record<string, PricingEntry> = {};

  for (const [productId, product] of Object.entries(products)) {
    const applicable = redeemables.filter((r) =>
      isApplicableToProduct(r, productId),
    );
    const best = selectBestDiscount(applicable, product.basePrice);
    result[productId] = buildPricingEntry(product.basePrice, best, env);
  }

  return result;
}
