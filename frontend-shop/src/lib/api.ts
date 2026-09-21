import { request } from './apiCore';
import type {
  BarcodeLookup,
  Category,
  Notification,
  Order,
  OrderStatus,
  Paginated,
  Product,
  Shop,
  ShopStats,
  User,
} from './types';

export { ApiError, clearToken, getToken, setToken } from './apiCore';

export const api = {
  login: (phone: string, password: string) =>
    request<{ user: User; token: string }>('/auth/login', {
      method: 'POST',
      body: { phone, password },
      auth: false,
    }),

  registerShop: (input: {
    fullName: string;
    phone: string;
    password: string;
    shop: {
      name: string;
      phone: string;
      addressLine: string;
      city: string;
      latitude: number;
      longitude: number;
    };
  }) =>
    request<{ user: User; token: string }>('/auth/register/shop', {
      method: 'POST',
      body: input,
      auth: false,
    }),

  me: () => request<{ user: User }>('/auth/me'),

  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: true }>('/auth/change-password', {
      method: 'POST',
      body: { currentPassword, newPassword },
    }),

  /* ── المحل ── */
  myShop: () => request<{ shop: Shop }>('/shops/me'),

  updateShop: (data: Partial<Shop>) =>
    request<{ shop: Shop }>('/shops/me', { method: 'PATCH', body: data }),

  setOpen: (isOpen: boolean) =>
    request<{ id: string; isOpen: boolean }>('/shops/me/open', {
      method: 'PATCH',
      body: { isOpen },
    }),

  stats: () => request<{ stats: ShopStats }>('/shops/me/stats'),

  categories: (kind?: 'SHOP' | 'PRODUCT') =>
    request<{ items: Category[] }>('/categories', { query: { kind }, auth: false }),

  /* ── المنتجات ── */
  products: (params: {
    q?: string;
    categoryId?: string;
    availability?: 'all' | 'available' | 'unavailable' | 'hidden';
    page?: number;
    limit?: number;
  }) => request<Paginated<Product>>('/products', { query: params }),

  /** مسح باركود: NEW / AVAILABLE_TO_ADD / ALREADY_LISTED */
  lookupBarcode: (code: string) =>
    request<BarcodeLookup>(`/products/barcode/${encodeURIComponent(code)}`),

  createProduct: (data: Record<string, unknown>) =>
    request<{ product: Product; createdGlobalProduct: boolean }>('/products', {
      method: 'POST',
      body: data,
    }),

  updateProduct: (id: string, data: Record<string, unknown>) =>
    request<{ product: Product }>(`/products/${id}`, { method: 'PATCH', body: data }),

  deleteProduct: (id: string) =>
    request<{ ok: true }>(`/products/${id}`, { method: 'DELETE' }),

  /* ── الطلبات ── */
  orders: (params: {
    bucket?: 'new' | 'active' | 'ready' | 'completed' | 'cancelled';
    status?: OrderStatus;
    page?: number;
    limit?: number;
  }) => request<Paginated<Order>>('/orders/shop', { query: params }),

  order: (id: string) => request<{ order: Order }>(`/orders/${id}`),

  /** خطوات المحل — كلها تمر من آلة حالات الخادم */
  accept: (id: string) => request<{ ok: true }>(`/orders/${id}/accept`, { method: 'POST' }),
  prepare: (id: string) => request<{ ok: true }>(`/orders/${id}/prepare`, { method: 'POST' }),
  ready: (id: string) => request<{ ok: true }>(`/orders/${id}/ready`, { method: 'POST' }),
  reject: (id: string, reason: string) =>
    request<{ ok: true }>(`/orders/${id}/reject`, { method: 'POST', body: { reason } }),
  retryDispatch: (id: string) =>
    request<{ ok: true }>(`/orders/${id}/retry-dispatch`, { method: 'POST' }),

  /* ── الإشعارات ── */
  notifications: (params: { page?: number; limit?: number; unreadOnly?: boolean } = {}) =>
    request<Paginated<Notification> & { unreadCount: number }>('/notifications', {
      query: params,
    }),
  markNotificationRead: (id: string) =>
    request<{ ok: true }>(`/notifications/${id}/read`, { method: 'POST' }),
  markAllNotificationsRead: () =>
    request<{ ok: true }>('/notifications/read-all', { method: 'POST' }),
};
