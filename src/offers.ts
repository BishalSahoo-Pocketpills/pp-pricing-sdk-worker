import type {
  Env,
  VoucherifyRedeemable,
  OfferCategory,
  OfferDiscount,
  OfferEntry,
  OffersBundle,
} from '@/types';
import { formatPrice } from '@/pricing';

export function categorizeRedeemable(r: VoucherifyRedeemable): OfferCategory {
  if (r.object === 'promotion_tier' || r.object === 'promotion_stack') {
    return 'promotion';
  }

  if (r.object === 'loyalty_card') {
    return 'loyalty';
  }

  // Result-based detection (works for both "campaign" and "voucher" objects)
  if (r.result?.loyalty_card) {
    return 'loyalty';
  }

  if (r.campaign_type === 'REFERRAL_PROGRAM') {
    return 'referral';
  }

  if (r.result?.gift) {
    return 'gift';
  }

  // campaign objects with a discount are auto-applied promotions
  if (r.object === 'campaign' && r.result?.discount) {
    return 'promotion';
  }

  return 'coupon';
}

function buildOfferLabel(discount: NonNullable<VoucherifyRedeemable['result']>['discount'], env: Env): string {
  if (!discount) return '';

  switch (discount.type) {
    case 'PERCENT':
      return discount.percent_off ? `${discount.percent_off}% OFF` : '';
    case 'AMOUNT':
      return discount.amount_off ? `${formatPrice(discount.amount_off / 100, env)} OFF` : '';
    case 'FIXED':
      return discount.fixed_amount ? `Fixed price ${formatPrice(discount.fixed_amount / 100, env)}` : '';
    case 'UNIT':
      return discount.unit_off ? `${discount.unit_off} free` : '';
    default:
      return '';
  }
}

export function buildOfferDiscount(
  r: VoucherifyRedeemable,
  env: Env,
): OfferDiscount | undefined {
  const discount = r.result?.discount;
  if (!discount) return undefined;

  return {
    type: discount.type || 'NONE',
    percentOff: discount.percent_off,
    amountOff: discount.amount_off ? discount.amount_off / 100 : undefined,
    fixedAmount: discount.fixed_amount ? discount.fixed_amount / 100 : undefined,
    unitOff: discount.unit_off,
    label: buildOfferLabel(discount, env),
  };
}

export function extractApplicableProductIds(r: VoucherifyRedeemable): string[] {
  const data = r.applicable_to?.data;
  if (!data || data.length === 0) return [];

  const ids: string[] = [];
  for (const item of data) {
    const id = item.source_id || item.id;
    if (id) ids.push(id);
  }
  return ids;
}

function buildDescription(r: VoucherifyRedeemable, category: OfferCategory, env: Env): string {
  const discount = r.result?.discount;

  if (category === 'loyalty' && r.result?.loyalty_card) {
    return `${r.result.loyalty_card.balance} points available`;
  }

  if (category === 'gift' && r.result?.gift) {
    return `${formatPrice(r.result.gift.balance / 100, env)} gift card balance`;
  }

  if (discount) {
    if (discount.type === 'PERCENT' && discount.percent_off) {
      return `Save ${discount.percent_off}% on your order`;
    }
    if (discount.type === 'AMOUNT' && discount.amount_off) {
      return `Save ${formatPrice(discount.amount_off / 100, env)} on your order`;
    }
    if (discount.type === 'FIXED' && discount.fixed_amount) {
      return `Fixed price ${formatPrice(discount.fixed_amount / 100, env)}`;
    }
  }

  return r.name || r.campaign_name || r.banner || r.campaign || '';
}

export function buildOfferEntry(r: VoucherifyRedeemable, env: Env): OfferEntry {
  const category = categorizeRedeemable(r);

  const entry: OfferEntry = {
    id: r.id,
    category,
    title: r.name || r.campaign_name || r.banner || r.campaign || '',
    description: buildDescription(r, category, env),
    applicableProductIds: extractApplicableProductIds(r),
  };

  if (r.voucher?.code) {
    entry.code = r.voucher.code;
  }

  const discount = buildOfferDiscount(r, env);
  if (discount) {
    entry.discount = discount;
  }

  if (r.result?.loyalty_card) {
    const lc = r.result.loyalty_card;
    entry.loyalty = {
      points: lc.points,
      balance: lc.balance,
      nextExpirationDate: lc.next_expiration_date,
      nextExpirationPoints: lc.next_expiration_points,
    };
  }

  if (r.result?.gift) {
    entry.gift = {
      amount: r.result.gift.amount,
      balance: r.result.gift.balance,
    };
  }

  if (r.campaign_name || r.name) {
    entry.campaignName = r.campaign_name || r.name;
  }

  if (r.metadata) {
    for (const _ in r.metadata) {
      entry.metadata = r.metadata;
      break;
    }
  }

  return entry;
}

// Discount type priority for cross-type sorting: PERCENT > AMOUNT > UNIT > FIXED > NONE
const DISCOUNT_TYPE_RANK: Record<string, number> = {
  PERCENT: 4,
  AMOUNT: 3,
  UNIT: 2,
  FIXED: 1,
  NONE: 0,
};

function discountSortValue(entry: OfferEntry): { rank: number; value: number } {
  if (!entry.discount) return { rank: 0, value: 0 };
  const d = entry.discount;
  const rank = DISCOUNT_TYPE_RANK[d.type] ?? 0;
  const value = d.percentOff || d.amountOff || d.unitOff || d.fixedAmount || 0;
  return { rank, value };
}

function compareOffers(a: OfferEntry, b: OfferEntry): number {
  const sa = discountSortValue(a);
  const sb = discountSortValue(b);
  // Same type: compare by value descending
  if (sa.rank === sb.rank) return sb.value - sa.value;
  // Different types: higher rank first
  return sb.rank - sa.rank;
}

export function buildOffersBundle(
  redeemables: VoucherifyRedeemable[],
  env: Env,
): OffersBundle {
  const bundle: OffersBundle = {
    coupons: [],
    promotions: [],
    loyalty: [],
    referrals: [],
    gifts: [],
  };

  for (const r of redeemables) {
    const entry = buildOfferEntry(r, env);

    switch (entry.category) {
      case 'coupon':
        bundle.coupons.push(entry);
        break;
      case 'promotion':
        bundle.promotions.push(entry);
        break;
      case 'loyalty':
        bundle.loyalty.push(entry);
        break;
      case 'referral':
        bundle.referrals.push(entry);
        break;
      case 'gift':
        bundle.gifts.push(entry);
        break;
    }
  }

  // Sort each category: same-type by value descending, cross-type by rank
  bundle.coupons.sort(compareOffers);
  bundle.promotions.sort(compareOffers);
  bundle.referrals.sort(compareOffers);
  bundle.gifts.sort(compareOffers);
  // loyalty sorted by balance descending
  bundle.loyalty.sort((a, b) => (b.loyalty?.balance || 0) - (a.loyalty?.balance || 0));

  return bundle;
}
