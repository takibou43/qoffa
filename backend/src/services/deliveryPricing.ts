import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';

/**
 * تسعير التوصيل حسب المسافة بين المحل وعنوان الزبون.
 * الإدارة وحدها تضبط المعاملات (جدول PlatformSetting، مجموعة "delivery")،
 * والخادم وحده يحسب السعر — لا يُقبل أي سعر قادم من العميل أو من المحل.
 *
 *   المسافة المعتمدة = Haversine × roadFactor  (تقريب لمسافة الطريق، مقرّبة لـ 0.1 كم)
 *   السعر = baseFee + ceil(max(0, المسافة − baseKm)) × perKmFee
 */
export interface DeliveryPricingConfig {
  /** رسم أساسي بالدينار يغطي أول baseKm كم */
  baseFee: number;
  baseKm: number;
  /** دينار لكل كم إضافي (أو جزء منه) */
  perKmFee: number;
  /** أقصى مسافة توصيل مسموحة (كم) */
  maxKm: number;
  /** معامل تحويل المسافة المستقيمة إلى مسافة طريق تقريبية */
  roadFactor: number;
  /** حصة قفة الثابتة من رسوم التوصيل لكل طلبية (دج) — الباقي للموصّل */
  platformFee: number;
}

/** حصة قفة الافتراضية من رسوم التوصيل لكل طلبية */
export const DEFAULT_PLATFORM_FEE = 30;

export const PRICING_SETTING_KEYS = {
  baseFee: 'delivery.baseFee',
  baseKm: 'delivery.baseKm',
  perKmFee: 'delivery.perKmFee',
  maxKm: 'delivery.maxKm',
  roadFactor: 'delivery.roadFactor',
  platformFee: 'delivery.platformFee',
} as const;

const PRICING_LABELS: Record<keyof DeliveryPricingConfig, string> = {
  baseFee: 'رسم التوصيل الأساسي (دج)',
  baseKm: 'المسافة المشمولة بالرسم الأساسي (كم)',
  perKmFee: 'سعر الكيلومتر الإضافي (دج)',
  maxKm: 'أقصى مسافة توصيل (كم)',
  roadFactor: 'معامل تقريب مسافة الطريق',
  platformFee: 'حصة قفة من رسوم التوصيل (دج)',
};

export function defaultPricingConfig(): DeliveryPricingConfig {
  return {
    baseFee: env.DEFAULT_DELIVERY_FEE,
    baseKm: 2,
    perKmFee: 30,
    maxKm: 15,
    roadFactor: 1.3,
    platformFee: DEFAULT_PLATFORM_FEE,
  };
}

/** يقرأ الإعدادات من قاعدة البيانات مع قيم افتراضية لما لم تضبطه الإدارة بعد */
export async function loadPricingConfig(): Promise<DeliveryPricingConfig> {
  const rows = await prisma.platformSetting.findMany({
    where: { key: { in: Object.values(PRICING_SETTING_KEYS) } },
    select: { key: true, value: true },
  });
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const config = defaultPricingConfig();

  for (const name of Object.keys(PRICING_SETTING_KEYS) as (keyof DeliveryPricingConfig)[]) {
    const raw = byKey.get(PRICING_SETTING_KEYS[name]);
    const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
    if (Number.isFinite(n) && n >= 0) config[name] = n;
  }
  return config;
}

/** يحفظ الإعدادات دفعة واحدة (كلها أو لا شيء) */
export async function savePricingConfig(config: DeliveryPricingConfig, updatedById: string) {
  await prisma.$transaction(
    (Object.keys(PRICING_SETTING_KEYS) as (keyof DeliveryPricingConfig)[]).map((name) =>
      prisma.platformSetting.upsert({
        where: { key: PRICING_SETTING_KEYS[name] },
        update: { value: config[name], updatedById },
        create: {
          key: PRICING_SETTING_KEYS[name],
          value: config[name],
          label: PRICING_LABELS[name],
          group: 'delivery',
          updatedById,
        },
      }),
    ),
  );
}

export interface DeliveryQuote {
  /** المسافة المعتمدة للتسعير بالكيلومتر (بعد معامل الطريق) */
  distanceKm: number;
  /** رسم التوصيل بالدينار (عدد صحيح) */
  fee: number;
  /** false إن تجاوزت المسافة الحد الأقصى فلا يُقبل الطلب */
  withinRange: boolean;
}

/** حصة قفة الفعلية لطلب: لا تتجاوز رسوم التوصيل نفسها */
export const platformFeeFor = (config: DeliveryPricingConfig, deliveryFee: number) =>
  Math.min(Math.max(0, Math.round(config.platformFee)), deliveryFee);

/** دالة نقية — تُختبر دون قاعدة بيانات */
export function computeDeliveryFee(
  config: DeliveryPricingConfig,
  straightLineMeters: number,
): DeliveryQuote {
  const distanceKm = Math.round((straightLineMeters * config.roadFactor) / 100) / 10;
  const extraKm = Math.max(0, distanceKm - config.baseKm);
  const fee = Math.round(config.baseFee + Math.ceil(extraKm) * config.perKmFee);
  return { distanceKm, fee, withinRange: distanceKm <= config.maxKm };
}
