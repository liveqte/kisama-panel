<script setup lang="ts">
import type { AgentNode } from '../types';
import { showPreview } from '../composables/usePreview';

defineProps<{
  node: AgentNode | null;
}>();

const formatBytes = (bytes?: number): string => {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};
/**
 * 🎯 新增：时间戳高显性本地化转换函数
 */
const formatDate = (timestamp?: number): string => {
  if (!timestamp) return '-';
  // 转换为 2026/07/04 14:20 这样的标准全格式时间（24小时制）
  return new Date(timestamp).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
};
</script>

<template>
  <Transition name="preview-slide">
    <div v-if="showPreview && node && node.baseinfo" class="node-preview">
      <div class="preview-header">
        <h4>{{ node.name }}</h4>
        <span class="version-badge">v{{ node.baseinfo.version }}</span>
      </div>
      
      <div class="preview-body">
        <div class="info-row">
          <span class="label">系统</span>
          <span class="value">{{ node.baseinfo.os }} ({{ node.baseinfo.arch }})</span>
        </div>
        <div class="info-row">
          <span class="label">内核</span>
          <span class="value">{{ node.baseinfo.kernel_version }}</span>
        </div>
        <div class="info-row">
          <span class="label">CPU</span>
          <span class="value cpu-name">{{ node.baseinfo.cpu_name }} ({{ node.baseinfo.cpu_cores }} 核)</span>
        </div>
        <div class="info-row">
          <span class="label">内存</span>
          <span class="value">{{ formatBytes(node.baseinfo.mem_total) }}</span>
        </div>
        <div class="info-row">
          <span class="label">硬盘</span>
          <span class="value">{{ formatBytes(node.baseinfo.disk_total) }}</span>
        </div>
        <div class="info-row">
          <span class="label">虚拟化</span>
          <span class="value">{{ node.baseinfo.virtualization || '物理机/未知' }}</span>
        </div>
        <div class="info-row">
          <span class="label">创建时间</span>
          <span class="value">{{ formatDate(node.createdAt) }}</span>
        </div>
        <div class="info-row" v-if="node.baseinfo.ipv4">
          <span class="label">IPv4</span>
          <span class="value ip-text">{{ node.baseinfo.ipv4 }}</span>
        </div>
        <div class="info-row" v-if="node.baseinfo.ipv6">
          <span class="label">IPv6</span>
          <span class="value ip-text">{{ node.baseinfo.ipv6 }}</span>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.node-preview {
  position: fixed;
  bottom: 24px;
  right: 24px;
  width: 320px;
  background: var(--card);
  backdrop-filter: blur(10px);
  border: 1px solid var(--border);
  border-radius: 16px;
  box-shadow: var(--shadow-lg);
  padding: 16px;
  z-index: 9999;
  /* 鼠标穿透，防止挡住底层的操作引发卡片频繁抖动 */
  pointer-events: none; 
}

.preview-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border);
}

.preview-header h4 {
  margin: 0;
  font-size: 1rem;
  color: var(--text);
  font-weight: 600;
}

.version-badge {
  background: var(--surface-3);
  color: var(--muted);
  font-size: 0.7rem;
  padding: 2px 6px;
  border-radius: 4px;
  font-family: monospace;
}

.preview-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.info-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  font-size: 0.8rem;
  line-height: 1.4;
}

.label {
  color: var(--muted);
  min-width: 50px;
}

.value {
  color: var(--text-soft);
  font-weight: 500;
  text-align: right;
  word-break: break-all;
}

.cpu-name {
  max-width: 200px;
}

.ip-text {
  font-family: monospace;
  background: var(--surface-2);
  padding: 1px 4px;
  border-radius: 4px;
}

/* 过渡动画：从右下角滑入并渐显 */
.preview-slide-enter-active,
.preview-slide-leave-active {
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}
.preview-slide-enter-from,
.preview-slide-leave-to {
  opacity: 0;
  transform: translateY(20px) scale(0.95);
}
</style>