<template>
  <button class="btn secondary" title="通知中心" @click="open">🔔</button>

  <Teleport to="body">
    <Transition name="nc-fade">
      <div v-if="visible" class="nc-overlay" @click.self="close"></div>
    </Transition>

    <Transition name="nc-slide">
      <aside v-if="visible" class="nc-drawer" role="dialog" aria-label="通知中心">
        <div class="nc-header">
          <h3>🔔 通知中心</h3>
          <div class="nc-header-actions">
            <button class="btn icon" title="清空全部" @click="handleClear">🗑️</button>
            <button class="btn icon" title="关闭" @click="close">×</button>
          </div>
        </div>

        <div class="nc-body">
          <section class="nc-section">
            <div class="nc-section-title">
              📢 系统公告
              <span v-if="announcementsLoading" class="nc-loading">拉取中…</span>
            </div>
            <div v-if="!announcements.length" class="nc-empty">暂无公告</div>
            <ul v-else class="nc-list">
              <li v-for="item in announcements" :key="item.id" class="nc-item announcement">
                <span class="nc-item-icon">📢</span>
                <span class="nc-item-message">{{ item.message }}</span>
                <button class="nc-item-delete" title="删除" @click="removeNotification(item.id)">🗑</button>
              </li>
            </ul>
          </section>

          <section class="nc-section">
            <div class="nc-section-title">🔔 操作消息</div>
            <div v-if="!toastHistory.length" class="nc-empty">暂无消息</div>
            <ul v-else class="nc-list">
              <li v-for="item in toastHistory" :key="item.id" class="nc-item" :class="item.type">
                <span class="nc-item-icon">
                  {{ item.type === 'success' ? '✅' : item.type === 'error' ? '❌' : 'ℹ️' }}
                </span>
                <span class="nc-item-main">
                  <span class="nc-item-message">{{ item.message }}</span>
                  <span class="nc-item-time">{{ formatTime(item.time) }}</span>
                </span>
                <button class="nc-item-delete" title="删除" @click="removeNotification(item.id)">🗑</button>
              </li>
            </ul>
          </section>
        </div>
      </aside>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue';
import { useNotificationCenter } from '../composables/useNotificationCenter';

const {
  announcements,
  toastHistory,
  announcementsLoading,
  removeNotification,
  clearNotifications,
  ensureAnnouncements
} = useNotificationCenter();

const visible = ref(false);

const open = () => {
  visible.value = true;
};
const close = () => {
  visible.value = false;
};
const handleClear = () => {
  clearNotifications();
};

watch(visible, val => {
  if (val) ensureAnnouncements();
  if (val) window.addEventListener('keydown', onKeydown);
  else window.removeEventListener('keydown', onKeydown);
});

const onKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape') close();
};

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
});

const formatTime = (time: number) => {
  const d = new Date(time);
  const now = new Date();
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (d.toDateString() === now.toDateString()) return hm;
  return `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
};
</script>

<style scoped>
.nc-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.4);
  z-index: 2100;
}

.nc-drawer {
  position: fixed;
  top: 0;
  left: 0;
  bottom: 0;
  width: 340px;
  max-width: 90vw;
  background: var(--card);
  border-right: 1px solid var(--border);
  box-shadow: var(--shadow-lg);
  z-index: 2101;
  display: flex;
  flex-direction: column;
}

.nc-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
}

.nc-header h3 {
  margin: 0;
  font-size: 16px;
  color: var(--text-strong);
}

.nc-header-actions {
  display: flex;
  gap: 6px;
}

.nc-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px 16px;
}

.nc-section + .nc-section {
  margin-top: 18px;
}

.nc-section-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-soft);
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.nc-loading {
  font-weight: 400;
  color: var(--muted);
}

.nc-empty {
  font-size: 13px;
  color: var(--muted);
  padding: 10px;
  text-align: center;
  background: var(--surface-2);
  border-radius: var(--radius-sm);
}

.nc-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.nc-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 10px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 13px;
  color: var(--text);
}

.nc-item.error .nc-item-message {
  color: var(--danger);
}

.nc-item.success .nc-item-message {
  color: var(--success);
}

.nc-item-icon {
  flex-shrink: 0;
  line-height: 1.5;
}

.nc-item-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nc-item-message {
  flex: 1;
  min-width: 0;
  word-break: break-word;
  line-height: 1.5;
}

.nc-item-time {
  font-size: 11px;
  color: var(--muted);
}

.nc-item-delete {
  flex-shrink: 0;
  border: none;
  background: none;
  cursor: pointer;
  font-size: 13px;
  opacity: 0.45;
  padding: 2px;
  line-height: 1.5;
}

.nc-item-delete:hover {
  opacity: 1;
}

/* 过渡动画 */
.nc-fade-enter-active,
.nc-fade-leave-active {
  transition: opacity 0.2s ease;
}

.nc-fade-enter-from,
.nc-fade-leave-to {
  opacity: 0;
}

.nc-slide-enter-active,
.nc-slide-leave-active {
  transition: transform 0.25s ease;
}

.nc-slide-enter-from,
.nc-slide-leave-to {
  transform: translateX(-100%);
}
</style>
