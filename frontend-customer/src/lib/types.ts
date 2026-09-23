/** أنواع مشتركة — مطابقة لما يرجعه الـBackend */

export type OrderStatus =
  | 'PENDING'
  | 'SHOP_ACCEPTED'
  | 'PREPARING'
  | 'READY_FOR_PICKUP'
  | 'DRIVER_ASSIGNED'
  | 'PICKED_UP'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'NO_DRIVER'
  | 'FAILED_DELIVERY';

export interface Category {
  id: string;
  name: string;
  slug: string;
  kind: 'SHOP' | 'PRODUCT';
  iconKey: string | null;
  sortOrder: number;
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
  isOpen: boolean;
  isOpenNow: boolean;
  openingTime: string;
  closingTime: string;
  ratingAvg: number;
  ratingCount: number;
  distanceMeters: number | null;
  category: { id: string; name: string; slug: string } | null;
}

export interface Product {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  price: number;
  unit: string;
  isAvailable: boolean;
  category: { id: string; name: string; slug: string } | null;
}

export interface Address {
  id: string;
  label: string;
  addressLine: string;
  city: string;
  latitude: number;
  longitude: number;
  notes: string | null;
}

export interface OrderItem {
  id: string;
  nameSnapshot: string;
  unitSnapshot: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  /** المنتج الحالي في المحل وصورته العالمية (null إن حُذف العرض) — للعرض فقط */
  product?: { product: { imageUrl: string | null } } | null;
}

export interface Order {
  id: string;
  code: string;
  status: OrderStatus;
  subtotal: number;
  deliveryFee: number;
  total: number;
  paymentMethod: string;
  customerNote: string | null;
  deliveryAddressLine: string;
  deliveryCity: string;
  deliveryLatitude: number;
  deliveryLongitude: number;
  distanceMeters: number | null;
  rejectionReason: string | null;
  cancelReason: string | null;
  createdAt: string;
  deliveredAt: string | null;
  items: OrderItem[];
  shop: {
    id: string;
    name: string;
    phone: string;
    imageUrl: string | null;
    addressLine: string;
    latitude: number;
    longitude: number;
  };
  driver: {
    id: string;
    vehicleType: string;
    ratingAvg: number;
    user: { fullName: string; phone: string };
  } | null;
  reviews: { id: string; targetType: 'SHOP' | 'DRIVER'; rating: number }[];
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

export interface User {
  id: string;
  fullName: string;
  phone: string;
  email: string | null;
  role: string;
  status: string;
}

export interface Paginated<T> {
  items: T[];
  meta: { page: number; limit: number; total: number; totalPages: number; hasNext: boolean };
}
