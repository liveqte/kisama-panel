<!-- src/components/ArgoTunnel.vue
  🌐 内网映射管理面板：基于 /api/argo 路由
  - GET  /api/argo   查询当前存活中的 Cloudflare 临时隧道列表
  - POST /api/argo   创建临时隧道（将指定端口转发为 https://<随机>.trycloudflare.com）
-->
<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { AgentClient, type ArgoTunnel } from '../lib/agent-client';
import type { AgentNode } from '../types';

const props = defineProps<{
  node: AgentNode;
  visible: boolean;
  globalConfig?: { ecdsaPrivateKey?: string; eciesPrivateKey?: string };
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const loading = ref(false);
const creating = ref(false);
const error = ref<string | null>(null);
const tunnels = ref<ArgoTunnel[]>([]);
const createError = ref<string | null>(null);
const createSuccess = ref<{ tunnel_domain: string; port: number } | null>(null);

// ⚠️ type="number" 输入框的 v-model 会自动将值转成 number，因此用 string | number 并统一 String() 归一化
const portInput = ref<string | number>('');
const duplicate = ref(false);
const copiedDomain = ref('');
const deletingDomains = ref<Set<string>>(new Set());

const portValid = computed(() => {
  const raw = String(portInput.value).trim();
  if (!raw) return { valid: true, msg: '' };
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { valid: false, msg: '端口必须是 1~65535 的整数' };
  }
  return { valid: true, msg: '' };
});

const buildClient = (): AgentClient => {
  const ecdsaKey = props.node.ecdsaPrivateKey || props.globalConfig?.ecdsaPrivateKey || '';
  const eciesKey = props.node.eciesPrivateKey || props.globalConfig?.eciesPrivateKey || '';
  if (!ecdsaKey || !eciesKey) {
    throw new Error('该节点缺少 ECDSA/ECIES 控制端密钥配置，无法通过认证访问 /api/argo');
  }
  return new AgentClient({
    domain: props.node.domain,
    eciesPrivateKey: eciesKey,
    ecdsaPrivateKey: ecdsaKey,
    timeout: 15000,
  });
};

let loadSeq = 0;

const loadTunnels = async (silent = false) => {
  const seq = ++loadSeq;
  if (!silent) loading.value = true;
  error.value = null;
  try {
    const client = buildClient();
    await client.getBaseInfo();
    const res = await client.listArgoTunnels();
    if (seq !== loadSeq) return;
    if (res.status !== 'ok') {
      throw new Error(`查询失败: ${JSON.stringify(res)}`);
    }
    tunnels.value = res.tunnels || [];
  } catch (err: any) {
    if (seq === loadSeq) error.value = err.message || '查询隧道列表失败';
  } finally {
    if (seq === loadSeq) loading.value = false;
  }
};

const handleCreate = async () => {
  if (creating.value) return;
  if (!portValid.value.valid) {
    createError.value = portValid.value.msg;
    return;
  }
  createError.value = null;
  createSuccess.value = null;
  creating.value = true;
  try {
    const client = buildClient();
    await client.getBaseInfo();
    const req: { port?: number; duplicate: boolean } = { duplicate: duplicate.value };
    const trimmed = String(portInput.value).trim();
    if (trimmed) req.port = Number(trimmed);
    const res = await client.createArgoTunnel(req);
    if (res.status !== 'ok' || !res.created) {
      throw new Error(res.message || `创建失败（HTTP 冲突或内部错误）`);
    }
    createSuccess.value = { tunnel_domain: res.tunnel_domain || '', port: res.port };
    portInput.value = '';
    duplicate.value = false;
    await loadTunnels(true);
  } catch (err: any) {
    createError.value = err.message || '创建隧道失败';
  } finally {
    creating.value = false;
  }
};

const handleDelete = async (t: ArgoTunnel) => {
  if (deletingDomains.value.has(t.tunnel_domain)) return;
  if (!confirm(`确定删除隧道？\n\n域名: ${t.tunnel_domain}\n端口: ${t.port}\n\n删除后该公网域名将立即失效，且不可恢复。`)) return;
  deletingDomains.value.add(t.tunnel_domain);
  try {
    const client = buildClient();
    await client.getBaseInfo();
    const res = await client.deleteArgoTunnel({ port: t.port, tunnel_domain: t.tunnel_domain });
    if (res.status !== 'ok' || res.deleted < 1) {
      throw new Error(res.message || '删除失败');
    }
    await loadTunnels(true);
  } catch (err: any) {
    error.value = err.message || '删除隧道失败';
  } finally {
    deletingDomains.value.delete(t.tunnel_domain);
  }
};

const copyDomain = async (domain: string) => {
  try {
    await navigator.clipboard.writeText(domain);
    copiedDomain.value = domain;
    setTimeout(() => {
      if (copiedDomain.value === domain) copiedDomain.value = '';
    }, 1800);
  } catch {
    copiedDomain.value = '';
  }
};

const formatTime = (iso: string): string => {
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
};

watch(() => props.visible, (v) => {
  if (v) {
    tunnels.value = [];
    error.value = null;
    createError.value = null;
    createSuccess.value = null;
    loadTunnels();
  }
}, { immediate: true });
</script>

<template>
  <Transition name="modal">
    <div v-if="visible" class="argo-overlay" @click.self="emit('close')">
      <div class="argo-modal">
        <div class="argo-header">
          <h3>🌐 内网映射</h3>
          <button class="btn icon" title="关闭" @click="emit('close')">×</button>
        </div>
        <div class="argo-subtitle">
          基于 Cloudflare 快速隧道（/api/argo），将节点内网端口暴露为临时公网域名，随进程退出自动失效
        </div>

        <div class="argo-grid">
          <!-- 创建隧道表单 -->
          <div class="create-panel">
            <div class="create-title">
              <span>➕ 添加隧道</span>
              <button class="btn secondary btn-sm" @click="loadTunnels()" :disabled="loading">
                🔄 刷新列表
              </button>
            </div>
            <div class="create-form">
              <div class="form-field">
                <label for="argo-port">转发端口</label>
                <input
                  id="argo-port"
                  v-model="portInput"
                  type="number"
                  min="1"
                  max="65535"
                  placeholder="留空则使用 Agent 默认监听端口 (默认 8000)"
                />
                <p v-if="!portValid.valid" class="field-error">{{ portValid.msg }}</p>
              </div>
              <div class="form-field">
                <label class="checkbox-label">
                  <input v-model="duplicate" type="checkbox" />
                  允许同一端口重复创建（duplicate: true）
                </label>
                <p class="field-hint">关闭时若端口已有隧道，创建会被拒绝 (409)</p>
              </div>
              <button class="btn primary btn-sm create-btn" @click="handleCreate" :disabled="creating || loading">
                {{ creating ? '⏳ 正在创建...' : '🚀 创建隧道' }}
              </button>
            </div>
            <p v-if="createError" class="create-error">❌ {{ createError }}</p>
            <div v-if="createSuccess" class="create-success">
              ✅ 隧道创建成功：<a :href="createSuccess.tunnel_domain" target="_blank" rel="noopener">{{ createSuccess.tunnel_domain }}</a>
              <span class="port-chip">端口 {{ createSuccess.port }}</span>
              <button class="btn secondary btn-sm" @click="copyDomain(createSuccess.tunnel_domain)">
                {{ copiedDomain === createSuccess.tunnel_domain ? '✅ 已复制' : '📋 复制' }}
              </button>
            </div>
          </div>

          <!-- 隧道列表 -->
          <div class="tunnel-section">
            <div class="tunnel-title">
              <span>📡 当前隧道 ({{ tunnels.length }})</span>
            </div>

            <div v-if="loading" class="argo-status">
              <span class="spinner"></span> 正在查询隧道列表...
            </div>

            <div v-else-if="error" class="argo-error">
              <p>❌ {{ error }}</p>
              <button class="btn primary btn-sm" @click="loadTunnels()">🔄 重试</button>
            </div>

            <div v-else-if="tunnels.length === 0" class="empty-tunnels">
              📭 暂无存活中的隧道，填写上方端口即可创建
            </div>

            <div v-else class="tunnel-list">
              <div v-for="t in tunnels" :key="`${t.tunnel_domain}-${t.port}`" class="tunnel-item">
                <div class="tunnel-info">
                  <a :href="t.tunnel_domain" target="_blank" rel="noopener" class="tunnel-domain" :title="t.tunnel_domain">
                    🔗 {{ t.tunnel_domain }}
                  </a>
                  <div class="tunnel-meta">
                    <span class="port-chip">端口 {{ t.port }}</span>
                    <span class="time-chip">🕒 {{ formatTime(t.created_at) }}</span>
                  </div>
                </div>
                <div class="tunnel-actions">
                  <button class="btn secondary btn-sm" @click="copyDomain(t.tunnel_domain)">
                    {{ copiedDomain === t.tunnel_domain ? '✅ 已复制' : '📋 复制' }}
                  </button>
                  <button
                    class="btn secondary btn-sm delete-tunnel-btn"
                    :disabled="deletingDomains.has(t.tunnel_domain)"
                    title="删除隧道（域名立即失效）"
                    @click="handleDelete(t)"
                  >
                    {{ deletingDomains.has(t.tunnel_domain) ? '⏳' : '🗑️ 删除' }}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.argo-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.3);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 20px;
}
.argo-modal {
  background: var(--card, #ffffff);
  border: 1px solid var(--border, #e2e8f0);
  border-radius: var(--radius, 16px);
  padding: 24px;
  width: 100%;
  max-width: 980px;
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: var(--shadow-lg);
  animation: modalSlideIn 0.2s ease;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.argo-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.argo-header h3 {
  font-size: 1.3rem;
  font-weight: 600;
}
.argo-subtitle {
  font-size: 0.85rem;
  color: var(--muted, #64748b);
}

.argo-grid {
  display: grid;
  grid-template-columns: 340px 1fr;
  gap: 16px;
  align-items: start;
}
@media (max-width: 860px) {
  .argo-grid {
    grid-template-columns: 1fr;
  }
}

.create-panel {
  background: var(--surface-2);
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 12px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.create-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 600;
  font-size: 0.95rem;
}
.create-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.form-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.form-field label {
  font-size: 0.85rem;
  font-weight: 500;
  color: var(--text, #1e293b);
}
.form-field input[type="number"] {
  padding: 10px 12px;
  border-radius: var(--radius-sm, 10px);
  border: 1.5px solid var(--border, #e2e8f0);
  background: var(--btn-bg);
  color: var(--text, #1e293b);
  font-size: 0.95rem;
  width: 100%;
}
.form-field input[type="number"]:focus {
  outline: none;
  border-color: var(--primary, #3b82f6);
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}
.checkbox-label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-weight: 500 !important;
}
.field-hint {
  font-size: 0.78rem;
  color: var(--muted, #64748b);
  margin-left: 22px;
}
.field-error {
  font-size: 0.78rem;
  color: var(--danger, #ef4444);
}
.create-btn {
  align-self: flex-start;
}
.create-error {
  font-size: 0.85rem;
  color: var(--danger, #ef4444);
  background: var(--chip-offline-bg);
  border: 1px solid var(--chip-offline-border);
  padding: 8px 12px;
  border-radius: 8px;
  word-break: break-word;
}
.create-success {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 0.85rem;
  color: var(--chip-online-text);
  background: var(--chip-online-bg);
  border: 1px solid var(--chip-online-border);
  padding: 8px 12px;
  border-radius: 8px;
  word-break: break-all;
}

.tunnel-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.tunnel-title {
  font-weight: 600;
  font-size: 0.95rem;
}
.argo-status {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 16px;
  color: var(--muted, #64748b);
}
.spinner {
  width: 18px;
  height: 18px;
  border: 2px solid var(--border, #e2e8f0);
  border-top-color: var(--primary, #3b82f6);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
.argo-error {
  padding: 16px;
  text-align: center;
  color: var(--danger, #ef4444);
}
.argo-error p {
  margin-bottom: 12px;
  word-break: break-word;
}
.empty-tunnels {
  padding: 24px;
  text-align: center;
  color: var(--muted, #64748b);
  border: 1.5px dashed var(--border, #e2e8f0);
  border-radius: 12px;
  font-size: 0.9rem;
}
.tunnel-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 460px;
  overflow-y: auto;
  padding-right: 4px;
}
.tunnel-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 10px;
  background: var(--btn-bg);
  flex-wrap: wrap;
}
.tunnel-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}
.delete-tunnel-btn:hover:not(:disabled) {
  background: var(--hover-tint-red);
  border-color: var(--chip-offline-border);
  color: var(--danger, #ef4444);
}
.tunnel-info {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  flex: 1;
}
.tunnel-domain {
  font-family: 'SF Mono', 'Menlo', monospace;
  font-size: 0.82rem;
  color: var(--primary, #2563eb);
  word-break: break-all;
  text-decoration: none;
}
.tunnel-domain:hover {
  text-decoration: underline;
}
.tunnel-meta {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.port-chip {
  font-family: monospace;
  font-size: 0.75rem;
  background: var(--surface-3);
  border: 1px solid var(--border, #e2e8f0);
  padding: 2px 8px;
  border-radius: 999px;
  color: var(--text-soft);
}
.time-chip {
  font-size: 0.75rem;
  color: var(--muted, #64748b);
}
</style>
