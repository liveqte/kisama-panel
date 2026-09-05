<!-- src/components/NodeList.vue -->
<script setup lang="ts">
import { ref, computed } from 'vue';
import { useNodes } from '../composables/useNodes';
import NodeCard from './NodeCard.vue';
import NodeTable from './NodeTable.vue';
import DialogModal from './DialogModal.vue';

const { nodes, filteredSortedNodes, viewMode, syncNodeBaseInfo, deleteNode, loading, searchQuery } = useNodes();

const handleRefresh = async (id: string) => {
  await syncNodeBaseInfo(id);
};

// 🗄️ 删除 = 移入回收站：用确认弹窗代替原生 confirm，与彻底删除一致
const showDeleteConfirm = ref(false);
const pendingDeleteId = ref<string | null>(null);
const pendingDeleteName = computed(() =>
  nodes.value.find(n => n.id === pendingDeleteId.value)?.name || ''
);

const handleDelete = (id: string) => {
  pendingDeleteId.value = id;
  showDeleteConfirm.value = true;
};

const handleConfirmDelete = () => {
  if (pendingDeleteId.value) deleteNode(pendingDeleteId.value);
  showDeleteConfirm.value = false;
  pendingDeleteId.value = null;
};
</script>

<template>
  <div class="node-list">
    <DialogModal
      v-model="showDeleteConfirm"
      title="移入回收站"
      confirm-text="移入回收站"
      @confirm="handleConfirmDelete"
    >
      <p>确定要将节点「{{ pendingDeleteName }}」移入回收站吗？</p>
      <p style="font-size: 13px; color: var(--muted);">冻结期间不会触发任何后台任务（同步 / 脚本维护），可随时从回收站恢复。</p>
    </DialogModal>

    <template v-if="filteredSortedNodes.length > 0">
      <TransitionGroup v-if="viewMode === 'card'" name="list" tag="div" class="list-container">
        <NodeCard
          v-for="node in filteredSortedNodes"
          :key="node.id"
          :node="node"
          @refresh="handleRefresh"
          @edit="$emit('edit-node', $event)"
          @delete="handleDelete"
          @terminal="$emit('terminal', $event)"
          @files="$emit('files', $event)"
          @tasks="$emit('tasks', $event)"
          @ai-prompt="$emit('ai-prompt', $event)"
          @argo-tunnel="$emit('argo-tunnel', $event)"
          @full-terminal="$emit('full-terminal', $event)"
          @update-agent="$emit('update-agent', $event)"
        />
      </TransitionGroup>

      <NodeTable
        v-else-if="viewMode === 'table'"
        :nodes="filteredSortedNodes"
        @refresh="handleRefresh"
        @edit="$emit('edit-node', $event)"
        @delete="handleDelete"
        @terminal="$emit('terminal', $event)"
        @files="$emit('files', $event)"
        @tasks="$emit('tasks', $event)"
        @ai-prompt="$emit('ai-prompt', $event)"
        @argo-tunnel="$emit('argo-tunnel', $event)"
        @full-terminal="$emit('full-terminal', $event)"
        @update-agent="$emit('update-agent', $event)"
      />
    </template>

    <div v-else-if="nodes.length === 0 && loading" class="list-container" aria-busy="true">
      <div v-for="i in 6" :key="i" class="skeleton-card">
        <div class="skeleton-header">
          <span class="skeleton-block skeleton-flag"></span>
          <span class="skeleton-block skeleton-name"></span>
          <span class="skeleton-block skeleton-chip"></span>
        </div>
        <div class="skeleton-block skeleton-info"></div>
        <div class="skeleton-footer">
          <span class="skeleton-block skeleton-btn"></span>
          <span class="skeleton-block skeleton-btn"></span>
          <span class="skeleton-block skeleton-btn"></span>
          <span class="skeleton-block skeleton-btn-wide"></span>
        </div>
      </div>
    </div>

    <div v-else-if="nodes.length === 0" class="empty-state">
      <div class="empty-icon">📦</div>
      <h3>暂无节点</h3>
      <p>三步快速上手，一分钟接入您的第一台 Agent</p>
      <div class="empty-steps">
        <div class="empty-step">
          <span class="step-num">1</span>
          <span class="step-text">下载探针程序到您的服务器</span>
          <button class="btn secondary" @click="$emit('download')">⬇️ 探针下载</button>
        </div>
        <div class="empty-step">
          <span class="step-num">2</span>
          <span class="step-text">添加节点并配置密钥</span>
          <button class="btn primary" @click="$emit('add')">➕ 添加节点</button>
        </div>
        <div class="empty-step">
          <span class="step-num">3</span>
          <span class="step-text">一键同步，开始监控</span>
          <button class="btn secondary" @click="$emit('sync')">🔄 全部同步</button>
        </div>
      </div>
    </div>

    <div v-else class="empty-state">
      <div class="empty-icon">🔍</div>
      <h3>未找到匹配节点</h3>
      <p>没有与「{{ searchQuery }}」匹配的节点，换个关键词试试</p>
    </div>
  </div>
</template>

<style scoped>
.node-list {
  width: 100%;
  padding: 4px 0;
}

.list-container {
  display: grid;
  grid-template-columns: 1fr;
  gap: 20px;
}

/* 响应式：平板以上双列 */
@media (min-width: 768px) {
  .list-container {
    grid-template-columns: repeat(2, 1fr);
  }
}

/* 桌面三列 */
@media (min-width: 1200px) {
  .list-container {
    grid-template-columns: repeat(3, 1fr);
  }
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
  background: var(--card);
  border-radius: 28px;
  border: 2px dashed var(--border-strong);
  text-align: center;
}

.empty-icon {
  font-size: 3.5rem;
  margin-bottom: 16px;
  opacity: 0.6;
}

.empty-state h3 {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--text);
  margin-bottom: 8px;
}

.empty-state p {
  color: var(--muted);
  font-size: 0.95rem;
  margin-bottom: 24px;
}

/* 三步引导 */
.empty-steps {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  max-width: 480px;
}

.empty-step {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 12px;
}

.step-num {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--primary);
  color: white;
  font-size: 0.85rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.step-text {
  flex: 1;
  text-align: left;
  font-size: 0.9rem;
  color: var(--text-soft);
}

@media (min-width: 768px) {
  .empty-step {
    flex-direction: row;
  }
}

/* 骨架屏 */
.skeleton-card {
  background: var(--card);
  border-radius: 14px;
  padding: 14px 16px;
  border: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.skeleton-block {
  background: var(--surface-3);
  border-radius: 6px;
  animation: skeleton-pulse 1.4s ease-in-out infinite;
}

.skeleton-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.skeleton-flag { width: 24px; height: 24px; border-radius: 50%; flex-shrink: 0; }
.skeleton-name { width: 40%; height: 18px; }
.skeleton-chip { width: 70px; height: 20px; margin-left: auto; border-radius: 6px; }
.skeleton-info { width: 100%; height: 56px; }
.skeleton-footer { display: flex; gap: 4px; }
.skeleton-btn { width: 32px; height: 32px; }
.skeleton-btn-wide { width: 64px; height: 32px; }

@keyframes skeleton-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.45; }
}

@media (prefers-reduced-motion: reduce) {
  .skeleton-block { animation: none; }
}

/* 列表动画 */
.list-enter-active,
.list-leave-active {
  transition: all 0.3s ease;
}
.list-enter-from,
.list-leave-to {
  opacity: 0;
  transform: translateY(20px);
}
</style>