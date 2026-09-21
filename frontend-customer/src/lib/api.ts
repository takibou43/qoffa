import type {
  Address,
  Category,
  Notification,
  Order,
  Paginated,
  Product,
  Shop,
  User,
} from './types';

const BASE = import.meta.env.VITE_API_URL || '/api';
const TOKEN_KEY = 'qoffa.token';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (token: string) => localStorage.setItem(TOKEN_KEY, token);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: { field: string; message: string }[],
  ) {
    super(message);
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  auth?: boolean;
  query?: Record<string, string | number | boolean | undefined>;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = false, query } = options;

  let url = `${BASE}${path}`;
  if (query) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') params.set(key, String(value));
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }

  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'تعذّر الاتصال بالخادم. تحقّق من اتصالك بالإنترنت.');
  }

  if (response.status === 204) return undefined as T;

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const error = data?.error;
    // انتهاء الجلسة: ننظّف الرمز حتى لا تبقى الواجهة في حالة "مسجّل دخول"
    if (response.status === 401) clearToken();
    throw new ApiError(
      response.status,
      error?.code ?? 'UNKNOWN',
      error?.message ?? 'حدث خطأ غير متوقع',
      error?.details,
    );
  }

  return data as T;
}

export const api = {
  /* ── المصادقة ── */
  login: (phone: string, password: string) =>
    request<{ user: User; token: string }>('/auth/login', {
      method: 'POST',
      body: { phone, password },
    }),

  registerCustomer: (input: {
    fullName: string;
    phone: string;
    password: string;
    email?: string;
  }) =>
    request<{ user: User; token: string }>('/auth/register/customer', {
      method: 'POST',
      body: input,
    }),

  me: () => request<{ user: User }>('/auth/me', { auth: true }),

  /* ── التصنيفات والمحلات ── */
  categories: (kind?: 'SHOP' | 'PRODUCT') =>
    request<{ items: Category[] }>('/categories', { query: { kind } }),

  shops: (params: {
    lat?: number;
    lon?: number;
    q?: string;
    categoryId?: string;
    openOnly?: boolean;
    page?: number;
    limit?: number;
  }) => request<Paginated<Shop>>('/shops', { query: params }),

  shop: (shopId: string, lat?: number, lon?: number) =>
    request<{ shop: Shop }>(`/shops/${shopId}`, { query: { lat, lon } }),

  shopProducts: (shopId: string, params: { q?: string; categoryId?: string; page?: number; limit?: number }) =>
    request<Paginated<Product>>(`/shops/${shopId}/products`, { query: params }),

  /* ── العناوين ── */
  addresses: () =>
    request<{ items: Address[]; defaultAddressId: string | null }>('/addresses', { auth: true }),

  createAddress: (input: {
    label?: string;
    addressLine: string;
    city: string;
    latitude: number;
    longitude: number;
    notes?: string | null;
    setDefault?: boolean;
  }) => request<{ address: Address }>('/addresses', { method: 'POST', body: input, auth: true }),

  deleteAddress: (id: string) =>
    request<{ ok: true }>(`/addresses/${id}`, { method: 'DELETE', auth: true }),

  /* ── الطلبات ── */
  createOrder: (input: {
    shopId: string;
    items: { productId: string; quantity: number }[];
    addressId?: string;
    address?: { addressLine: string; city: string; latitude: number; longitude: number };
    customerNote?: string | null;
  }) => request<{ order: Order }>('/orders', { method: 'POST', body: input, auth: true }),

  /** سعر التوصيل التقديري — يحسبه الخادم بمعاملات الإدارة */
  quoteDelivery: (shopId: string, lat: number, lon: number) =>
    request<{ quote: { distanceKm: number; fee: number; withinRange: boolean; maxKm: number } }>(
      '/orders/quote',
      { auth: true, query: { shopId, lat, lon } },
    ),

  myOrders: (params: { page?: number; limit?: number } = {}) =>
    request<Paginated<Order>>('/orders/me', { auth: true, query: params }),

  order: (id: string) => request<{ order: Order }>(`/orders/${id}`, { auth: true }),

  cancelOrder: (id: string, reason?: string) =>
    request<{ ok: true }>(`/orders/${id}/cancel`, {
      method: 'POST',
      body: { reason },
      auth: true,
    }),

  /* ── التقييم ── */
  reviewOrder: (
    orderId: string,
    input: {
      shop?: { rating: number; comment?: string | null };
      driver?: { rating: number; comment?: string | null };
    },
  ) => request<{ reviews: unknown[] }>(`/reviews/orders/${orderId}`, {
    method: 'POST',
    body: input,
    auth: true,
  }),

  /* ── الإشعارات ── */
  notifications: (params: { page?: number; limit?: number; unreadOnly?: boolean } = {}) =>
    request<Paginated<Notification> & { unreadCount: number }>('/notifications', {
      auth: true,
      query: params,
    }),

  markNotificationRead: (id: string) =>
    request<{ ok: true }>(`/notifications/${id}/read`, { method: 'POST', auth: true }),

  markAllNotificationsRead: () =>
    request<{ ok: true; updated: number }>('/notifications/read-all', {
      method: 'POST',
      auth: true,
    }),
};
