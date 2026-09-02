<!-- src/components/AiPrompt.vue
  🎫 AI 自动化授权面板：获取临时密钥对 (GET /api/tempkey)，
  结合 Kisama Control Skill 生成完整 Prompt，供 AI 使用密钥连接并管理本服务器
-->
<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { AgentClient, type TempKeyResponse } from '../lib/agent-client';
import { sanitizeKeyInput } from '../lib/key-normalize';
import type { AgentNode } from '../types';

// 🔗 Kisama Control 技能包（从 Kisama_agent 仓库最新 release tag 中获取 kisama-skill.zip）
const KISAMA_REPO = 'liveqte/Kisama_agent';
const KISAMA_SKILL_FILE = 'kisama-skill.zip';
// 🎯 兜底直链（非 HTML 页面，保证 AI 可以直接下载）
const KISAMA_SKILL_FALLBACK = `https://raw.githubusercontent.com/${KISAMA_REPO}/main/${KISAMA_SKILL_FILE}`;

// 获取仓库最新 release 的 tag 名称（无正式 Release 时 fallback 'main'）
async function getLatestTag(repo: string): Promise<string> {
  try {
    const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`);
    const data = await response.json();
    return data.tag_name || 'main';
  } catch (e) {
    return 'main';
  }
}

// 💡 解析最新 tag 下技能包的【真实下载直链】注入提示词（而非 main 分支或 blob HTML 页面）
async function resolveSkillUrl(): Promise<string> {
  try {
    const latestTag = await getLatestTag(KISAMA_REPO);
    // 1. 优先走 GitHub Contents API：返回 download_url，即 raw.githubusercontent.com 直链
    try {
      const fileResp = await fetch(
        `https://api.github.com/repos/${KISAMA_REPO}/contents/${KISAMA_SKILL_FILE}?ref=${latestTag}`
      );
      if (fileResp.ok) {
        const fileData = await fileResp.json();
        if (fileData?.download_url) return fileData.download_url as string;
      }
    } catch (e) {
      // 限流/鉴权失败时继续走直链兜底
    }
    // 2. 直链兜底：同一 tag 下的 raw 下载地址
    return `https://raw.githubusercontent.com/${KISAMA_REPO}/${latestTag}/${KISAMA_SKILL_FILE}`;
  } catch (e) {
    return KISAMA_SKILL_FALLBACK;
  }
}

const props = defineProps<{
  node: AgentNode;
  visible: boolean;
  globalConfig?: { ecdsaPrivateKey?: string; eciesPrivateKey?: string };
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const loading = ref(false);
const error = ref<string | null>(null);
const tempKey = ref<TempKeyResponse | null>(null);
const promptText = ref('');
const copied = ref(false);
const copiedEcdsa = ref(false);
const copiedEcies = ref(false);

// 展示时的密钥（sanitize 后保证显示与“一键复制”均为干净格式）
const ecdsaPem = ref('');
const eciesHex = ref('');

// ✅ 当前生效的技能包下载地址（解析最新 release tag 后注入提示词）
const skillUrl = ref(KISAMA_SKILL_FALLBACK);

// 从直链中提取 tag/分支名（兼容 raw.githubusercontent.com 与 /blob/ 两种形态）
const skillTag = computed(() => {
  const u = skillUrl.value;
  const m = u.match(/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/([^/]+)\//) || u.match(/\/blob\/([^/]+)\//);
  return m ? m[1] : '';
});
const skillIsFallback = computed(() => !skillTag.value || skillTag.value === 'main');

const buildPrompt = (key: TempKeyResponse): string => {
  return `# 🤖 Kisama AI 自动化授权

请先检查是否已获取并加载「Kisama Control」技能包；若本地尚未安装该技能包，再从网上下载：${skillUrl.value}
技能包自含控制端脚本（scripts/kisama_control.py），并完整说明了连接预检、签名认证、请求加密、响应解密、文件传输与超级终端的用法；直接遵循技能包说明执行，即可使用以下临时授权参数连接并管理目标代理，无需再实现任何密码学细节。

## 连接参数（临时授权）
- 节点名称：${props.node.name}
- 代理地址：${props.node.domain}
- 密钥 ID：${key.key_id}
- 有效期：${key.ttl_seconds} 秒（${key.created_at} ~ ${key.expires_at}）
- ECDSA 私钥（P-256 签名密钥，原样写入文件供 --ecdsa-key 使用）：
${ecdsaPem.value}
- ECIES 私钥（secp256k1，64 位 hex，原样写入文件供 --ecies-key 使用）：
${eciesHex.value}

## 操作要求
1. 连接前按技能包先执行 baseinfo 预检；
2. 只读巡检优先；删除、覆盖、移动、权限修改等有副作用操作必须先向用户确认；
3. 全程保护私钥安全，不将私钥明文外泄，异常时立即停止并报告。`;
};

const copyText = async (text: string, flag: { value: boolean }) => {
  try {
    await navigator.clipboard.writeText(text);
    flag.value = true;
    setTimeout(() => (flag.value = false), 1800);
  } catch {
    flag.value = false;
  }
};

const copyPrompt = () => copyText(promptText.value, copied);
const copyEcdsaKey = () => copyText(ecdsaPem.value, copiedEcdsa);
const copyEciesKey = () => copyText(eciesHex.value, copiedEcies);

// 💡 请求序列号：防止快速开关/切换不同节点时，上一次慢请求的结果覆盖最新一次的结果
let loadSeq = 0;

const load = async () => {
  const seq = ++loadSeq;
  loading.value = true;
  error.value = null;
  copied.value = false;
  try {
    const ecdsaKey = props.node.ecdsaPrivateKey || props.globalConfig?.ecdsaPrivateKey || '';
    const eciesKey = props.node.eciesPrivateKey || props.globalConfig?.eciesPrivateKey || '';
    if (!ecdsaKey || !eciesKey) {
      throw new Error('该节点缺少 ECDSA/ECIES 控制端密钥配置，无法通过认证获取临时密钥');
    }
    const client = new AgentClient({
      domain: props.node.domain,
      eciesPrivateKey: eciesKey,
      ecdsaPrivateKey: ecdsaKey,
      timeout: 15000,
    });
    // 🌐 必须先建立会话握手：调用 /api/baseinfo 获取 session_key 并完成会话认证，
    // 否则后续 /api/tempkey 会因服务器尚未建立会话而失败（表现为窗口轮询不到临时密钥）
    await client.getBaseInfo();
    const key = await client.getTempKey(24);
    if (seq !== loadSeq) return; // 已有更新的请求，丢弃本次过期结果
    tempKey.value = key;
    // 🔒 密钥净化：展示与一键复制均为无多余换行符的干净格式
    ecdsaPem.value = sanitizeKeyInput(key.ecdsa.private_key, 'ecdsa');
    eciesHex.value = sanitizeKeyInput(key.ecies.private_key, 'ecies');
    // 🌐 解析最新 release tag 下的技能包地址（失败则 fallback 到 main 分支）
    skillUrl.value = await resolveSkillUrl();
    if (seq !== loadSeq) return; // 再次校验，防止 resolveSkillUrl 期间被覆盖
    promptText.value = buildPrompt(key);
  } catch (err: any) {
    // 仅当本次请求仍是最新时，才展示错误（过期的失败不应打断最新窗口状态）
    if (seq === loadSeq) error.value = err.message || '获取临时密钥失败';
  } finally {
    if (seq === loadSeq) loading.value = false;
  }
};

const refresh = () => load();

// 💡 必须带 immediate：本组件是异步懒加载（defineAsyncComponent），
// 冷挂载时 visible 可能已经是 true，不含 immediate 的 watch 永远不会触发，导致窗口空白不加载
watch(() => props.visible, (v) => {
  if (v) load();
}, { immediate: true });
</script>

<template>
  <Transition name="modal">
    <div v-if="visible" class="ai-overlay" @click.self="emit('close')">
      <div class="ai-modal">
        <div class="ai-header">
          <h3>🤖 AI 自动化授权</h3>
          <button class="btn icon" title="关闭" @click="emit('close')">×</button>
        </div>
        <div class="ai-subtitle">
          为 AI 获取临时密钥（ECDSA + ECIES）并生成连接控制 Prompt，有效期默认 24 小时
        </div>

        <div v-if="loading" class="ai-status">
          <span class="spinner"></span> 正在获取临时密钥对...
        </div>

        <div v-else-if="error" class="ai-error">
          <p>❌ {{ error }}</p>
          <button class="btn primary btn-sm" @click="refresh">🔄 重试</button>
        </div>

        <div v-else-if="tempKey" class="ai-body">
          <div class="key-summary">
            <span class="key-chip" title="密钥 ID">🆔 {{ tempKey.key_id }}</span>
            <span class="key-chip" title="有效期（秒）">⏳ {{ tempKey.ttl_seconds }}s</span>
            <span class="key-chip" title="到期时间">🔒 {{ tempKey.expires_at }}</span>
            <span class="key-chip skill-chip" :title="skillUrl">🎯 {{ skillIsFallback ? 'main' : skillTag }}</span>
          </div>

          <div class="ai-actions">
            <span class="ai-result-status">✅ 临时密钥已就绪，AI 可直接沿用下方 Prompt</span>
            <button class="btn primary btn-sm" @click="refresh">🔄 重新获取</button>
          </div>

          <textarea
            class="prompt-box"
            :value="promptText"
            readonly
            spellcheck="false"
          ></textarea>

          <div class="key-copy-row">
            <button class="btn secondary btn-sm" @click="copyEcdsaKey">
              {{ copiedEcdsa ? '✅ ECDSA 私钥已复制' : '🔑 复制 ECDSA 私钥' }}
            </button>
            <button class="btn secondary btn-sm" @click="copyEciesKey">
              {{ copiedEcies ? '✅ ECIES 私钥已复制' : '🔐 复制 ECIES 私钥' }}
            </button>
          </div>

          <div class="modal-footer">
            <button class="btn primary" @click="copyPrompt">
              {{ copied ? '✅ 已复制' : '📋 复制完整 Prompt' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.ai-overlay {
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
.ai-modal {
  background: var(--card, #ffffff);
  border: 1px solid var(--border, #e2e8f0);
  border-radius: var(--radius, 16px);
  padding: 24px;
  width: 100%;
  max-width: 720px;
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: var(--shadow-lg);
  animation: modalSlideIn 0.2s ease;
}
.ai-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}
.ai-header h3 {
  font-size: 1.3rem;
  font-weight: 600;
}
.ai-subtitle {
  font-size: 0.85rem;
  color: var(--muted, #64748b);
  margin-bottom: 16px;
}
.ai-status {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 24px;
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
.ai-error {
  padding: 20px;
  text-align: center;
  color: var(--danger, #ef4444);
}
.ai-error p {
  margin-bottom: 14px;
  word-break: break-word;
}
.ai-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.key-summary {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.key-chip {
  font-family: monospace;
  font-size: 0.75rem;
  background: var(--surface-3);
  border: 1px solid var(--border, #e2e8f0);
  padding: 3px 8px;
  border-radius: 999px;
  color: var(--text-soft);
  user-select: text;
}
.skill-chip {
  font-family: inherit;
  background: rgba(37, 99, 235, 0.08);
  border: 1px dashed rgba(37, 99, 235, 0.4);
  color: var(--primary, #2563eb);
  cursor: help;
}
.ai-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.ai-result-status {
  font-size: 0.85rem;
  color: var(--chip-online-text);
  background: var(--chip-online-bg);
  border: 1px solid var(--chip-online-border);
  padding: 6px 12px;
  border-radius: 8px;
}
.prompt-box {
  width: 100%;
  min-height: 320px;
  padding: 14px;
  border-radius: var(--radius-sm, 10px);
  border: 1.5px solid var(--border, #e2e8f0);
  background: var(--surface-2);
  color: var(--text, #1e293b);
  font-family: 'SF Mono', 'Menlo', monospace;
  font-size: 0.82rem;
  line-height: 1.6;
  resize: vertical;
}
.key-copy-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding-top: 16px;
  border-top: 1px solid var(--border, #e2e8f0);
}
</style>