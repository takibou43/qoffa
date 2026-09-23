/**
 * رموز QR للطلبات.
 *
 * - لا يحمل الـQR أي بيانات عن الطلب: فقط نوع الرمز + رمز عشوائي (256 بت) يتحقق منه الخادم.
 * - رمزان لكل طلب:
 *   P (الاستلام): يظهر للمحل وللموصّل المعيَّن — يمسحه الموصّل في المحل ليتأكد أنه يأخذ الطلبية الصحيحة.
 *   D (التسليم): يظهر للزبون فقط — يمسحه الموصّل عند الباب ليتأكد أنه يسلّم للطلب الصحيح.
 * - المسح لا يغيّر حالة الطلب أبدًا؛ تغيير الحالة يبقى عبر نقاط الانتقال المعتادة وآلة الحالات.
 */
import { AppError, notFound } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';
import type { OrderStatus } from '../generated/prisma/enums.js';
import { isTerminal } from './orderStateMachine.js';

export type QrKind = 'P' | 'D';
export type QrStage = 'PICKUP' | 'DELIVERY';

const PREFIX = 'QOFFA';
const PAYLOAD_RE = /^QOFFA:(P|D):([a-f0-9]{64})$/;

export const buildQrPayload = (kind: QrKind, token: string) => `${PREFIX}:${kind}:${token}`;

export function parseQrPayload(raw: unknown): { kind: QrKind; token: string } | null {
  if (typeof raw !== 'string') return null;
  const m = PAYLOAD_RE.exec(raw.trim());
  if (!m) return null;
  return { kind: m[1] as QrKind, token: m[2]! };
}

/** الحالات التي يُقبل فيها كل نوع */
const STAGE_STATUSES: Record<QrKind, readonly OrderStatus[]> = {
  P: ['DRIVER_ASSIGNED'],
  D: ['PICKED_UP', 'OUT_FOR_DELIVERY'],
};

/** حالات يُعرض فيها الـQR للأطراف (الطلب ما زال نشطًا) */
export const qrVisible = (status: OrderStatus) => !isTerminal(status);

const qrError = (status: number, code: string, message: string) =>
  new AppError(status, code, message);

/**
 * يتحقق الموصّل من رمز QR لطلبه الحالي.
 * يرفض: رمزًا غير صالح، رمزًا لطلب آخر، طلبًا غير مُسند إليه، طلبًا منتهيًا، أو رمزًا في غير مرحلته.
 */
export async function verifyOrderQr(orderId: string, driverProfileId: string, rawPayload: unknown) {
  const parsed = parseQrPayload(rawPayload);
  if (!parsed) throw qrError(400, 'QR_INVALID', 'رمز QR غير صالح — ليس رمز طلبية من قُفّة');

  const order = await prisma.order.findFirst({
    where: { id: orderId, driverId: driverProfileId },
    select: {
      id: true,
      code: true,
      status: true,
      total: true,
      paymentMethod: true,
      pickupToken: true,
      deliveryToken: true,
      pickupVerifiedAt: true,
      deliveryVerifiedAt: true,
      items: { select: { nameSnapshot: true, quantity: true, unitSnapshot: true } },
    },
  });
  if (!order) throw notFound('هذا الطلب غير مُسند إليك');

  const expected = parsed.kind === 'P' ? order.pickupToken : order.deliveryToken;
  if (parsed.token !== expected) {
    // هل هو رمز صحيح لكن لطلب آخر؟ (لا نكشف أي شيء عن ذلك الطلب)
    const other = await prisma.order.findFirst({
      where: parsed.kind === 'P' ? { pickupToken: parsed.token } : { deliveryToken: parsed.token },
      select: { id: true },
    });
    if (other) {
      throw qrError(409, 'QR_OTHER_ORDER', `هذا الرمز يخص طلبية أخرى وليس الطلب ${order.code}`);
    }
    throw qrError(400, 'QR_INVALID', 'رمز QR غير معروف أو قديم');
  }

  if (isTerminal(order.status) || order.status === 'FAILED_DELIVERY') {
    throw qrError(409, 'QR_EXPIRED', 'انتهت صلاحية هذا الرمز — الطلب لم يعد قيد التوصيل');
  }

  if (!STAGE_STATUSES[parsed.kind].includes(order.status)) {
    throw qrError(
      409,
      'QR_WRONG_STAGE',
      parsed.kind === 'P'
        ? 'هذا رمز الاستلام من المحل، والطلب قد استُلم بالفعل. امسح رمز الزبون عند التسليم.'
        : 'هذا رمز التسليم الخاص بالزبون. استلم الطلب من المحل أولًا.',
    );
  }

  const field = parsed.kind === 'P' ? 'pickupVerifiedAt' : 'deliveryVerifiedAt';
  const previous = order[field];
  let verifiedAt = previous;
  if (!previous) {
    const now = new Date();
    // يُسجَّل أول تحقق فقط، ومشروط ببقاء الحالة كما قرأناها
    const res = await prisma.order.updateMany({
      where: { id: order.id, status: order.status, [field]: null },
      data: { [field]: now },
    });
    verifiedAt = res.count === 1 ? now : previous;
  }

  return {
    verified: true as const,
    stage: (parsed.kind === 'P' ? 'PICKUP' : 'DELIVERY') as QrStage,
    alreadyVerified: Boolean(previous),
    verifiedAt,
    // الحد الأدنى اللازم للموصّل للتأكد من الطلبية — بلا هاتف ولا عنوان
    order: {
      id: order.id,
      code: order.code,
      status: order.status,
      total: order.total,
      paymentMethod: order.paymentMethod,
      itemsCount: order.items.reduce((n, i) => n + i.quantity, 0),
      items: order.items,
    },
  };
}
