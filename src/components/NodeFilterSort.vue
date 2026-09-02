<script setup lang="ts">
import { useNodes } from '../composables/useNodes';
import { showPreview, isPersistent, savePreviewSettings } from '../composables/usePreview';

const { filterStatus, sortKey, sortOrder, viewMode, keepIpInfo, searchQuery, loading } = useNodes();

defineEmits<{ (e: 'sync'): void }>();

const toggleOrder = () => {
  sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc';
};

const handlePreviewChange = () => {
  savePreviewSettings();
};
</script>

<template>
  <div class="filter-sort-bar">
    <div class="tool-group search-group">
      <span class="label">搜索:</span>
      <input
        v-model="searchQuery"
        type="text"
        class="search-input"
        placeholder="名称 / 域名 / IP..."
      />
    </div>

    <div class="tool-group">
      <span class="label">筛选:</span>
      <div class="segmented-control">
        <button :class="{ active: filterStatus === 'all' }" @click="filterStatus = 'all'">全部</button>
        <button :class="{ active: filterStatus === 'online' }" @click="filterStatus = 'online'">在线</button>
        <button :class="{ active: filterStatus === 'offline' }" @click="filterStatus = 'offline'">离线</button>
      </div>
    </div>

    <div class="tool-group">
      <span class="label">视图:</span>
      <div class="segmented-control">
        <button :class="{ active: viewMode === 'card' }" @click="viewMode = 'card'">🎴 卡片</button>
        <button :class="{ active: viewMode === 'table' }" @click="viewMode = 'table'">📋 表格</button>
      </div>
    </div>

    <div class="tool-group">
      <span class="label">排序:</span>
      <select v-model="sortKey" class="select-input">
        <option value="name">节点名称</option>
        <option value="ip">IP 地址</option>
        <option value="createdAt">建立时间</option>
      </select>
      <button class="order-btn" @click="toggleOrder" :title="sortOrder === 'asc' ? '正序' : '倒序'">
        {{ sortOrder === 'asc' ? '🔼' : '🔽' }}
      </button>
    </div>

    <div class="tool-group order-ip-type">
      <label class="checkbox-label" title="勾选：刷新页面后保留各节点的 IP 归属类型；不勾选：刷新后清空并重新从接口探测">
        <input type="checkbox" v-model="keepIpInfo" />
        保留IP信息
      </label>
    </div>

    <div class="tool-group">
      <button
        class="sync-btn"
        @click="$emit('sync')"
        :disabled="loading"
        title="全部同步：刷新所有节点的状态信息"
      >
        🔃
      </button>
    </div>

    <div class="tool-group settings">
      <label class="checkbox-label">
        <input type="checkbox" v-model="showPreview" @change="handlePreviewChange" />
        显示预览
      </label>
      <label class="checkbox-label" :class="{ disabled: !showPreview }">
        <input type="checkbox" v-model="isPersistent" :disabled="!showPreview" @change="handlePreviewChange" />
        预览常驻
      </label>
    </div>
  </div>
</template>

<style scoped>
.filter-sort-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--card);
  padding: 12px 20px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  margin-bottom: 20px;
  gap: 20px;
  flex-wrap: wrap;
}

.tool-group {
  display: flex;
  align-items: center;
  gap: 10px;
}

.label {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--muted);
  white-space: nowrap;
  flex-shrink: 0;
}

/* 分段选择器样式 */
.segmented-control {
  display: flex;
  background: var(--surface-3);
  padding: 3px;
  border-radius: 8px;
}

.segmented-control button {
  border: none;
  background: transparent;
  padding: 4px 12px;
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--muted);
  cursor: pointer;
  border-radius: 6px;
  transition: all 0.2s;
}

.segmented-control button.active {
  background: var(--btn-bg);
  color: var(--primary);
  box-shadow: var(--shadow-sm);
}

/* 搜索输入框 */
.search-group {
  flex: none;
  min-width: 0;
}

.search-input {
  flex: none;
  width: 150px;
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--btn-bg);
  color: var(--text);
  font-size: 0.85rem;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.search-input::placeholder {
  color: var(--muted);
}

.search-input:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.12);
}

/* 排序选择样式 */
.select-input {
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--btn-bg);
  color: var(--text);
  font-size: 0.85rem;
  outline: none;
}

.order-btn {
  background: var(--btn-bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  width: 32px;
  height: 32px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* 全部同步小图标按钮：与排序方向按钮同尺寸，贴合筛选栏紧凑空间 */
.sync-btn {
  background: var(--btn-bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  width: 32px;
  height: 32px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.95rem;
  line-height: 1;
  transition: all 0.15s;
}
.sync-btn:hover:not(:disabled) {
  background: var(--hover-bg);
  border-color: var(--border-strong);
}
.sync-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 复选框样式 */
.checkbox-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.85rem;
  cursor: pointer;
  color: var(--text);
  user-select: none;
}
.checkbox-label.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.settings {
  margin-left: auto;
  border-left: 1px solid var(--border);
  padding-left: 20px;
}

@media (max-width: 768px) {
  .settings {
    margin-left: 0;
    border-left: none;
    padding-left: 0;
    width: 100%;
    justify-content: flex-end;
  }
}
</style>