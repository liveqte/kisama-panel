<script setup lang="ts">
import { computed, inject, type Ref } from 'vue'; // 💡 ✨ 引入 inject 接口
import type { AgentNode } from '../types';
import { hoveredNode, showPreview, isPersistent } from '../composables/usePreview';
import { useBatchFlagStatus } from '../composables/useNodes';
import { isVersionAtLeast, isGoVersion } from '../lib/version';
import { isLegacyAgentVersion, LEGACY_AGENT_EOL } from '../lib/proto-detect';

const props = defineProps<{
  nodes: AgentNode[]; // 🎯 完美恢复原厂设置，不需要在 Props 里杂糅任何中转变量
}>();

// 💡 ✨【优雅闭环】：直接从底座 Inject 拿到响应式状态锁，NodeList 的脚本区成功做到零污染
const updatingNodeIds = inject<Ref<Set<string>>>('updatingNodeIds');
// 💡 ✨【核心新增】：自适应单节点检测，通过版本后缀特征刚性判定当前循环行是否为 PHP 探针
const isPhpNode = (node: AgentNode): boolean => {
  return !!node.baseinfo?.version?.toLowerCase().includes('php');
};
// ⚠️ LEGACY_AGENT_SUPPORT（0.6.0 移除）：旧版 agent（<0.4.8）提示角标。
// 不排除 PHP 探针节点 —— 其同样走旧 2 段签名协议，纯按版本号判定。
const isLegacyAgent = (node: AgentNode): boolean => {
  return isLegacyAgentVersion(node.baseinfo?.version);
};
// 🤖【核心修改】：AI 自动化按钮需要代理版本 >= 0.4.3 才支持（临时密钥模块），PHP 版本同样开放
const hasAiAutomation = (node: AgentNode): boolean => {
  return isVersionAtLeast(node.baseinfo?.version, '0.4.3');
};
// 🌐【核心新增】：内网映射（Argo 临时隧道）按钮 —— 仅版本 >= 0.4.5 且非 GO 版本可用（/api/argo 仅 Python 版实现）
const hasArgoTunnel = (node: AgentNode): boolean => {
  if (isPhpNode(node)) return false;
  if (isGoVersion(node.baseinfo?.version)) return false;
  return isVersionAtLeast(node.baseinfo?.version, '0.4.5');
};
defineEmits<{
  (e: 'refresh', id: string): void;
  (e: 'edit', id: string): void;
  (e: 'delete', id: string): void;
  (e: 'terminal', id: string): void;
  (e: 'files', id: string): void;
  (e: 'tasks', id: string): void;
  (e: 'ai-prompt', id: string): void;
  (e: 'argo-tunnel', id: string): void;
  (e: 'full-terminal', id: string): void;
  (e: 'update-agent', id: string): void;
}>();

const handleMouseEnter = (node: AgentNode) => {
  if (showPreview.value) hoveredNode.value = node;
};
const handleMouseLeave = () => {
  if (!isPersistent.value) hoveredNode.value = null;
};

const formatRelativeTime = (ts?: number): string => {
  if (!ts) return '从未连接';
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins}m前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h前`;
  return `${Math.floor(hours / 24)}d前`;
};

const getShortStatus = (status?: string): string => {
  if (!status) return 'OFF';
  const s = status.toLowerCase();
  if (s === 'online') return 'ON';
  if (s === 'offline') return 'OFF';
  if (s === 'syncing') return 'SYNC';
  if (s === 'error') return 'ERR';
  return 'OFF';
};

const { flagStatuses } = useBatchFlagStatus(computed(() => props.nodes) as Ref<AgentNode[]>);

const getOsIcon = (osText?: string): string => {
  if (!osText) return '💻';
  const os = osText.toLowerCase();
  if (os.includes('debian')) return '🍥';
  if (os.includes('ubuntu')) return '🟠';
  if (os.includes('centos') || os.includes('redhat') || os.includes('rhel')) return '⛑️';
  if (os.includes('fedora')) return '🧢';
  if (os.includes('alpine')) return '🗻';
  if (os.includes('arch')) return '⛺';
  if (os.includes('linux')) return '🐧';
  if (os.includes('windows')) return '🪟';
  if (os.includes('macos') || os.includes('darwin')) return '🍎';
  if (os.includes('freebsd')) return '😈';
  return '💻';
};

const getFormattedArch = (archText?: string): string => {
  if (!archText) return '未知';
  const arch = archText.toLowerCase();
  if (arch.includes('x86_64') || arch.includes('amd64')) return 'X86_64';
  if (arch.includes('aarch64') || arch.includes('arm64')) return 'ARM64';
  return archText.toUpperCase();
};
</script>

<template>
  <div class="node-table-wrapper">
    <table class="node-table">
      <colgroup>
        <col style="width: 75px;" />   <!-- 状态 -->
        <col style="width: 14%;" />    <!-- 节点名称 (由 16% 优化收缩) -->
        <col style="width: 15%;" />    <!-- Domain / URL (由 17% 优化收缩) -->
        <col style="width: 12%;" />    <!-- 系统架构 -->
        <col style="width: 19%;" />    <!-- IPv4 地址 (★由 14% 强力刚性扩宽至 19%，承载 [HOST] 标签) -->
        <col style="width: 10%;" />    <!-- 最后连接 (由 11% 优化收缩) -->
        <col style="width: 240px;" />  <!-- 快捷功能 -->
        <col style="width: 120px;" />  <!-- 管理 -->
      </colgroup>
      <thead>
        <tr>
          <th>状态</th>
          <th>节点名称</th>
          <th>Domain / URL</th>
          <th>系统架构</th>
          <th>IPv4 地址</th>
          <th>最后连接</th>
          <th>快捷功能</th>
          <th class="text-center">管理</th>
        </tr>
      </thead>
      <tbody>
        <tr 
          v-for="node in nodes" 
          :key="node.id"
          class="node-table-row"
          @mouseenter="handleMouseEnter(node)"
          @mouseleave="handleMouseLeave"
        >
          <td>
            <div class="status-chip" :class="node.status">
              <span class="pulse" :class="node.status"></span>
              {{ getShortStatus(node.status) }}
            </div>
          </td>
          <td class="font-semibold text-dark truncate-cell">
            <div class="name-cell">
              <span class="ip-flag">
                <span v-if="flagStatuses[node.id] === 'LOCAL'">🏠</span>
                <span v-else-if="flagStatuses[node.id] === 'ERROR'">🚫</span>
                <span v-else-if="flagStatuses[node.id] === 'UNKNOWN'">🌍</span>
                <img v-else-if="flagStatuses[node.id]" :src="`https://flagcdn.com/w20/${flagStatuses[node.id].toLowerCase()}.png`" :alt="flagStatuses[node.id]" />
                <span v-else>🌍</span>
              </span>
              <span class="node-name-text" :title="node.name">{{ node.name }}</span>
              <!-- ⚠️ LEGACY_AGENT_SUPPORT（0.6.0 移除）：旧版 agent 提示角标 -->
              <span
                v-if="isLegacyAgent(node)"
                class="legacy-agent-chip"
                :title="`旧版 agent（<0.4.8），面板 ${LEGACY_AGENT_EOL} 起将不再支持，请升级`"
              >旧版</span>
            </div>
          </td>
          <td class="truncate-cell">
            <span class="domain-badge" :title="node.domain">{{ node.domain }}</span>
          </td>
          <td class="truncate-cell">
            <span v-if="node.baseinfo" :title="node.baseinfo.os" class="os-info">
              {{ getOsIcon(node.baseinfo.os) }} {{ getFormattedArch(node.baseinfo.arch) }}
            </span>
            <span v-else class="text-muted">-</span>
          </td>
          <td class="mono-text truncate-cell" :title="node.baseinfo?.ipv4 || '无 IPv4'">
            <!-- 针对在线的 IPv4 节点，根据对应的 ipType 分流渲染特定色彩的高对比度前缀标记 -->
            <template v-if="node.baseinfo?.ipv4 && node.ipType">
              <span v-if="node.ipType === 'isp'" style="color: #15803d; font-weight: bold; margin-right: 6px;">[ISP]</span>
              <span v-else-if="node.ipType === 'business'" style="color: #f59e0b; font-weight: bold; margin-right: 6px;">[BIZ]</span>
              <span v-else-if="node.ipType === 'hosting'" style="color: #ef4444; font-weight: bold; margin-right: 6px;">[HOST]</span>
            </template>
            {{ node.baseinfo?.ipv4 || '无 IPv4' }}
          </td>
          <td class="meta-info truncate-cell">
            <span v-if="node.lastConnected">🕒 {{ formatRelativeTime(node.lastConnected) }}</span>
            <span v-else class="text-muted">未连接</span>
          </td>
          
          <td>
            <div class="btn-group">
              <button class="feature-btn" title="终端" @click="$emit('terminal', node.id)">🖥️</button>
              
              <!-- 💡 ✨【核心修改 1】：全功能终端按钮，若是 PHP 节点则硬性隐藏 -->
              <button 
                v-if="!isPhpNode(node)" 
                class="feature-btn" 
                title="全功能终端" 
                @click="$emit('full-terminal', node.id)"
              >
                ✨
              </button>
              
              <button class="feature-btn" title="文件管理" @click="$emit('files', node.id)">📁</button>
              
              <!-- 💡 ✨【核心修改 2】：计划任务管理按钮，若是 PHP 节点则硬性隐藏 -->
              <button 
                v-if="!isPhpNode(node)" 
                class="feature-btn" 
                title="任务" 
                @click="$emit('tasks', node.id)"
              >
                📋
              </button>
              
              <!-- 💡 ✨【核心新增】：AI 自动化授权按钮，仅当代理版本 >= 0.4.3 时显示 -->
              <button 
                v-if="hasAiAutomation(node)" 
                class="feature-btn ai-prompt-btn" 
                title="AI 自动化" 
                @click="$emit('ai-prompt', node.id)"
              >
                🤖
              </button>
              
              <!-- 💡 🌐【核心新增】：内网映射（Argo 临时隧道）按钮，仅当版本 >= 0.4.5 且非 GO 版本时显示 -->
              <button 
                v-if="hasArgoTunnel(node)" 
                class="feature-btn argo-tunnel-btn" 
                title="内网映射" 
                @click="$emit('argo-tunnel', node.id)"
              >
                🌐
              </button>
              
              <button 
                class="feature-btn" 
                :disabled="updatingNodeIds?.has(node.id)"
                @click.stop="$emit('update-agent', node.id)" 
                title="在线全自动热更新代理端 (Agent)"
              >
                {{ updatingNodeIds?.has(node.id) ? '⏳' : '⬆️' }}
              </button>
            </div>
          </td>
          <td class="text-center">
            <div class="btn-group justify-center">
              <button class="action-btn" @click="$emit('refresh', node.id)" :disabled="node.status === 'syncing'" title="刷新">🔄</button>
              <button class="action-btn" @click="$emit('edit', node.id)" title="编辑">✏️</button>
              <button class="action-btn danger" @click="$emit('delete', node.id)" title="删除">🗑️</button>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
/* 保持您原本完美的样式不动 */
.node-table-wrapper {
  width: 100%;
  overflow: hidden;
  background: var(--card, #ffffff);
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 14px;
  box-shadow: var(--shadow);
}

.node-table {
  width: 100%;
  border-collapse: collapse;
  text-align: left;
  font-size: 0.85rem;
  table-layout: fixed; 
}

.node-table th {
  background: var(--surface-2);
  padding: 12px 16px;
  font-weight: 600;
  color: var(--muted, #64748b);
  border-bottom: 1px solid var(--border, #e2e8f0);
  white-space: nowrap;
}

.node-table td {
  padding: 10px 16px;
  border-bottom: 1px solid var(--border, #e2e8f0);
  color: var(--text-soft, #475569);
  vertical-align: middle;
}

.truncate-cell {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.node-table-row:last-child td {
  border-bottom: none;
}
.node-table-row:hover {
  background: var(--hover-bg, #f8fafc);
}

.name-cell {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}
.node-name-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ip-flag {
  font-size: 1.1rem;
  display: inline-flex;
  flex-shrink: 0;
}
.ip-flag img {
  width: 18px;
  height: auto;
  border-radius: 2px;
}

.domain-badge {
  font-size: 0.75rem;
  font-family: monospace;
  background: var(--surface-3, #f1f5f9);
  padding: 2px 8px;
  border-radius: 4px;
  color: var(--muted, #64748b);
  width: 100%;
  display: inline-block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  border-radius: 6px;
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  background: var(--surface-2, #f8fafc);
  border: 1px solid var(--border, #e2e8f0);
  color: var(--muted, #64748b);
  min-width: 54px; 
  justify-content: center;
}
.status-chip.online { background: var(--chip-online-bg); border-color: var(--chip-online-border); color: var(--chip-online-text); }

/* ⚠️ LEGACY_AGENT_SUPPORT（0.6.0 移除）：旧版 agent 提示角标（节点名称后，不换行） */
.legacy-agent-chip {
  flex-shrink: 0;
  white-space: nowrap;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 0.65rem;
  font-weight: 600;
  background: var(--surface-3, #f1f5f9);
  border: 1px dashed var(--border, #e2e8f0);
  color: var(--muted, #64748b);
  cursor: help;
}
.status-chip.offline { background: var(--chip-offline-bg); border-color: var(--chip-offline-border); color: var(--chip-offline-text); }
.status-chip.syncing { background: var(--chip-syncing-bg); border-color: var(--chip-syncing-border); color: var(--chip-syncing-text); }
.status-chip.error { background: var(--chip-error-bg); border-color: var(--chip-error-border); color: var(--chip-error-text); }

.pulse { width: 6px; height: 6px; border-radius: 50%; background: currentColor; flex-shrink: 0; }
.pulse.online { animation: pulse-green 1.5s infinite; }
.pulse.offline { animation: pulse-red 2.5s infinite; }
.pulse.syncing { animation: pulse-blue 1.2s infinite; }
.pulse.error { animation: pulse-red 1s infinite; }
@keyframes pulse-green {
  0% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.4); }
  70% { box-shadow: 0 0 0 6px rgba(16, 185, 129, 0); }
  100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
}
@keyframes pulse-red {
  0% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.35); }
  70% { box-shadow: 0 0 0 5px rgba(239, 68, 68, 0); }
  100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
}
@keyframes pulse-blue {
  0% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.4); }
  70% { box-shadow: 0 0 0 6px rgba(59, 130, 246, 0); }
  100% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0); }
}

.os-info {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.mono-text {
  font-family: monospace;
  color: var(--text-strong, #0f172a);
}

.btn-group {
  display: flex;
  gap: 4px;
  align-items: center;
}
.justify-center { justify-content: center; }
.text-center { text-align: center !important; }
.font-semibold { font-weight: 600; }
.text-dark { color: var(--text-strong, #0f172a) !important; }
.text-muted { color: var(--muted, #94a3b8); }

.feature-btn, .action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;  
  height: 28px;
  border-radius: 6px;
  background: var(--surface-2, #f8fafc);
  border: 1px solid var(--border, #e2e8f0);
  cursor: pointer;
  transition: all 0.15s;
  font-size: 0.85rem;
  flex-shrink: 0 !important; 
}
.feature-btn:hover {
  background: var(--btn-bg, #ffffff);
  border-color: var(--primary, #3b82f6);
}
.feature-btn.ai-prompt-btn:hover {
  background: var(--hover-tint-purple);
  border-color: #7c3aed;
}
.feature-btn.argo-tunnel-btn:hover {
  background: var(--hover-tint-teal);
  border-color: #0d9488;
}
.action-btn:hover:not(:disabled) {
  background: var(--surface-3, #f1f5f9);
  color: var(--text, #1e293b);
}
.action-btn.danger:hover {
  background: var(--hover-tint-red);
  color: var(--danger, #ef4444);
  border-color: var(--chip-offline-border);
}
.action-btn:disabled { opacity: 0.4; cursor: not-allowed; }
</style>