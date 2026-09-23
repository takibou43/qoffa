import { randomBytes } from 'node:crypto';
import { env } from '../config/env.js';
import { AppError } from './errors.js';
import { prisma } from './prisma.js';

/**
 * تخزين صور المنتجات.
 * الصورة نفسها لا تُحفظ في PostgreSQL: تُرفع إلى Supabase Storage (نفس مشروع Supabase الذي يستضيف
 * قاعدة البيانات — لا خدمة خارجية جديدة ولا package جديد؛ نستعمل REST عبر fetch المدمج في Node)،
 * ويُحفظ رابطها العام فقط في Product.imageUrl.
 *
 * الإعداد (بنفس نمط مفتاح JWT):
 *   SUPABASE_URL + SUPABASE_SECRET_KEY من متغيرات البيئة، وإلا يُقرآن من الجدول الخاص
 *   qoffa_private.app_secret (المفتاحان supabase_url و supabase_secret_key). لا تُطبع القيم أبدًا.
 * الدلو (bucket): product-images — عام للقراءة، والكتابة بالمفتاح السري من الخادم فقط.
 */

export interface StoredObject {
  /** المسار داخل الدلو، مثل products/<productId>/<random>.webp */
  path: string;
  /** الرابط العام الذي يُحفظ في Product.imageUrl */
  url: string;
}

export interface ImageStorage {
  put(path: string, bytes: Buffer, contentType: string): Promise<StoredObject>;
  remove(path: string): Promise<void>;
  /** يعيد مسار الملف داخل الدلو إن كان الرابط من تخزيننا، وإلا null (رابط خارجي قديم: لا نلمسه) */
  pathFromUrl(url: string): string | null;
}

export const PRODUCT_IMAGES_BUCKET = 'product-images';

export function storageUnavailable() {
  return new AppError(
    503,
    'STORAGE_UNAVAILABLE',
    'تخزين الصور غير مُهيّأ حاليًا على الخادم. حاول لاحقًا أو تواصل مع إدارة المنصة.',
  );
}

/* ───────────── Supabase Storage (REST) ───────────── */

export class SupabaseStorage implements ImageStorage {
  private readonly base: string;
  private readonly publicPrefix: string;

  constructor(
    url: string,
    private readonly key: string,
    private readonly bucket: string,
  ) {
    this.base = url.replace(/\/+$/, '');
    this.publicPrefix = `${this.base}/storage/v1/object/public/${bucket}/`;
  }

  private headers(extra: Record<string, string> = {}) {
    // المفاتيح الجديدة (sb_secret_…) تُرسل في apikey فقط؛ مفتاح service_role القديم (JWT) يُرسل في الاثنين
    const h: Record<string, string> = { apikey: this.key, ...extra };
    if (this.key.startsWith('eyJ')) h.Authorization = `Bearer ${this.key}`;
    return h;
  }

  async put(path: string, bytes: Buffer, contentType: string): Promise<StoredObject> {
    const res = await fetch(`${this.base}/storage/v1/object/${this.bucket}/${path}`, {
      method: 'POST',
      headers: this.headers({
        'Content-Type': contentType,
        // المسار فريد لكل رفع، فالملف لا يتغير أبدًا → تخزين مؤقت طويل عبر الـCDN
        'Cache-Control': 'max-age=31536000',
        'x-upsert': 'false',
      }),
      body: new Uint8Array(bytes),
    });
    if (!res.ok) {
      console.error('[storage] upload failed', res.status);
      throw new AppError(502, 'STORAGE_ERROR', 'تعذّر رفع الصورة إلى التخزين. حاول مرة أخرى.');
    }
    return { path, url: this.publicPrefix + path };
  }

  async remove(path: string): Promise<void> {
    const res = await fetch(`${this.base}/storage/v1/object/${this.bucket}`, {
      method: 'DELETE',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ prefixes: [path] }),
    });
    if (!res.ok) throw new Error(`storage delete failed: ${res.status}`);
  }

  pathFromUrl(url: string): string | null {
    if (!url.startsWith(this.publicPrefix)) return null;
    const p = url.slice(this.publicPrefix.length);
    return /^[A-Za-z0-9/_.-]+$/.test(p) && !p.includes('..') ? p : null;
  }
}

/* ───────────── تخزين في الذاكرة (للاختبارات فقط) ───────────── */

export class MemoryStorage implements ImageStorage {
  readonly files = new Map<string, { bytes: Buffer; contentType: string }>();
  static readonly PREFIX = 'https://storage.test/product-images/';
  failNextPut = false;
  /** تأخير مصطنع للرفع (لاختبار السباقات) */
  putDelayMs = 0;

  async put(path: string, bytes: Buffer, contentType: string): Promise<StoredObject> {
    if (this.putDelayMs) await new Promise((r) => setTimeout(r, this.putDelayMs));
    if (this.failNextPut) {
      this.failNextPut = false;
      throw new AppError(502, 'STORAGE_ERROR', 'تعذّر رفع الصورة إلى التخزين. حاول مرة أخرى.');
    }
    this.files.set(path, { bytes, contentType });
    return { path, url: MemoryStorage.PREFIX + path };
  }

  async remove(path: string): Promise<void> {
    this.files.delete(path);
  }

  pathFromUrl(url: string): string | null {
    return url.startsWith(MemoryStorage.PREFIX) ? url.slice(MemoryStorage.PREFIX.length) : null;
  }
}

/* ───────────── الإعداد ───────────── */

let override: ImageStorage | null = null;
let cached: Promise<ImageStorage | null> | null = null;

/** للاختبارات: حقن تخزين بديل (null يعيد السلوك الطبيعي) */
export function setImageStorage(s: ImageStorage | null) {
  override = s;
  cached = null;
}

async function readPrivateSecrets(): Promise<Record<string, string>> {
  try {
    const rows = await prisma.$queryRaw<{ key: string; value: string }[]>`
      SELECT key, value FROM qoffa_private.app_secret
      WHERE key IN ('supabase_url', 'supabase_secret_key')`;
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  } catch {
    // الجدول الخاص غير موجود (بيئة محلية) → لا إعداد
    return {};
  }
}

/** https فقط في الإنتاج؛ http://localhost مسموح محليًا (خادم تخزين تجريبي) */
export function isAllowedStorageUrl(url: string): boolean {
  const u = url.replace(/\/+$/, '');
  if (/^https:\/\/[a-z0-9.-]+$/i.test(u)) return true;
  return !env.isProduction && /^http:\/\/(localhost|127\.0\.0\.1):\d{2,5}$/.test(u);
}

/** التخزين المُهيّأ، أو null إن لم يُضبط (فتُرفض عمليات الرفع بـ503 بدل خطأ غامض) */
export async function getImageStorage(): Promise<ImageStorage | null> {
  if (override) return override;
  if (env.isTest) return null;
  cached ??= (async () => {
    let url = env.SUPABASE_URL || '';
    let key = env.SUPABASE_SECRET_KEY || '';
    if (!url || !key) {
      const s = await readPrivateSecrets();
      url ||= s.supabase_url ?? '';
      key ||= s.supabase_secret_key ?? '';
    }
    if (!isAllowedStorageUrl(url) || key.length < 20) return null;
    return new SupabaseStorage(url, key, env.STORAGE_BUCKET);
  })().catch(() => {
    cached = null;
    return null;
  });
  const s = await cached;
  if (!s) cached = null; // يسمح بإعادة المحاولة بعد ضبط الإعداد دون إعادة النشر
  return s;
}

export async function requireImageStorage(): Promise<ImageStorage> {
  const s = await getImageStorage();
  if (!s) throw storageUnavailable();
  return s;
}

/** مسار فريد غير قابل للتخمين لكل رفع — لا يُعاد استعمال مسار أبدًا (فلا مشاكل cache) */
export function newProductImagePath(productId: string, ext: string): string {
  const safeId = productId.replace(/[^A-Za-z0-9_-]/g, '');
  return `products/${safeId}/${Date.now().toString(36)}-${randomBytes(8).toString('hex')}.${ext}`;
}
