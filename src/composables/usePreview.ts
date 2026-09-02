// src/composables/usePreview.ts
import { ref } from 'vue';
import type { AgentNode } from '../types';

export const hoveredNode = ref<AgentNode | null>(null);

// 新增：预览设置
export const showPreview = ref(localStorage.getItem('node_preview_visible') !== 'false');
export const isPersistent = ref(localStorage.getItem('node_preview_persistent') === 'true');

// 保存设置到本地
export const savePreviewSettings = () => {
  localStorage.setItem('node_preview_visible', String(showPreview.value));
  localStorage.setItem('node_preview_persistent', String(isPersistent.value));
};