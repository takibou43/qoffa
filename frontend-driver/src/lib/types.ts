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
  driverProfile?: DriverProfile | null;
}

export interface DriverProfile {
  id: string;
  status: ApprovalStatus;
  isAvailable: boolean;
  vehicleType: string;
  plateNumber: string | null;
  latitude: number | null;
  longitude: number | null;
  lastLocationAt: string | null;
  currentOrderId: string | null;
  ratingAvg: number;
  ratingCount: number;
}

export interface Offer {
  id: string;
  expiresAt: string;
  distanceMeters: number | null;
  createdAt: string;
  order: {
    id: string;
    code: string;
    total: number;
    deliveryFee: number;
    deliveryAddressLine: string;
    deliveryCity: string;
    distanceMeters: number | null;
    shop: { id: string; name: string; addressLine: string; latitude: number; longitude: number };
  };
}

export interface CurrentOrder {
  id: string;
  code: string;
  status: OrderStatus;
  total: number;
  subtotal: number;
  deliveryFee: number;
  paymentMethod: string;
  customerNote: string | null;
  customerPhone: string;
  deliveryAddressLine: string;
  deliveryCity: string;
  deliveryLatitude: number;
  deliveryLongitude: number;
  distanceMeters: number | null;
  assignedAt: string | null;
  pickedUpAt: string | null;
  outForDeliveryAt: string | null;
  /** حمولة QR الاستلام (رمز التسليم عند الزبون وحده) */
  pickupQr: string;
  pickupVerifiedAt: string | null;
  deliveryVerifiedAt: string | null;
  items: { nameSnapshot: string; quantity: number; unitSnapshot: string }[];
  customer: { fullName: string; phone: string } | null;
  shop: {
    id: string;
    name: string;
    phone: string;
    addressLine: string;
    city: string;
    latitude: number;
    longitude: number;
  };
}

export interface DriverStats {
  todayEarnings: number;
  weekEarnings: number;
  todayDeliveries: number;
  weekDeliveries: number;
  walletBalance: number;
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

export interface QrVerification {
  verified: true;
  stage: 'PICKUP' | 'DELIVERY';
  alreadyVerified: boolean;
  verifiedAt: string;
  order: {
    id: string;
    code: string;
    status: OrderStatus;
    total: number;
    paymentMethod: string;
    itemsCount: number;
    items: { nameSnapshot: string; quantity: number; unitSnapshot: string }[];
  };
}
