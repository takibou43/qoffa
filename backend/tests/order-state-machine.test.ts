import { describe, expect, it } from 'vitest';
import type { ActorType, OrderStatus } from '../src/generated/prisma/enums.js';
import { AppError } from '../src/lib/errors.js';
import {
  TERMINAL_STATUSES,
  TRANSITIONS,
  allowedNextStatuses,
  assertTransition,
  canTransition,
  isTerminal,
} from '../src/services/orderStateMachine.js';

const ALL_STATUSES = Object.keys(TRANSITIONS) as OrderStatus[];
const ALL_ACTORS: ActorType[] = ['CUSTOMER', 'SHOP', 'DRIVER', 'ADMIN', 'SYSTEM'];

/** المسار السعيد كما هو موصوف في المتطلبات */
const HAPPY_PATH: Array<[OrderStatus, OrderStatus, ActorType]> = [
  ['PENDING', 'SHOP_ACCEPTED', 'SHOP'],
  ['SHOP_ACCEPTED', 'PREPARING', 'SHOP'],
  ['PREPARING', 'READY_FOR_PICKUP', 'SHOP'],
  ['READY_FOR_PICKUP', 'DRIVER_ASSIGNED', 'DRIVER'],
  ['DRIVER_ASSIGNED', 'PICKED_UP', 'DRIVER'],
  ['PICKED_UP', 'OUT_FOR_DELIVERY', 'DRIVER'],
  ['OUT_FOR_DELIVERY', 'DELIVERED', 'DRIVER'],
];

describe('آلة حالات الطلب — المسار السعيد', () => {
  it.each(HAPPY_PATH)('يسمح %s → %s بواسطة %s', (from, to, actor) => {
    expect(canTransition(from, to, actor)).toBe(true);
    expect(() => assertTransition(from, to, actor)).not.toThrow();
  });

  it('يغطي المسار كاملًا من PENDING إلى DELIVERED', () => {
    let current: OrderStatus = 'PENDING';
    for (const [from, to, actor] of HAPPY_PATH) {
      expect(current).toBe(from);
      assertTransition(current, to, actor);
      current = to;
    }
    expect(current).toBe('DELIVERED');
  });
});

describe('آلة حالات الطلب — منع الانتقالات غير المنطقية', () => {
  const INVALID: Array<[OrderStatus, OrderStatus]> = [
    ['PENDING', 'DELIVERED'],
    ['PENDING', 'PICKED_UP'],
    ['PENDING', 'READY_FOR_PICKUP'],
    ['SHOP_ACCEPTED', 'OUT_FOR_DELIVERY'],
    ['PREPARING', 'DELIVERED'],
    ['PREPARING', 'DRIVER_ASSIGNED'],
    ['READY_FOR_PICKUP', 'DELIVERED'],
    ['DRIVER_ASSIGNED', 'DELIVERED'],
    ['PICKED_UP', 'PENDING'],
    ['OUT_FOR_DELIVERY', 'PREPARING'],
  ];

  it.each(INVALID)('يمنع %s → %s لأي جهة', (from, to) => {
    for (const actor of ALL_ACTORS) {
      expect(canTransition(from, to, actor)).toBe(false);
      expect(() => assertTransition(from, to, actor)).toThrow(AppError);
    }
  });

  it('يرفض بـ409 عند انتقال غير منطقي وبـ403 عند نقص الصلاحية', () => {
    // انتقال غير موجود أصلًا
    try {
      assertTransition('PENDING', 'DELIVERED', 'ADMIN');
      throw new Error('كان يجب أن يفشل');
    } catch (e) {
      expect((e as AppError).statusCode).toBe(409);
    }

    // انتقال موجود لكن الجهة غير مخوّلة
    try {
      assertTransition('PENDING', 'SHOP_ACCEPTED', 'CUSTOMER');
      throw new Error('كان يجب أن يفشل');
    } catch (e) {
      expect((e as AppError).statusCode).toBe(403);
    }
  });

  it('يمنع الانتقال إلى نفس الحالة', () => {
    expect(() => assertTransition('PREPARING', 'PREPARING', 'SHOP')).toThrow(AppError);
  });

  it('الحالات النهائية لا تقبل أي انتقال', () => {
    for (const terminal of TERMINAL_STATUSES) {
      expect(isTerminal(terminal)).toBe(true);
      expect(allowedNextStatuses(terminal)).toHaveLength(0);
      for (const to of ALL_STATUSES) {
        for (const actor of ALL_ACTORS) {
          expect(canTransition(terminal, to, actor)).toBe(false);
        }
      }
    }
  });
});

describe('آلة حالات الطلب — صلاحيات الجهات', () => {
  it('الزبون يلغي فقط قبل بدء التحضير', () => {
    expect(canTransition('PENDING', 'CANCELLED', 'CUSTOMER')).toBe(true);
    expect(canTransition('SHOP_ACCEPTED', 'CANCELLED', 'CUSTOMER')).toBe(true);
    expect(canTransition('PREPARING', 'CANCELLED', 'CUSTOMER')).toBe(false);
    expect(canTransition('READY_FOR_PICKUP', 'CANCELLED', 'CUSTOMER')).toBe(false);
    expect(canTransition('OUT_FOR_DELIVERY', 'CANCELLED', 'CUSTOMER')).toBe(false);
  });

  it('المحل يرفض فقط قبل بدء التحضير', () => {
    expect(canTransition('PENDING', 'REJECTED', 'SHOP')).toBe(true);
    expect(canTransition('SHOP_ACCEPTED', 'REJECTED', 'SHOP')).toBe(true);
    expect(canTransition('PREPARING', 'REJECTED', 'SHOP')).toBe(false);
  });

  it('المحل لا يستطيع القيام بخطوات الموصّل', () => {
    expect(canTransition('DRIVER_ASSIGNED', 'PICKED_UP', 'SHOP')).toBe(false);
    expect(canTransition('OUT_FOR_DELIVERY', 'DELIVERED', 'SHOP')).toBe(false);
  });

  it('الموصّل لا يستطيع القيام بخطوات المحل', () => {
    expect(canTransition('PENDING', 'SHOP_ACCEPTED', 'DRIVER')).toBe(false);
    expect(canTransition('PREPARING', 'READY_FOR_PICKUP', 'DRIVER')).toBe(false);
  });

  it('الزبون لا يستطيع تسليم طلبه بنفسه', () => {
    expect(canTransition('OUT_FOR_DELIVERY', 'DELIVERED', 'CUSTOMER')).toBe(false);
  });
});

describe('آلة حالات الطلب — الحالات الاستثنائية', () => {
  it('NO_DRIVER لا يُلغي الطلب ويسمح بإعادة المحاولة', () => {
    expect(canTransition('READY_FOR_PICKUP', 'NO_DRIVER', 'SYSTEM')).toBe(true);
    expect(canTransition('NO_DRIVER', 'READY_FOR_PICKUP', 'SYSTEM')).toBe(true);
    expect(canTransition('NO_DRIVER', 'READY_FOR_PICKUP', 'SHOP')).toBe(true);
    expect(isTerminal('NO_DRIVER')).toBe(false);
  });

  it('انسحاب الموصّل يعيد الطلب إلى البحث', () => {
    expect(canTransition('DRIVER_ASSIGNED', 'READY_FOR_PICKUP', 'DRIVER')).toBe(true);
    expect(canTransition('DRIVER_ASSIGNED', 'READY_FOR_PICKUP', 'SYSTEM')).toBe(true);
  });

  it('فشل التسليم قابل لإعادة المحاولة من الإدارة فقط', () => {
    expect(canTransition('PICKED_UP', 'FAILED_DELIVERY', 'DRIVER')).toBe(true);
    expect(canTransition('OUT_FOR_DELIVERY', 'FAILED_DELIVERY', 'DRIVER')).toBe(true);
    expect(canTransition('FAILED_DELIVERY', 'OUT_FOR_DELIVERY', 'ADMIN')).toBe(true);
    expect(canTransition('FAILED_DELIVERY', 'OUT_FOR_DELIVERY', 'DRIVER')).toBe(false);
  });
});

describe('آلة حالات الطلب — سلامة الجدول', () => {
  it('كل حالة معرّفة في الجدول', () => {
    const expected: OrderStatus[] = [
      'PENDING', 'SHOP_ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'DRIVER_ASSIGNED',
      'PICKED_UP', 'OUT_FOR_DELIVERY', 'DELIVERED', 'REJECTED', 'CANCELLED',
      'NO_DRIVER', 'FAILED_DELIVERY',
    ];
    expect(new Set(ALL_STATUSES)).toEqual(new Set(expected));
  });

  it('كل انتقال يملك جهة مخوّلة واحدة على الأقل', () => {
    for (const from of ALL_STATUSES) {
      for (const [to, actors] of Object.entries(TRANSITIONS[from])) {
        expect(actors, `${from} → ${to}`).toBeDefined();
        expect(actors!.length, `${from} → ${to}`).toBeGreaterThan(0);
      }
    }
  });

  it('لا توجد حالة يمكن الوصول إليها من نفسها', () => {
    for (const from of ALL_STATUSES) {
      expect(Object.keys(TRANSITIONS[from])).not.toContain(from);
    }
  });
});
