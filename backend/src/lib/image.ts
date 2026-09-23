import { badRequest } from './errors.js';

/**
 * التحقق من ملف الصورة في الخادم — لا نثق بالواجهة ولا بترويسة Content-Type وحدها.
 * نقبل JPEG / PNG / WebP فقط، ونتحقق من «التوقيع السحري» للبايتات الأولى
 * (فلا يمر ملف تنفيذي أو HTML أو SVG حتى لو سُمّي .jpg)، ثم نقرأ الأبعاد من ترويسة الملف.
 */

/** الحد الأقصى لحجم الصورة المرفوعة. الواجهات تضغط الصورة قبل الرفع (عادة < 300KB). */
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
/** أبعاد معقولة: لا صور مصغّرة جدًا ولا ضخمة */
export const MIN_IMAGE_SIDE = 64;
export const MAX_IMAGE_SIDE = 4096;

export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ImageMime = (typeof ALLOWED_IMAGE_TYPES)[number];

const EXTENSION: Record<ImageMime, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export interface ValidImage {
  mime: ImageMime;
  ext: string;
  width: number;
  height: number;
  bytes: number;
}

/** يحدد النوع الحقيقي من محتوى الملف (لا من الاسم ولا الترويسة) */
export function sniffImageType(buf: Buffer): ImageMime | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (
    buf.length >= 8 &&
    buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (
    buf.length >= 12 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

/** يقرأ الأبعاد من ترويسة الصورة؛ null إن كانت الترويسة تالفة */
export function readImageSize(buf: Buffer, mime: ImageMime): { width: number; height: number } | null {
  try {
    if (mime === 'image/png') {
      if (buf.toString('ascii', 12, 16) !== 'IHDR') return null;
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    if (mime === 'image/webp') {
      const chunk = buf.toString('ascii', 12, 16);
      if (chunk === 'VP8X') {
        return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
      }
      if (chunk === 'VP8 ') {
        return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
      }
      if (chunk === 'VP8L') {
        const b = buf.readUInt32LE(21);
        return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
      }
      return null;
    }
    // JPEG: نمرّ على المقاطع حتى نجد SOFn
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) return null;
      const marker = buf[i + 1]!;
      if (marker === 0xff) {
        i += 1;
        continue;
      }
      const len = buf.readUInt16BE(i + 2);
      const isSof =
        marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      if (len < 2) return null;
      i += 2 + len;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * يتحقق من الصورة المرفوعة كاملة ويرمي 400/413 برسالة عربية واضحة.
 * declaredType = ترويسة Content-Type التي أرسلها العميل (يجب أن تطابق المحتوى الحقيقي).
 */
export function validateImage(body: unknown, declaredType: string | undefined): ValidImage {
  if (!Buffer.isBuffer(body) || body.length === 0) {
    throw badRequest('لم تُرسَل أي صورة. الصيغ المقبولة: JPEG أو PNG أو WebP');
  }
  if (body.length > MAX_IMAGE_BYTES) {
    throw badRequest(`حجم الصورة أكبر من المسموح (${MAX_IMAGE_BYTES / 1024 / 1024} ميغابايت)`);
  }
  const mime = sniffImageType(body);
  if (!mime) {
    throw badRequest('الملف ليس صورة مقبولة. الصيغ المسموحة: JPEG أو PNG أو WebP');
  }
  const declared = (declaredType ?? '').split(';')[0]!.trim().toLowerCase();
  const normalizedDeclared = declared === 'image/jpg' ? 'image/jpeg' : declared;
  if (normalizedDeclared !== mime) {
    throw badRequest('نوع الملف المعلن لا يطابق محتواه الحقيقي');
  }
  const size = readImageSize(body, mime);
  if (!size || size.width <= 0 || size.height <= 0) {
    throw badRequest('ملف الصورة تالف أو غير مكتمل');
  }
  if (Math.min(size.width, size.height) < MIN_IMAGE_SIDE) {
    throw badRequest(`الصورة صغيرة جدًا (أقل من ${MIN_IMAGE_SIDE} بكسل)`);
  }
  if (Math.max(size.width, size.height) > MAX_IMAGE_SIDE) {
    throw badRequest(`أبعاد الصورة كبيرة جدًا (الحد ${MAX_IMAGE_SIDE} بكسل)`);
  }
  return { mime, ext: EXTENSION[mime], ...size, bytes: body.length };
}
