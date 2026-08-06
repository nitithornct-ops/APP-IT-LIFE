import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../services/apiClient';
import type { NotificationItem } from '../types/notifications';

interface PaginatedNotifications {
  items: NotificationItem[];
  pagination: { page: number; pageSize: number; totalItems: number; totalPages: number };
}

/** โพลทุก 30 วินาที — เพียงพอสำหรับการแจ้งเตือนภายในระบบที่ไม่เร่งด่วนระดับ Real-time */
const POLL_INTERVAL_MS = 30_000;

export function useUnreadNotificationCount() {
  return useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => apiFetch<{ count: number }>('/api/v1/notifications/unread-count'),
    refetchInterval: POLL_INTERVAL_MS,
  });
}

export function useNotificationsList(enabled: boolean) {
  return useQuery({
    queryKey: ['notifications', 'list'],
    queryFn: () => apiFetch<PaginatedNotifications>('/api/v1/notifications?pageSize=10'),
    enabled,
  });
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch(`/api/v1/notifications/${id}/read`, { method: 'PATCH' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch('/api/v1/notifications/read-all', { method: 'PATCH' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}
