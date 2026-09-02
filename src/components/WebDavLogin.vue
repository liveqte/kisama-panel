<script setup lang="ts">
import { ref, watch } from 'vue';
import { WebDavClient, loadWebDavConfig, saveWebDavConfig, clearWebDavConfig } from '../lib/webdav';

const props = defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void;
  (e: 'toast', payload: { message: string; type: 'success' | 'error' | 'info' }): void;
  (e: 'changed'): void;
  (e: 'logged-in'): void;
}>();

const form = ref({ serverUrl: '', username: '', password: '', basePath: '', proxyDomain: '' });
const showPassword = ref(false);
const testing = ref(false);
const loggedIn = ref(false);
// 高级设置折叠态：中转域名（CORS 解除）
const showAdvanced = ref(false);
// 与「⚙️ 设置 → 全局网络中转配置」联动的候选域名列表
const proxyPresets = ref<string[]>([]);
// 已登录横幅展示的地址：只在「登录通过校验」那一刻更新，
// 不与表单输入框实时联动，避免编辑未保存的地址误导登录状态显示
const loggedInServer = ref('');
// 最近一次「测试连接」成功的时间戳；0 表示尚无有效结果。
// 登录时可复用该结果免二次校验，任一参数被改动后立即失效，重新走真实校验
const testPassedAt = ref(0);

// 每次打开弹窗时回填已保存的配置，并刷新登录态
watch(() => props.visible, (val) => {
  if (!val) return;
  const saved = loadWebDavConfig();
  form.value = {
    serverUrl: saved?.serverUrl ?? '',
    username: saved?.username ?? '',
    password: saved?.password ?? '',
    basePath: saved?.basePath ?? '',
    proxyDomain: saved?.proxyDomain ?? '',
  };
  loggedIn.value = !!saved;
  loggedInServer.value = saved?.serverUrl ?? '';
  showAdvanced.value = !!saved?.proxyDomain;
  testPassedAt.value = 0;

  // 读取「设置 → 全局网络中转配置」维护的中转域名池，供下拉联想选择
  try {
    const raw = localStorage.getItem('kisama_proxy_config');
    const parsed = raw ? JSON.parse(raw) : null;
    proxyPresets.value = Array.isArray(parsed?.domains) ? parsed.domains : [];
  } catch {
    proxyPresets.value = [];
  }
});

const buildClient = (): WebDavClient =>
  new WebDavClient({
    serverUrl: form.value.serverUrl.trim(),
    username: form.value.username.trim(),
    password: form.value.password,
    basePath: form.value.basePath.trim(),
    proxyDomain: form.value.proxyDomain.trim(), // 🔁 测试连接必须与登录后的真实链路一致（含 CORS 中转）
  });

const validate = (): string => {
  const url = form.value.serverUrl.trim();
  if (!url) return '请填写服务器地址';
  if (!/^https?:\/\//i.test(url)) return '服务器地址必须以 http(s):// 开头';
  return '';
};

// 任一参数被编辑后立即失效测试缓存，确保登录校验永远针对当前表单内容
watch(form, () => { testPassedAt.value = 0; }, { deep: true });

/** 用当前表单参数真实探测一次远端（不落盘） */
const handleTest = async () => {
  const err = validate();
  if (err) {
    emit('toast', { message: `❌ ${err}`, type: 'error' });
    return;
  }
  testing.value = true;
  try {
    await buildClient().testConnection();
    testPassedAt.value = Date.now();
    emit('toast', { message: '✓ 连接成功，WebDAV 服务可达', type: 'success' });
  } catch (e: any) {
    emit('toast', { message: `连接失败: ${e.message || e}`, type: 'error' });
  } finally {
    testing.value = false;
  }
};

/** 登录 = 先真实校验连接，校验通过才允许保存；随后交由父组件执行首次云端配置同步 */
const handleLogin = async () => {
  const err = validate();
  if (err) {
    emit('toast', { message: `❌ ${err}`, type: 'error' });
    return;
  }
  // 💡 刚点过「测试连接」且参数未再改动 → 复用结果，免二次校验；
  //    否则（含测试失败/未测过/参数有改动）登录前必须真实校验一次
  if (testPassedAt.value === 0) {
    testing.value = true;
    try {
      await buildClient().testConnection();
      testPassedAt.value = Date.now();
    } catch (e: any) {
      emit('toast', { message: `连接校验失败，已阻止保存: ${e.message || e}`, type: 'error' });
      return;
    } finally {
      testing.value = false;
    }
  } else {
    emit('toast', { message: '⚡ 参数未变，已复用刚才的连接测试结果', type: 'info' });
  }
  saveWebDavConfig({
    serverUrl: form.value.serverUrl.trim(),
    username: form.value.username.trim(),
    password: form.value.password,
    basePath: form.value.basePath.trim(),
    proxyDomain: form.value.proxyDomain.trim(),
  });
  loggedIn.value = true;
  loggedInServer.value = form.value.serverUrl.trim();
  emit('changed');
  emit('toast', { message: '🎉 登录成功，正在执行首次云端配置同步...', type: 'success' });
  emit('logged-in');
  emit('update:visible', false);
};

const handleLogout = () => {
  clearWebDavConfig();
  loggedIn.value = false;
  emit('changed');
  emit('toast', { message: '已退出登录并清除本地保存的 WebDAV 配置', type: 'info' });
};
</script>

<template>
  <Transition name="modal">
    <div v-if="visible" class="modal-overlay" @click.self="emit('update:visible', false)">
      <div class="modal-content" style="max-width: 680px;">
        <div class="modal-header">
          <h3>{{ loggedIn ? '☁️ 云同步账号' : '🔑 登录 WebDAV' }}</h3>
          <button class="btn icon" @click="emit('update:visible', false)">×</button>
        </div>

        <div class="quick-actions" v-if="loggedIn">
          <span>✅ 已登录：{{ loggedInServer }}</span>
          <button class="btn secondary btn-sm" @click="handleLogout">退出登录</button>
        </div>

        <p class="hint">用于配置文件的云端备份与同步。账号与密码仅保存在本机浏览器中，不会上传到任何第三方。</p>

        <div class="grid-form">
          <!-- 第一行：服务器地址 + 远端目录 -->
          <div class="form-row">
            <div class="form-group">
              <label>服务器地址</label>
              <input v-model="form.serverUrl" placeholder="https://dav.example.com/dav/" />
            </div>
            <div class="form-group">
              <label>远端目录（可选）</label>
              <input v-model="form.basePath" placeholder="/kisama/configs" />
            </div>
          </div>

          <!-- 第二行：账号 + 密码 -->
          <div class="form-row">
            <div class="form-group">
              <label>账号</label>
              <input v-model="form.username" placeholder="user@example.com" autocomplete="username" />
            </div>
            <div class="form-group">
              <label>密码 / 应用密码</label>
              <div class="input-wrap">
                <input
                  v-model="form.password"
                  :type="showPassword ? 'text' : 'password'"
                  placeholder="部分网盘需使用应用密码"
                  autocomplete="current-password"
                />
                <a class="pw-toggle" @click.prevent="showPassword = !showPassword">{{ showPassword ? '🙈 隐藏' : '👁 显示' }}</a>
              </div>
            </div>
          </div>
        </div>

        <!-- 高级设置：CORS 中转域名 -->
        <div class="toggle-link" @click="showAdvanced = !showAdvanced">
          {{ showAdvanced ? '▼ 收起高级设置' : '▶ 高级设置（CORS 中转）' }}
        </div>
        <div v-if="showAdvanced" class="advanced-panel animate-fade">
          <div class="form-group" style="margin-bottom: 0;">
            <label>中转域名（可选，留空直连）</label>
            <input
              v-model="form.proxyDomain"
              list="webdav-proxy-presets"
              placeholder="例如 https://relay.example.com"
            />
            <datalist id="webdav-proxy-presets">
              <option v-for="d in proxyPresets" :key="d" :value="d" />
            </datalist>
            <p class="forward-preview">
              转发格式：{{ form.proxyDomain.trim() || 'https://<中转域名>' }}/kisamaproxy/{{ form.serverUrl.trim() || 'https://<WebDAV地址>' }}
            </p>
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn secondary" @click="handleTest" :disabled="testing">
            {{ testing ? '⏳ 测试中...' : '🔌 测试连接' }}
          </button>
          <button class="btn primary" @click="handleLogin" :disabled="testing">
            {{ testing ? '⏳ 校验中...' : '🔑 登录' }}
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
/* 双列行布局：同一行的表单项平分宽度 */
.form-row {
  display: flex;
  gap: 14px;
}
.form-row .form-group {
  flex: 1;
  min-width: 0;
}

/* 密码框内嵌显示/隐藏切换，避免占用独立一行导致与账号栏错位 */
.input-wrap {
  position: relative;
}
.input-wrap input {
  padding-right: 64px;
}
.pw-toggle {
  position: absolute;
  right: 12px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 0.75rem;
  color: var(--primary);
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
}
.pw-toggle:hover {
  opacity: 0.8;
}

/* 高级设置折叠面板 */
.advanced-panel {
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-sm);
  padding: 14px;
  margin-top: 4px;
}
.forward-preview {
  font-size: 0.75rem;
  color: var(--muted);
  margin-top: 8px;
  margin-bottom: 0;
  word-break: break-all;
  font-family: 'SF Mono', 'Menlo', monospace;
}

@media (max-width: 560px) {
  /* 窄屏回落为单列，避免挤压 */
  .form-row {
    flex-direction: column;
    gap: 0;
  }
}
</style>
