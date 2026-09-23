/**
 * تجهيز صورة المنتج قبل الرفع — في المتصفح، بلا أي مكتبة إضافية:
 * تصغير إلى 1024 بكسل كحد أقصى وضغط WebP (أو JPEG إن لم يدعم المتصفح WebP).
 * النتيجة عادة 50–250KB: مناسبة للهاتف وسريعة في قوائم قُفّة.
 * الخادم يعيد التحقق من كل شيء (النوع الحقيقي، الحجم، الأبعاد) — هذا تحسين لا حماية.
 */

export const MAX_SIDE = 1024;
/** أقصى حجم للملف الأصلي الذي يختاره المستخدم (قبل الضغط) */
export const MAX_PICKED_BYTES = 15 * 1024 * 1024;
/** حد الخادم بعد الضغط */
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const ACCEPT_ATTR = ACCEPTED_TYPES.join(',');

/** أبعاد جديدة تحافظ على النسبة ولا تتجاوز maxSide (ولا تكبّر الصور الصغيرة) */
export function fitWithin(width: number, height: number, maxSide = MAX_SIDE) {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** فحص أولي للملف المختار — رسالة عربية أو null */
export function checkPickedFile(file: { type: string; size: number }): string | null {
  if (!(ACCEPTED_TYPES as readonly string[]).includes(file.type)) {
    return 'اختر صورة بصيغة JPEG أو PNG أو WebP.';
  }
  if (file.size > MAX_PICKED_BYTES) return 'حجم الصورة كبير جدًا (الحد 15 ميغابايت).';
  return null;
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
}

/** يصغّر ويضغط الصورة؛ يعيد الملف الأصلي إن تعذّر ذلك وكان صالحًا للرفع كما هو */
export async function prepareImage(file: File): Promise<Blob> {
  const problem = checkPickedFile(file);
  if (problem) throw new Error(problem);

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('تعذّر قراءة الصورة. جرّب صورة أخرى.');
  }
  const { width, height } = fitWithin(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    if (file.size <= MAX_UPLOAD_BYTES) return file;
    throw new Error('تعذّر تجهيز الصورة على هذا الجهاز.');
  }
  // خلفية بيضاء: صور PNG الشفافة تبقى نظيفة بعد التحويل
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  let blob = await canvasToBlob(canvas, 'image/webp', 0.82);
  // بعض المتصفحات لا تدعم WebP فتعيد PNG ضخمة: نستعمل JPEG بدلها
  if (!blob || blob.type !== 'image/webp') blob = await canvasToBlob(canvas, 'image/jpeg', 0.85);
  if (!blob) throw new Error('تعذّر ضغط الصورة.');
  if (blob.size > MAX_UPLOAD_BYTES) throw new Error('الصورة ما زالت كبيرة بعد الضغط. جرّب صورة أخرى.');
  return blob;
}
