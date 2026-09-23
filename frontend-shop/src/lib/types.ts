export type OrderStatus =
  | 'PENDING' | 'SHOP_ACCEPTED' | 'PREPARING' | 'READY_FOR_PICKUP'
  | 'DRIVER_ASSIGNED' | 'PICKED_UP' | 'OUT_FOR_DELIVERY' | 'DELIVERED'
  | 'REJECTED' | 'CANCELLED' | 'NO_DRIVER' | 'FAILED_DELIVERY';

export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';

export interface User {
  id: string;
  fullName: string;
  phone: string;
  email: string | null;
  role: string;
  status: string;
  mustChangePassword?: boolean;
  shop?: { id: string; name: string; status: ApprovalStatus; isOpen: boolean } | null;
}

export interface Shop {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  phone: string;
  addressLine: string;
  city: string;
  latitude: number;
  longitude: number;
  status: ApprovalStatus;
  isOpen: boolean;
  openingTime: string;
  closingTime: string;
  commissionBps: number;
  ratingAvg: number;
  ratingCount: number;
  categoryId: string | null;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  kind: 'SHOP' | 'PRODUCT';
}

export interface Product {
  /** معرّف عرض المنتج في هذا المحل (ShopProduct) */
  id: string;
  /** معرّف المنتج العالمي (Product) */
  productId: string;
  barcode: string | null;
  brand: string | null;
  /** الكمية الخاصة بهذا المحل؛ null = غير متتبَّعة */
  stock: number | null;
  name: string;
  description: string | null;
  imageUrl: string | null;
  price: number;
  unit: string;
  isAvailable: boolean;
  isHidden: boolean;
  categoryId: string | null;
  category: { id: string; name: string; slug: string } | null;
  updatedAt: string;
}

/** بيانات المنتج العالمي (مشتركة بين كل المحلات، بلا سعر) */
export interface GlobalProduct {
  id: string;
  barcode: string | null;
  name: string;
  brand: string | null;
  description: string | null;
  imageUrl: string | null;
  imageSource?: 'OPEN_FOOD_FACTS' | 'UPCITEMDB' | 'SHOP_UPLOAD' | 'ADMIN_UPLOAD' | null;
  unit: string;
  categoryId: string | null;
  category: { id: string; name: string; slug: string } | null;
}

export type LookupSource = 'QOFFA' | 'OPEN_FOOD_FACTS' | 'UPCITEMDB' | 'MANUAL';

/** من أين جاءت النتيجة (قُفّة أولًا، ثم المصادر الخارجية) */
export interface LookupInfo {
  source: Exclude<LookupSource, 'MANUAL'>;
  createdFromExternal: boolean;
  imageFound: boolean;
}

export type BarcodeLookup =
  | {
      status: 'NEW';
      barcode: string;
      lookup?: { source: 'MANUAL'; externalTried: boolean; externalUnavailable: boolean };
    }
  | { status: 'AVAILABLE_TO_ADD'; product: GlobalProduct; lookup?: LookupInfo }
  | { status: 'ALREADY_LISTED'; product: GlobalProduct; listing: Product; lookup?: LookupInfo };

export interface OrderItem {
  id: string;
  nameSnapshot: string;
  unitSnapshot: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
}

export interface Order {
  id: string;
  code: string;
  status: OrderStatus;
  subtotal: number;
  deliveryFee: number;
  total: number;
  customerNote: string | null;
  customerPhone: string;
  deliveryAddressLine: string;
  deliveryCity: string;
  deliveryLatitude: number;
  deliveryLongitude: number;
  distanceMeters: number | null;
  rejectionReason: string | null;
  createdAt: string;
  items: OrderItem[];
  customer: { id: string; fullName: string; phone: string } | null;
  driver: { id: string; vehicleType: string; user: { fullName: string; phone: string } } | null;
  /** حمولة QR الاستلام (للطلبات النشطة فقط) */
  pickupQr?: string | null;
  pickupVerifiedAt?: string | null;
}

export interface ShopStats {
  todayOrders: number;
  todaySales: number;
  pendingOrders: number;
  preparingOrders: number;
  readyOrders: number;
  totalProducts: number;
}

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  orderId: string | null;
  isRead: boolean;
  createdAt: string;
}

export interface Paginated<T> {
  items: T[];
  meta: { page: number; limit: number; total: number; totalPages: number; hasNext: boolean };
}
