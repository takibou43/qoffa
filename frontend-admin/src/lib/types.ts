export type OrderStatus =
  | 'PENDING' | 'SHOP_ACCEPTED' | 'PREPARING' | 'READY_FOR_PICKUP'
  | 'DRIVER_ASSIGNED' | 'PICKED_UP' | 'OUT_FOR_DELIVERY' | 'DELIVERED'
  | 'REJECTED' | 'CANCELLED' | 'NO_DRIVER' | 'FAILED_DELIVERY';

export type Role = 'CUSTOMER' | 'SHOP_OWNER' | 'DRIVER' | 'ADMIN' | 'SUPER_ADMIN';
export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';

export interface User {
  id: string;
  fullName: string;
  phone: string;
  email: string | null;
  role: Role;
  status: 'ACTIVE' | 'SUSPENDED';
  createdAt: string;
  lastLoginAt: string | null;
}

export interface AdminShop {
  id: string;
  name: string;
  phone: string;
  city: string;
  addressLine: string;
  status: ApprovalStatus;
  isOpen: boolean;
  deliveryFee: number;
  commissionBps: number;
  ratingAvg: number;
  ratingCount: number;
  createdAt: string;
  owner: { id: string; fullName: string; phone: string; status: string };
  _count: { products: number; orders: number };
}

export interface AdminDriver {
  id: string;
  status: ApprovalStatus;
  isAvailable: boolean;
  vehicleType: string;
  plateNumber: string | null;
  ratingAvg: number;
  ratingCount: number;
  currentOrderId: string | null;
  createdAt: string;
  user: { id: string; fullName: string; phone: string; status: string };
  _count: { orders: number };
}

export interface AdminOrder {
  id: string;
  code: string;
  status: OrderStatus;
  subtotal: number;
  deliveryFee: number;
  total: number;
  commissionAmount: number;
  driverEarning: number;
  createdAt: string;
  deliveredAt: string | null;
  customer: { id: string; fullName: string; phone: string } | null;
  shop: { id: string; name: string } | null;
  driver: { id: string; user: { fullName: string; phone: string } } | null;
}

export interface Stats {
  customers: number;
  shops: number;
  drivers: number;
  pendingShops: number;
  pendingDrivers: number;
  todayOrders: number;
  deliveredOrders: number;
  cancelledOrders: number;
  grossRevenue: number;
  platformCommission: number;
  todayRevenue: number;
}

export interface AuditLog {
  id: string;
  action: string;
  targetType: string;
  targetId: string | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: string;
  actor: { id: string; fullName: string; role: Role };
}

export interface Wallet {
  id: string;
  ownerType: 'SHOP' | 'DRIVER' | 'PLATFORM';
  balance: number;
  updatedAt: string;
  shop: { id: string; name: string } | null;
  driver: { id: string; user: { fullName: string; phone: string } } | null;
}

export interface Paginated<T> {
  items: T[];
  meta: { page: number; limit: number; total: number; totalPages: number; hasNext: boolean };
}
