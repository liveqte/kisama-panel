// src/lib/webdav-status.ts
import { ref } from 'vue';

/**
 * WebDAV 云端链路健康状态（全局单例响应式）
 *
 * 由 configsync 引擎在每轮同步结束时上报；首页「已登录」按钮据此展示现状：
 *   unknown —— 尚未探测（刚刷新页面 / 刚退出登录）
 *   ok      —— 最近一轮同步成功，云端可达
 *   error   —— 最近一轮同步失败（网络失联或配置异常），按钮转黄警示
 *
 * 注意：该状态只描述"链路"，不代表登录态本身；
 * 登录与否仍以 localStorage 中是否存在 kisama_webdav_config 为准。
 */
export type WebDavLinkStatus = 'unknown' | 'ok' | 'error';

export const webdavLinkStatus = ref<WebDavLinkStatus>('unknown');
export const webdavLinkMessage = ref('');

export function reportWebDavLink(status: WebDavLinkStatus, message = ''): void {
  webdavLinkStatus.value = status;
  webdavLinkMessage.value = message;
}
