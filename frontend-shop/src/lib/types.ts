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
  deliveryFee: number;
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
  id: string;
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
