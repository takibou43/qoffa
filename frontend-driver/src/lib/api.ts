import { request } from './apiCore';
import type {
  CurrentOrder,
  DriverProfile,
  DriverStats,
  Notification,
  Offer,
  Paginated,
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

  registerDriver: (input: {
    fullName: string;
    phone: string;
    password: string;
    driver: { vehicleType: string; plateNumber?: string };
  }) =>
    request<{ user: User; token: string }>('/auth/register/driver', {
      method: 'POST',
      body: input,
      auth: false,
    }),

  me: () => request<{ user: User }>('/auth/me'),

  profile: () => request<{ driver: DriverProfile }>('/drivers/me'),

  setAvailability: (isAvailable: boolean, coords?: { latitude: number; longitude: number }) =>
    request<{ driver: DriverProfile }>('/drivers/me/availability', {
      method: 'PATCH',
      body: { isAvailable, ...coords },
    }),

  updateLocation: (latitude: number, longitude: number) =>
    request<{ location: unknown }>('/drivers/me/location', {
      method: 'PATCH',
      body: { latitude, longitude },
    }),

  offers: () => request<{ items: Offer[] }>('/drivers/me/offers'),

  current: () => request<{ order: CurrentOrder | null }>('/drivers/me/current'),

  stats: () => request<{ stats: DriverStats }>('/drivers/me/stats'),

  /** القبول محمي في الخادم بقفلين — لا يفوز إلا موصّل واحد */
  acceptOffer: (orderId: string) =>
    request<{ ok: true }>(`/drivers/offers/${orderId}/accept`, { method: 'POST' }),

  declineOffer: (orderId: string) =>
    request<{ ok: true }>(`/drivers/offers/${orderId}/decline`, { method: 'POST' }),

  /* خطوات التوصيل — كلها تمر من آلة حالات الخادم */
  pickup: (orderId: string) => request<{ ok: true }>(`/orders/${orderId}/pickup`, { method: 'POST' }),
  outForDelivery: (orderId: string) =>
    request<{ ok: true }>(`/orders/${orderId}/out-for-delivery`, { method: 'POST' }),
  deliver: (orderId: string) => request<{ ok: true }>(`/orders/${orderId}/deliver`, { method: 'POST' }),
  failDelivery: (orderId: string, reason: string) =>
    request<{ ok: true }>(`/orders/${orderId}/fail-delivery`, { method: 'POST', body: { reason } }),
  release: (orderId: string) =>
    request<{ ok: true }>(`/orders/${orderId}/release`, { method: 'POST' }),

  notifications: (params: { page?: number; limit?: number; unreadOnly?: boolean } = {}) =>
    request<Paginated<Notification> & { unreadCount: number }>('/notifications', { query: params }),
  markNotificationRead: (id: string) =>
    request<{ ok: true }>(`/notifications/${id}/read`, { method: 'POST' }),
  markAllNotificationsRead: () =>
    request<{ ok: true }>('/notifications/read-all', { method: 'POST' }),
};
