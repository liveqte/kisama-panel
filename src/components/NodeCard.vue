<script setup lang="ts">
import { computed, inject, type Ref } from 'vue';
import type { AgentNode } from '../types';
import { hoveredNode, showPreview, isPersistent } from '../composables/usePreview';
import { useNodeFlagStatus } from '../composables/useNodes';
import { isVersionAtLeast, isGoVersion } from '../lib/version';
import { isLegacyAgentVersion, LEGACY_AGENT_EOL } from '../lib/proto-detect';

const handleMouseEnter = () => {
  if (showPreview.value) {
    hoveredNode.value = props.node;
  }
};

const handleMouseLeave = () => {
  if (!isPersistent.value) {
    hoveredNode.value = null;
  }
};

const props = defineProps<{
  node: AgentNode;
}>();

// 💡 ✨【核心新增】：通过版本特征刚性判定当前是否为 PHP 探针节点
const isPhpNode = computed(() => {
  return !!props.node.baseinfo?.version?.toLowerCase().includes('php');
});

// ⚠️ LEGACY_AGENT_SUPPORT（0.6.0 移除）：旧版 agent（<0.4.8）提示角标。
// 不排除 PHP 探针节点 —— 其同样走旧 2 段签名协议，纯按版本号判定。
const isLegacyAgent = computed(() => {
  return isLegacyAgentVersion(props.node.baseinfo?.version);
});

// 💡 🤖【核心修改】：AI 自动化按钮需要代理版本 >= 0.4.3 才支持（临时密钥模块），PHP 版本同样开放
const hasAiAutomation = computed(() => {
  return isVersionAtLeast(props.node.baseinfo?.version, '0.4.3');
});

// 💡 🌐【核心新增】：内网映射（Argo 临时隧道）按钮 —— 仅版本 >= 0.4.5 且非 GO 版本可用（/api/argo 仅 Python 版实现）
const hasArgoTunnel = computed(() => {
  if (isPhpNode.value) return false;
  if (isGoVersion(props.node.baseinfo?.version)) return false;
  return isVersionAtLeast(props.node.baseinfo?.version, '0.4.5');
});

// 💡 ✨【优雅闭环】：直接跨级 Inject 拿到响应式状态锁，100% 免疫中转层污染
const updatingNodeIds = inject<Ref<Set<string>>>('updatingNodeIds');

const emit = defineEmits<{
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

const { flagStatus } = useNodeFlagStatus(
  computed(() => props.node.baseinfo?.ipv4 || ''),
  computed(() => props.node.flag),
  computed(() => props.node.ipType)
);

// 核心系统信息提取
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

const formattedArch = computed(() => {
  if (!props.node.baseinfo?.arch) return '未知';
  const arch = props.node.baseinfo.arch.toLowerCase();
  if (arch.includes('x86_64') || arch.includes('amd64')) return 'X86_64';
  if (arch.includes('aarch64') || arch.includes('arm64')) return 'ARM64';
  return props.node.baseinfo.arch.toUpperCase();
});

const displayIpv6 = computed(() => {
  const ipv6 = props.node.baseinfo?.ipv6;
  if (!ipv6) return "None";
  const lower = ipv6.toLowerCase();
  if (lower.startsWith('fe') || lower.startsWith('fd') || lower.startsWith('fc')) {
    return "None"; 
  }
  return ipv6;
});
</script>

<template>
  <div 
    class="node-card" 
    @mouseenter="handleMouseEnter"
    @mouseleave="handleMouseLeave"
  >
    <div class="card-header">
      <div class="identity">
        <span class="ip-flag" :title="node.baseinfo?.ipv4 || '未获取到 IP'">
          <span v-if="flagStatus === 'LOCAL'">🏠</span>
          <span v-else-if="flagStatus === 'ERROR'">🚫</span>
          <span v-else-if="flagStatus === 'UNKNOWN'">🌍</span>
          <img v-else-if="flagStatus" :src="`https://flagcdn.com/w20/${flagStatus.toLowerCase()}.png`" :alt="flagStatus" />
          <span v-else>🌍</span>
        </span>
        <h3 :title="node.name">{{ node.name }}</h3>
        <!-- ⚠️ LEGACY_AGENT_SUPPORT（0.6.0 移除）：旧版 agent 提示角标 -->
        <span
          v-if="isLegacyAgent"
          class="legacy-agent-chip"
          :title="`该节点运行旧版 agent（<0.4.8），面板 ${LEGACY_AGENT_EOL} 起将不再支持，请升级 agent`"
        >旧版</span>
        <span class="domain-badge" :title="node.domain">{{ node.domain }}</span>
      </div>
      <div class="status-chip" :class="node.status">
        <span class="pulse" :class="node.status"></span>
        {{ node.status || 'unknown' }}
      </div>
    </div>

    <div class="info-block">
      <div class="info-row">
        <span class="info-item truncate-os" :title="node.baseinfo?.os || '未知系统'">
          {{ getOsIcon(node.baseinfo?.os) }} {{ node.baseinfo?.os || '未知系统' }}
        </span>
        <span class="divider">|</span>
        <span class="info-item" title="CPU架构">
          ⚙️ {{ formattedArch }}
        </span>
        <span class="divider">|</span>
        <span class="info-item meta-time" title="最后连接时间">
          🕒 {{ node.lastConnected ? formatRelativeTime(node.lastConnected) : '未连接' }}
        </span>
      </div>
      <div class="info-row ip-row">
        <span class="info-item" title="IPv4">
          🌐 
          <template v-if="node.baseinfo?.ipv4 && node.ipType">
            <span v-if="node.ipType === 'isp'" style="color: #15803d; font-weight: bold; margin-right: 6px;">[ISP]</span>
            <span v-else-if="node.ipType === 'business'" style="color: #f59e0b; font-weight: bold; margin-right: 6px;">[BIZ]</span>
            <span v-else-if="node.ipType === 'hosting'" style="color: #ef4444; font-weight: bold; margin-right: 6px;">[HOST]</span>
          </template>
          
          {{ node.baseinfo?.ipv4 || '无 IPv4' }}
        </span>
        <span class="divider">|</span>
        <span class="info-item truncate-ipv6" :title="node.baseinfo?.ipv6 || 'None'">
          {{ displayIpv6 }}
        </span>
      </div>
    </div>

    <div class="card-footer">
      <!-- 💡 功能操作组 -->
      <div class="feature-actions">
        <!-- 基础终端与文件管理，全语言通用保持保留 -->
        <button class="feature-btn" title="终端" @click="$emit('terminal', node.id)">🖥️</button>
        
        <!-- 💡 ✨【核心修改点 1】：全功能终端按钮，若为 PHP 探针节点则直接隐藏 -->
        <button 
          v-if="!isPhpNode" 
          class="feature-btn" 
          title="全功能终端" 
          @click="$emit('full-terminal', node.id)"
        >
          ✨
        </button>
        
        <button class="feature-btn" title="文件" @click="$emit('files', node.id)">📁</button>
        
        <!-- 💡 ✨【核心修改点 2】：计划任务管理按钮，若为 PHP 探针节点则直接隐藏 -->
        <button 
          v-if="!isPhpNode" 
          class="feature-btn" 
          title="任务" 
          @click="$emit('tasks', node.id)"
        >
          📋
        </button>
        
        <!-- 💡 ✨【核心新增】：AI 自动化授权按钮，仅当代理版本 >= 0.4.3 时显示 -->
        <button 
          v-if="hasAiAutomation" 
          class="feature-btn ai-prompt-btn" 
          title="AI 自动化" 
          @click="$emit('ai-prompt', node.id)"
        >
          🤖
        </button>
        
        <!-- 💡 🌐【核心新增】：内网映射（Argo 临时隧道）按钮，仅当版本 >= 0.4.5 且非 GO 版本时显示 -->
        <button 
          v-if="hasArgoTunnel" 
          class="feature-btn argo-tunnel-btn" 
          title="内网映射" 
          @click="$emit('argo-tunnel', node.id)"
        >
          🌐
        </button>
        
        <button 
          class="feature-btn update-patch-btn" 
          :disabled="updatingNodeIds?.has(node.id)"
          @click.stop="$emit('update-agent', node.id)" 
          title="在线全自动热更新代理端 (Agent)"
        >
          {{ updatingNodeIds?.has(node.id) ? '⏳' : '⬆️' }}
        </button>
      </div>
      
      <div class="admin-actions">
        <button class="action-btn" @click="$emit('refresh', node.id)" :disabled="node.status === 'syncing'" title="刷新">🔄</button>
        <button class="action-btn" @click="$emit('edit', node.id)" title="编辑">✏️</button>
        <button class="action-btn danger" @click="$emit('delete', node.id)" title="删除">🗑️</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.node-card {
  background: var(--card);
  border-radius: 14px;
  padding: 14px 16px;
  box-shadow: var(--shadow);
  border: 1px solid var(--border);
  transition: all 0.2s ease;
  display: flex;
  flex-direction: column;
  gap: 12px; 
  min-width: 0; 
}

.node-card:hover {
  box-shadow: 0 14px 28px -10px rgba(59, 130, 246, 0.22), var(--shadow-lg);
  border-color: rgba(59, 130, 246, 0.45);
  transform: translateY(-4px);
}

/* Header */
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}
.identity {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}
.identity h3 {
  font-size: 1.15rem;
  font-weight: 600;
  margin: 0;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  max-width: 6em;
}
.ip-flag {
  font-size: 1.2rem;
  flex-shrink: 0;
}
.ip-flag img {
  width: 20px;
  height: auto;
  border-radius: 2px;
}
.domain-badge {
  font-size: 0.75rem;
  font-family: monospace;
  background: var(--surface-3);
  padding: 2px 8px;
  border-radius: 4px;
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  flex: 1;
}

.status-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  background: var(--surface-2);
  border: 1px solid var(--border);
  color: var(--muted);
  flex-shrink: 0;
}
.status-chip.online { background: var(--chip-online-bg); border-color: var(--chip-online-border); color: var(--chip-online-text); }

/* ⚠️ LEGACY_AGENT_SUPPORT（0.6.0 移除）：旧版 agent 提示角标（节点名称后，不换行） */
.legacy-agent-chip {
  flex-shrink: 0;
  white-space: nowrap;
  padding: 2px 7px;
  border-radius: 5px;
  font-size: 0.7rem;
  font-weight: 600;
  background: var(--surface-3);
  border: 1px dashed var(--border-strong, var(--border));
  color: var(--muted);
  cursor: help;
}
.status-chip.offline { background: var(--chip-offline-bg); border-color: var(--chip-offline-border); color: var(--chip-offline-text); }
.status-chip.syncing { background: var(--chip-syncing-bg); border-color: var(--chip-syncing-border); color: var(--chip-syncing-text); }
.status-chip.error { background: var(--chip-error-bg); border-color: var(--chip-error-border); color: var(--chip-error-text); }
.pulse { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
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

/* 中间独立信息区 */
.info-block {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px; 
}
.info-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.8rem;
  color: var(--text-soft);
  min-width: 0;
}
.info-item {
  display: flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap; 
}
.truncate-os {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 90px; /* 防止超长系统文本把连接时间挤掉 */
  flex-shrink: 1;
}
.meta-time {
  color: var(--muted);
  font-weight: 500;
}
.divider { color: var(--border-strong); font-size: 0.7rem; flex-shrink: 0; }
.ip-row {
  font-family: monospace;
  color: var(--text-strong);
}
.truncate-ipv6 {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Footer 布局 */
.card-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.feature-actions { display: flex; gap: 4px; }
.feature-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;  
  height: 32px;
  border-radius: 6px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  cursor: pointer;
  transition: all 0.15s;
  flex-shrink: 0;
}
.feature-btn:hover:not(:disabled) {
  background: var(--btn-bg);
  border-color: var(--primary);
}
/* 对齐高亮更新色调 */
.feature-btn.update-patch-btn:hover:not(:disabled) {
  border-color: #059669;
  background: var(--hover-tint-green);
}
.feature-btn.ai-prompt-btn:hover:not(:disabled) {
  border-color: #7c3aed;
  background: var(--hover-tint-purple);
}
.feature-btn.argo-tunnel-btn:hover:not(:disabled) {
  border-color: #0d9488;
  background: var(--hover-tint-teal);
}
.feature-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.admin-actions { display: flex; gap: 4px; }
.action-btn {
  background: transparent;
  border: 1px solid transparent;
  width: 32px;
  height: 32px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1rem;
  cursor: pointer;
  color: var(--muted);
  transition: all 0.15s;
  flex-shrink: 0;
}
.action-btn:hover:not(:disabled) {
  background: var(--surface-3);
  border-color: var(--border);
  color: var(--text);
}
.action-btn.danger:hover {
  background: var(--hover-tint-red);
  color: var(--danger);
  border-color: var(--chip-offline-border);
}
.action-btn:disabled { opacity: 0.4; cursor: not-allowed; }
</style>