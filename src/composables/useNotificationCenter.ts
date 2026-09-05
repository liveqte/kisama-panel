// src/composables/useNotificationCenter.ts
import { ref } from 'vue';

export type NotificationKind = 'toast' | 'announcement';
export type NotificationType = 'success' | 'error' | 'info';

export interface NotificationItem {
  id: number;
  kind: NotificationKind;
  type: NotificationType;
  message: string;
  time: number;
}

// 系统公告来源：一行一条公告的纯文本文件
export const ANNOUNCEMENTS_URL = 'https://gbjs.sld.tw/kisama/notification.php';

// toast 历史上限，超出丢弃最旧的
const MAX_TOAST_HISTORY = 100;

const announcements = ref<NotificationItem[]>([]);
const toastHistory = ref<NotificationItem[]>([]);

const announcementsLoading = ref(false);
const announcementsError = ref('');
let announcementsFetched = false;

let nextId = 1;

export function useNotificationCenter() {
  const addNotification = (item: { kind: NotificationKind; type?: NotificationType; message: string }) => {
    const entry: NotificationItem = {
      id: nextId++,
      kind: item.kind,
      type: item.type || 'info',
      message: item.message,
      time: Date.now()
    };
    if (entry.kind === 'announcement') {
      announcements.value = [entry, ...announcements.value];
    } else {
      toastHistory.value = [entry, ...toastHistory.value].slice(0, MAX_TOAST_HISTORY);
    }
  };

  const removeNotification = (id: number) => {
    announcements.value = announcements.value.filter(n => n.id !== id);
    toastHistory.value = toastHistory.value.filter(n => n.id !== id);
  };

  const clearNotifications = () => {
    announcements.value = [];
    toastHistory.value = [];
  };

  // 拉取系统公告：一行非空文本即一条公告，每次整体替换公告列表
  const fetchAnnouncements = async () => {
    if (announcementsLoading.value) return;
    announcementsLoading.value = true;
    announcementsError.value = '';
    try {
      const res = await fetch(`${ANNOUNCEMENTS_URL}${ANNOUNCEMENTS_URL.includes('?') ? '&' : '?'}_t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      announcements.value = lines.map(line => ({
        id: nextId++,
        kind: 'announcement' as const,
        type: 'info' as const,
        message: line,
        time: Date.now()
      }));
      announcementsFetched = true;
    } catch (err: any) {
      // 拉取失败视为无公告：清空列表，界面显示「暂无公告」；
      // announcementsError 仅内部用于标记「需要重试」，不在界面展示
      announcements.value = [];
      announcementsError.value = err?.message || '拉取失败';
    } finally {
      announcementsLoading.value = false;
    }
  };

  // 抽屉打开时调用：首次拉取，之后若曾失败则重试
  const ensureAnnouncements = () => {
    if (!announcementsFetched || announcementsError.value) {
      fetchAnnouncements();
    }
  };

  return {
    announcements,
    toastHistory,
    announcementsLoading,
    announcementsError,
    addNotification,
    removeNotification,
    clearNotifications,
    fetchAnnouncements,
    ensureAnnouncements
  };
}
