// src/composables/useRecycleBin.ts
// 🗄️ 节点回收站：删除节点时软删除（冻结）到此独立存储，
// 与 agent_nodes_config 完全隔离 —— task-daemon 等只读 useNodes().nodes
// 的轮询逻辑天然触不到冻结节点，恢复前不会发起任何连接/任务。
import { ref } from 'vue';
import type { AgentNode } from '../types';

export interface RecycledNode extends AgentNode {
  /** 冻结时间戳 */
  deletedAt: number;
}

const RECYCLE_BIN_KEY = 'agent_recycle_bin';

// 模块级单例：所有组件共享同一份响应式回收站状态
const recycledNodes = ref<RecycledNode[]>([]);
let loaded = false;

const loadFromStorage = () => {
  try {
    const raw = localStorage.getItem(RECYCLE_BIN_KEY);
    const list = raw ? JSON.parse(raw) : [];
    recycledNodes.value = Array.isArray(list) ? list : [];
  } catch {
    recycledNodes.value = [];
  }
  loaded = true;
};

const saveToStorage = () => {
  try {
    localStorage.setItem(RECYCLE_BIN_KEY, JSON.stringify(recycledNodes.value));
  } catch { /* 存储满等异常不阻塞删除主流程 */ }
};

const ensureLoaded = () => {
  if (!loaded) loadFromStorage();
};

/** 删除节点时调用：将节点冻结进回收站 */
const moveToRecycleBin = (node: AgentNode, deletedAt = Date.now()) => {
  ensureLoaded();
  if (recycledNodes.value.some(n => n.id === node.id)) return;
  recycledNodes.value.push({ ...node, deletedAt });
  saveToStorage();
};

/** 恢复前取出：返回节点并从回收站移除（不写活跃列表，由调用方编排） */
const takeFromRecycleBin = (id: string): RecycledNode | null => {
  ensureLoaded();
  const idx = recycledNodes.value.findIndex(n => n.id === id);
  if (idx === -1) return null;
  const [node] = recycledNodes.value.splice(idx, 1);
  saveToStorage();
  return node;
};

/** 彻底删除单个冻结节点 */
const purgeFromRecycleBin = (id: string) => {
  ensureLoaded();
  recycledNodes.value = recycledNodes.value.filter(n => n.id !== id);
  saveToStorage();
};

/** 清空回收站 */
const emptyRecycleBin = () => {
  recycledNodes.value = [];
  saveToStorage();
};

/** 批量移除（导入/同步复活节点时去重：活跃列表里已有同 id 节点，冻结副本作废） */
const removeFromRecycleBin = (ids: string[]) => {
  if (!ids.length) return;
  ensureLoaded();
  const idSet = new Set(ids);
  const before = recycledNodes.value.length;
  recycledNodes.value = recycledNodes.value.filter(n => !idSet.has(n.id));
  if (recycledNodes.value.length !== before) saveToStorage();
};

/**
 * 备份包/云同步合并：按 id 并集，deletedAt 新者胜。
 * 仅在回收站域内部做并集，不推断活跃列表状态；
 * 「冻结副本不得与活跃节点同 id 共存」的过滤由调用方负责
 * （importConfig 导入去重 / applyFullBackupBundle 应用时过滤）。
 */
const mergeRecycleBin = (incoming: RecycledNode[]) => {
  if (!Array.isArray(incoming)) return;
  ensureLoaded();
  const map = new Map<string, RecycledNode>();
  for (const n of recycledNodes.value) {
    if (n?.id) map.set(n.id, n);
  }
  for (const n of incoming) {
    if (!n?.id) continue;
    const cur = map.get(n.id);
    if (!cur || (n.deletedAt || 0) > (cur.deletedAt || 0)) map.set(n.id, n);
  }
  recycledNodes.value = Array.from(map.values());
  saveToStorage();
};

export function useRecycleBin() {
  ensureLoaded();
  return {
    recycledNodes,
    moveToRecycleBin,
    takeFromRecycleBin,
    purgeFromRecycleBin,
    emptyRecycleBin,
    removeFromRecycleBin,
    mergeRecycleBin,
  };
}
