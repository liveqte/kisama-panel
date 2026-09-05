<!-- src/components/RecycleBin.vue -->
<template>
  <!-- 悬挂在屏幕右缘的展开按钮：回收站为空时隐藏入口 -->
  <button v-if="recycledNodes.length" class="rb-fab" title="回收站（冻结的节点）" @click="open">
    <span class="rb-fab-icon">🗄️</span>
    <span class="rb-fab-badge">{{ recycledNodes.length }}</span>
  </button>

  <Teleport to="body">
    <Transition name="rb-fade">
      <div v-if="visible" class="rb-overlay" @click.self="close"></div>
    </Transition>

    <Transition name="rb-slide">
      <aside v-if="visible" class="rb-drawer" role="dialog" aria-label="节点回收站">
        <div class="rb-header">
          <h3>🗄️ 节点回收站</h3>
          <div class="rb-header-actions">
            <button
              v-if="recycledNodes.length"
              class="btn icon"
              title="清空回收站"
              @click="showEmptyConfirm = true"
            >🗑️</button>
            <button class="btn icon" title="关闭" @click="close">×</button>
          </div>
        </div>

        <div class="rb-body">
          <p class="rb-hint">
            冻结的节点不会触发任何后台任务（同步 / 脚本维护），随时可以恢复。
          </p>

          <div v-if="!recycledNodes.length" class="rb-empty">回收站是空的</div>

          <ul v-else class="rb-list">
            <li v-for="node in recycledNodes" :key="node.id" class="rb-item">
              <span class="rb-item-icon">🧊</span>
              <span class="rb-item-main">
                <span class="rb-item-name">{{ node.name }}</span>
                <span class="rb-item-domain">{{ node.domain }}</span>
                <span class="rb-item-time">{{ formatTime(node.deletedAt) }} 冻结</span>
              </span>
              <span class="rb-item-actions">
                <button class="btn secondary rb-restore" title="恢复到节点列表" @click="handleRestore(node)">♻️ 恢复</button>
                <button class="rb-item-delete" title="彻底删除" @click="confirmPurge(node)">🗑</button>
              </span>
            </li>
          </ul>
        </div>
      </aside>
    </Transition>

    <DialogModal
      v-model="showPurgeConfirm"
      title="彻底删除节点"
      confirm-text="彻底删除"
      @confirm="handlePurge"
    >
      <p>确定要彻底删除节点「{{ purgeTarget?.name }}」吗？此操作不可恢复。</p>
    </DialogModal>

    <DialogModal
      v-model="showEmptyConfirm"
      title="清空回收站"
      confirm-text="清空"
      @confirm="handleEmpty"
    >
      <p>确定要清空回收站吗？其中 {{ recycledNodes.length }} 个节点将被彻底删除，此操作不可恢复。</p>
    </DialogModal>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue';
import { useRecycleBin, type RecycledNode } from '../composables/useRecycleBin';
import { useNodes } from '../composables/useNodes';
import { useToast } from '../composables/useToast';
import DialogModal from './DialogModal.vue';

const { recycledNodes, takeFromRecycleBin, purgeFromRecycleBin, emptyRecycleBin } = useRecycleBin();
const { restoreNode } = useNodes();
const { showToast } = useToast();

const visible = ref(false);
const showPurgeConfirm = ref(false);
const showEmptyConfirm = ref(false);
const purgeTarget = ref<RecycledNode | null>(null);

const open = () => { visible.value = true; };
const close = () => { visible.value = false; };

const handleRestore = (node: RecycledNode) => {
  const taken = takeFromRecycleBin(node.id);
  if (!taken) return;
  if (restoreNode(taken)) {
    showToast(`节点「${taken.name}」已恢复`, 'success');
  } else {
    showToast(`节点「${taken.name}」已存在于列表中，已仅移除冻结副本`, 'info');
  }
};

const confirmPurge = (node: RecycledNode) => {
  purgeTarget.value = node;
  showPurgeConfirm.value = true;
};

const handlePurge = () => {
  // DialogModal 的确认按钮不会自动关闭弹窗，必须显式收起
  showPurgeConfirm.value = false;
  if (!purgeTarget.value) return;
  purgeFromRecycleBin(purgeTarget.value.id);
  showToast(`节点「${purgeTarget.value.name}」已彻底删除`, 'success');
  purgeTarget.value = null;
};

const handleEmpty = () => {
  showEmptyConfirm.value = false;
  emptyRecycleBin();
  showToast('回收站已清空', 'success');
};

watch(visible, val => {
  if (val) window.addEventListener('keydown', onKeydown);
  else {
    window.removeEventListener('keydown', onKeydown);
    // 抽屉收起时顺带收起可能残留的确认弹窗
    showPurgeConfirm.value = false;
    showEmptyConfirm.value = false;
  }
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
  if (d.toDateString() === now.toDateString()) return `今天 ${hm}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
};
</script>

<style scoped>
.rb-fab {
  position: fixed;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  z-index: 1500;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 12px 8px 12px 6px;
  border: 1px solid var(--border);
  border-right: none;
  border-radius: 10px 0 0 10px;
  background: var(--card);
  color: var(--text);
  cursor: pointer;
  box-shadow: var(--shadow-lg);
  line-height: 1;
}

.rb-fab:hover {
  background: var(--surface-2);
}

.rb-fab-icon {
  font-size: 18px;
}

.rb-fab-badge {
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  border-radius: 9px;
  background: var(--danger);
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
}

.rb-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.4);
  z-index: 2100;
}

.rb-drawer {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: 360px;
  max-width: 90vw;
  background: var(--card);
  border-left: 1px solid var(--border);
  box-shadow: var(--shadow-lg);
  z-index: 2101;
  display: flex;
  flex-direction: column;
}

.rb-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
}

.rb-header h3 {
  margin: 0;
  font-size: 16px;
  color: var(--text-strong);
}

.rb-header-actions {
  display: flex;
  gap: 6px;
}

.rb-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px 16px;
}

.rb-hint {
  margin: 0 0 12px;
  font-size: 12px;
  color: var(--muted);
  line-height: 1.5;
}

.rb-empty {
  font-size: 13px;
  color: var(--muted);
  padding: 10px;
  text-align: center;
  background: var(--surface-2);
  border-radius: var(--radius-sm);
}

.rb-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.rb-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 13px;
  color: var(--text);
}

.rb-item-icon {
  flex-shrink: 0;
  line-height: 1.5;
}

.rb-item-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.rb-item-name {
  font-weight: 600;
  color: var(--text-strong);
  word-break: break-word;
}

.rb-item-domain {
  word-break: break-all;
  color: var(--muted);
}

.rb-item-time {
  font-size: 11px;
  color: var(--muted);
}

.rb-item-actions {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 4px;
}

.rb-restore {
  font-size: 12px;
  padding: 4px 8px;
}

.rb-item-delete {
  flex-shrink: 0;
  border: none;
  background: none;
  cursor: pointer;
  font-size: 13px;
  opacity: 0.45;
  padding: 2px;
  line-height: 1.5;
}

.rb-item-delete:hover {
  opacity: 1;
}

/* 过渡动画 */
.rb-fade-enter-active,
.rb-fade-leave-active {
  transition: opacity 0.2s ease;
}

.rb-fade-enter-from,
.rb-fade-leave-to {
  opacity: 0;
}

.rb-slide-enter-active,
.rb-slide-leave-active {
  transition: transform 0.25s ease;
}

.rb-slide-enter-from,
.rb-slide-leave-to {
  transform: translateX(100%);
}
</style>
