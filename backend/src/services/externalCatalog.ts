import { env } from '../config/env.js';
import { MAX_IMAGE_BYTES, validateImage, type ValidImage } from '../lib/image.js';
import { ExternalHttpError, downloadImage, fetchJson } from '../lib/safeFetch.js';

/**
 * جلب بيانات المنتج وصورته من مصادر خارجية بالباركود — Open Food Facts أولًا ثم UPCitemdb.
 * يُستعمل فقط عند الحاجة (باركود غير موجود في قُفّة، أو منتج بلا صورة)، ولا يُستدعى أبدًا عند عرض المنتجات.
 * لا يُخزَّن أي رد خارجي كامل: نستخرج الاسم/العلامة/الحجم/صورة الواجهة فقط.
 * السعر والكمية من المصادر الخارجية لا يُستعملان إطلاقًا (كل محل يحدد سعره ومخزونه).
 */

export type ExternalSource = 'OPEN_FOOD_FACTS' | 'UPCITEMDB';

export interface ExternalProduct {
  source: ExternalSource;
  name: string;
  brand: string | null;
  /** الحجم/الكمية كما يكتبه المصدر (مثل "1 L") — يُحفظ كوحدة المنتج */
  quantity: string | null;
  /** روابط صور مرشّحة بالترتيب (صورة الواجهة/العبوة) */
  imageCandidates: string[];
}

export interface ExternalImage {
  source: ExternalSource;
  bytes: Buffer;
  image: ValidImage;
}

/** نتيجة مصدر واحد: FOUND / NOT_FOUND (نهائي) / ERROR (مؤقت: timeout، شبكة، حد الاستعمال) */
export type SourceResult =
  | { kind: 'FOUND'; product: ExternalProduct }
  | { kind: 'NOT_FOUND' }
  | { kind: 'ERROR'; reason: string };

export const OFF_API_HOST = 'world.openfoodfacts.org';
export const OFF_IMAGE_HOSTS = ['images.openfoodfacts.org'];
export const UPC_API_HOST = 'api.upcitemdb.com';
const API_TIMEOUT_MS = 4000;
const IMAGE_TIMEOUT_MS = 6000;

function userAgent() {
  // سياسة Open Food Facts: User-Agent مخصّص بصيغة AppName/Version (ContactEmail)
  return `Qoffa/0.1 (${env.platformOwnerEmail ?? 'contact@qoffa.dz'})`;
}

/* ───────────── أدوات ───────────── */

/** باركود صالح للبحث الخارجي: GTIN رقمي فقط (EAN-8 / UPC-A / EAN-13 / GTIN-14) */
export function isExternalLookupCandidate(barcode: string): boolean {
  return /^(\d{8}|\d{12,14})$/.test(barcode);
}

/**
 * تطابق مؤكد بين الباركود المطلوب وما أعاده المصدر.
 * نفس الـGTIN قد يُكتب بأصفار بادئة مختلفة (UPC-A 12 خانة = EAN-13 بصفر بادئ) — هذا نفس المنتج.
 * أي اختلاف آخر = منتج مختلف → نرفض النتيجة. لا نحوّل الباركود إلى رقم أبدًا (نقارن نصوصًا).
 */
export function sameGtin(requested: string, returned: unknown): boolean {
  if (typeof returned !== 'string' || !/^\d{1,14}$/.test(returned)) return false;
  if (requested === returned) return true;
  if (!/^\d+$/.test(requested)) return false;
  return requested.replace(/^0+/, '') === returned.replace(/^0+/, '');
}

function clean(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  // محارف التحكم (0–31 و127) تُستبدل بمسافة
  const noControl = Array.from(v, (ch) => {
    const c = ch.charCodeAt(0);
    return c < 32 || c === 127 ? ' ' : ch;
  }).join('');
  const s = noControl.replace(/\s+/g, ' ').trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max).trim() : s;
}

/** "COCA-COLA SERVICES SA/NV, Coca-Cola" → "Coca-Cola" (أقصر اسم علامة واضح) */
export function pickBrand(raw: unknown): string | null {
  const s = clean(raw, 200);
  if (!s) return null;
  const parts = s.split(',').map((p) => p.trim()).filter((p) => p.length >= 2);
  if (!parts.length) return null;
  return clean(parts.reduce((a, b) => (b.length < a.length ? b : a)), 60);
}

/* ───────────── Open Food Facts ───────────── */

interface OffResponse {
  status?: number;
  code?: string;
  product?: {
    code?: string;
    product_name?: string;
    product_name_fr?: string;
    product_name_ar?: string;
    product_name_en?: string;
    generic_name?: string;
    brands?: string;
    quantity?: string;
    image_front_url?: string;
    selected_images?: { front?: { display?: Record<string, string> } };
  };
}

/** صورة الواجهة الأمامية فقط (لا المكوّنات ولا جدول التغذية)، ومن مضيف صور OFF فقط */
export function offFrontImages(p: NonNullable<OffResponse['product']>): string[] {
  const display = p.selected_images?.front?.display ?? {};
  const ordered = [display.fr, display.ar, display.en, ...Object.values(display), p.image_front_url];
  const out: string[] = [];
  for (const url of ordered) {
    if (typeof url !== 'string') continue;
    try {
      const u = new URL(url);
      if (u.protocol !== 'https:' || !OFF_IMAGE_HOSTS.includes(u.hostname)) continue;
      if (!/\/front[_.]/.test(u.pathname)) continue;
    } catch {
      continue;
    }
    if (!out.includes(url)) out.push(url);
  }
  return out.slice(0, 3);
}

export async function lookupOpenFoodFacts(barcode: string): Promise<SourceResult> {
  const fields = [
    'code', 'product_name', 'product_name_fr', 'product_name_ar', 'product_name_en',
    'generic_name', 'brands', 'quantity', 'image_front_url', 'selected_images',
  ].join(',');
  let res: { status: number; body: OffResponse | null };
  try {
    res = await fetchJson<OffResponse>(
      `https://${OFF_API_HOST}/api/v2/product/${encodeURIComponent(barcode)}?fields=${fields}`,
      { allowedHosts: [OFF_API_HOST], timeoutMs: API_TIMEOUT_MS, headers: { 'User-Agent': userAgent() } },
    );
  } catch (err) {
    return { kind: 'ERROR', reason: (err as ExternalHttpError).kind ?? 'NETWORK' };
  }
  if (res.status === 404 || res.body?.status === 0) return { kind: 'NOT_FOUND' };
  if (res.status === 429) return { kind: 'ERROR', reason: 'RATE_LIMIT' };
  if (res.status !== 200 || !res.body?.product) return { kind: 'ERROR', reason: `HTTP_${res.status}` };

  const p = res.body.product;
  // التحقق من أن المنتج المُعاد هو نفس الباركود المطلوب
  if (!sameGtin(barcode, p.code ?? res.body.code)) return { kind: 'NOT_FOUND' };
  const name = clean(p.product_name || p.product_name_fr || p.product_name_en || p.product_name_ar || p.generic_name, 100);
  if (!name || name.length < 2) return { kind: 'NOT_FOUND' };
  return {
    kind: 'FOUND',
    product: {
      source: 'OPEN_FOOD_FACTS',
      name,
      brand: pickBrand(p.brands),
      quantity: clean(p.quantity, 30),
      imageCandidates: offFrontImages(p),
    },
  };
}

/* ───────────── UPCitemdb ───────────── */

interface UpcResponse {
  code?: string;
  items?: {
    ean?: string;
    upc?: string;
    title?: string;
    brand?: string;
    size?: string;
    images?: string[];
  }[];
}

export async function lookupUpcItemDb(barcode: string): Promise<SourceResult> {
  // بمفتاح: الخطة المدفوعة (المفتاح من متغير البيئة فقط، لا يُطبع أبدًا). بدونه: الخطة التجريبية المجانية.
  const key = env.UPCITEMDB_API_KEY;
  const url = key
    ? `https://${UPC_API_HOST}/prod/v1/lookup?upc=${encodeURIComponent(barcode)}`
    : `https://${UPC_API_HOST}/prod/trial/lookup?upc=${encodeURIComponent(barcode)}`;
  let res: { status: number; body: UpcResponse | null };
  try {
    res = await fetchJson<UpcResponse>(url, {
      allowedHosts: [UPC_API_HOST],
      timeoutMs: API_TIMEOUT_MS,
      headers: key ? { user_key: key, key_type: '3scale' } : {},
    });
  } catch (err) {
    return { kind: 'ERROR', reason: (err as ExternalHttpError).kind ?? 'NETWORK' };
  }
  if (res.status === 429) return { kind: 'ERROR', reason: 'RATE_LIMIT' };
  if (res.status === 404 || res.body?.code === 'NOT_FOUND' || res.body?.code === 'INVALID_UPC') {
    return { kind: 'NOT_FOUND' };
  }
  if (res.status !== 200 || res.body?.code !== 'OK') return { kind: 'ERROR', reason: `HTTP_${res.status}` };

  const item = (res.body.items ?? []).find((i) => sameGtin(barcode, i.ean) || sameGtin(barcode, i.upc));
  if (!item) return { kind: 'NOT_FOUND' };
  const name = clean(item.title, 100);
  if (!name || name.length < 2) return { kind: 'NOT_FOUND' };
  const images = (item.images ?? []).filter(
    (u): u is string => typeof u === 'string' && u.startsWith('https://') && u.length <= 1000,
  );
  return {
    kind: 'FOUND',
    product: {
      source: 'UPCITEMDB',
      name,
      brand: clean(item.brand, 60),
      quantity: clean(item.size, 30),
      imageCandidates: images.slice(0, 3),
    },
  };
}

/* ───────────── تنزيل الصورة والتحقق منها ───────────── */

/** يحاول المرشّحين بالترتيب؛ أول صورة سليمة تُعاد. أي فشل → null (لا يفشل المنتج كاملًا). */
export async function fetchExternalImage(p: ExternalProduct): Promise<ExternalImage | null> {
  for (const url of p.imageCandidates) {
    try {
      const { bytes, contentType } = await deps.download(url, {
        maxBytes: MAX_IMAGE_BYTES,
        timeoutMs: IMAGE_TIMEOUT_MS,
        // صور OFF من مضيفها الرسمي فقط؛ صور UPCitemdb تأتي من مواقع متاجر متعددة → حماية SSRF العامة
        allowedHosts: p.source === 'OPEN_FOOD_FACTS' ? OFF_IMAGE_HOSTS : undefined,
        userAgent: userAgent(),
      });
      const image = validateImage(bytes, contentType);
      return { source: p.source, bytes, image };
    } catch {
      // صورة غير صالحة/ضخمة/غير متاحة → نجرب المرشح التالي
    }
  }
  return null;
}

/* ───────────── قابلية الحقن للاختبارات ───────────── */

const deps = {
  off: lookupOpenFoodFacts,
  upc: lookupUpcItemDb,
  download: downloadImage,
};
const realDeps = { ...deps };
let testOverride = false;

/** مفعّل؟ في الاختبارات لا يُستدعى الإنترنت الحقيقي أبدًا إلا عبر مصادر وهمية محقونة */
export function externalLookupEnabled(): boolean {
  if (env.EXTERNAL_BARCODE_LOOKUP === 'off') return false;
  return !env.isTest || testOverride;
}

export const externalSources = {
  lookup: (source: ExternalSource, barcode: string) =>
    source === 'OPEN_FOOD_FACTS' ? deps.off(barcode) : deps.upc(barcode),
};

/** للاختبارات فقط: استبدال المصادر/التنزيل بنسخ وهمية؛ reset() يعيد الأصل */
export const externalCatalogTesting = {
  set(overrides: Partial<typeof deps>) {
    Object.assign(deps, overrides);
    testOverride = true;
  },
  reset() {
    Object.assign(deps, realDeps);
    testOverride = false;
  },
};
