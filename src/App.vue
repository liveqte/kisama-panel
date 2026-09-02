<script setup lang="ts">
//动态导入依赖
import { defineAsyncComponent } from 'vue';
import { ref , watch, onMounted, onUnmounted, provide } from 'vue';
import { useNodes } from './composables/useNodes';
// 1. 引入守护进程
import { taskDaemon } from './lib/task-daemon';
import type { AgentNode,NodeFormData} from './types'
import NodeForm from './components/NodeForm.vue';
import NodeList from './components/NodeList.vue';
import NodePreview from './components/NodePreview.vue';
import { hoveredNode } from './composables/usePreview';
import Setting from './components/Setting.vue';
import NodeFilterSort from './components/NodeFilterSort.vue';
//---------------------更新相关----------------------------------------
// 💡 ✨ 1. 引入刚才编写好的全自动热升级高可用核心库
import { checkAgentVersion, executeAgentUpdate } from './lib/update';
import { AgentClient } from './lib/agent-client';
import { sanitizeKeyInput } from './lib/key-normalize';
import UpdateModal from './components/UpdateModal.vue'; // 💡 引入新组件
import { loadWebDavConfig } from './lib/webdav'; // ☁️ WebDAV 登录态读取
import { webdavLinkStatus, webdavLinkMessage, reportWebDavLink } from './lib/webdav-status'; // ☁️ 云端链路健康状态
import { buildFullBackupBundle, applyFullBackupBundle, runConfigSync } from './lib/configsync'; // ☁️ 配置云同步引擎
import { injectCustomStyle, injectCustomScript } from './lib/runtime-inject'; // 🎨 自定义样式/脚本注入器
import { version as panelVersion } from '../package.json'; // 🏷️ 面板版本号（与 package.json 保持同步）

// 💡 ✨【接入全新全局组合式通知中心】
import { useToast } from './composables/useToast';
const { toastState, showToast } = useToast();

// 🔒 刚性对齐修改点：向下游依赖组件（如 Setting、FileManager）全面派发新版全局统一的 showToast 句柄
provide('showToast', showToast);

// 💡 ✨ 2. 新增：记录当前正在执行后台更新的节点 ID 集合（用于防止用户高频连击）
const updatingNodeIds = ref<Set<string>>(new Set());
provide('updatingNodeIds', updatingNodeIds);
const showUpdateModal = ref(false);                   // 💡 控制升级确认弹窗的显隐
const targetUpdateNode = ref<AgentNode | null>(null);
// 💡 ✨ 3. 新增：全自动后台热升级异步流控函数
// 💡 ✨ 第 1 步：用户在表格中点击 ⬆️ 时触发的入口
const handleUpdateAgent = async (nodeId: string) => {
  const node = nodes.value.find(n => n.id === nodeId);
  if (!node) return;

  if (updatingNodeIds.value.has(nodeId)) {
    showToast(`⏳ 节点 [${node.name}] 正在执行后台热升级，请勿重复触发`, 'info');
    return;
  }

  // 🎯 斩断原先恶心的 confirm 阻塞，直接将节点送入精细化弹窗上下文并开灯显现
  targetUpdateNode.value = node;
  showUpdateModal.value = true;
};

// 💡 ✨ 第 2 步：用户在高级弹窗里看完原理风险、选完文件，点击“锁定目标并启动升级”后真正执行的异步流
// src/App.vue
const handleExecuteUpdatePayload = async (payload: { agentType: string; primaryFile: string; secondaryFile?: string }) => {
  if (!targetUpdateNode.value) return;
  const node = targetUpdateNode.value;
  const nodeId = node.id;

  updatingNodeIds.value.add(nodeId);
  showToast(`🔄 开始建立与 [${node.name}] 的专属分发管道...`, 'info');

  try {
    const ecdsaKey = node.ecdsaPrivateKey || globalConfig.value.ecdsaPrivateKey || '';
    const eciesKey = node.eciesPrivateKey || globalConfig.value.eciesPrivateKey || '';
    const client = new AgentClient({
      domain: node.domain,
      eciesPrivateKey: eciesKey,
      ecdsaPrivateKey: ecdsaKey,
      timeout: 60000,
      Encryption: true
    });

    // 💡 ✨【同步对齐修改点】：把 payload（含用户精选的子目录路径）原封不动投送给执行器
    await executeAgentUpdate(client, globalConfig.value, payload, (status, progressPayload) => {
      if (progressPayload) {
        showToast(`⏳ [${node.name}]: ${status} (${progressPayload.progress}%)`, 'info');
      } else {
        showToast(`⏳ [${node.name}]: ${status}`, 'info');
      }
    });

    showToast(`🎉 成功：[${node.name}] 代理端架构热更新对齐全线成功！`, 'success');
    if (typeof syncAllNodes === 'function') syncAllNodes();

  } catch (err: any) {
    showToast(`❌ [${node.name}] 在线热升级失败: ${err.message || err}`, 'error');
  } finally {
    updatingNodeIds.value.delete(nodeId);
    targetUpdateNode.value = null;
  }
};
//---------------------更新相关----------------------------------------
const Terminal = defineAsyncComponent(() => import('./components/Terminal.vue'));
const FileManager = defineAsyncComponent(() => import('./components/FileManager.vue'));
const TaskManager = defineAsyncComponent(() => import('./components/TaskManager.vue'));
const AiPrompt = defineAsyncComponent(() => import('./components/AiPrompt.vue'));
const ArgoTunnel = defineAsyncComponent(() => import('./components/ArgoTunnel.vue'));
const AgentDownload = defineAsyncComponent(() => import('./components/AgentDownload.vue'));
const Terminal2 = defineAsyncComponent(() => import('./components/Terminal2.vue'));
const WebDavLogin = defineAsyncComponent(() => import('./components/WebDavLogin.vue')); // ☁️ 云同步登录弹窗

const terminalWsUrl = ref('');

const { 
  nodes, loading, error, onlineCount,
  addNode, updateNode, syncAllNodes,
  exportConfig, importConfig ,
  globalConfig, saveGlobalConfig
} = useNodes();



const showForm = ref(false);
const showGlobalSettings = ref(false);
const showAgentDownload = ref(false);

// ☁️ WebDAV 云同步登录入口状态
const showWebDavLogin = ref(false);
// 登录态用 ref 而非直接 computed，保证弹窗内保存/退出后按钮文字即时切换
const webDavLoggedIn = ref(false);
const refreshWebDavLoginState = () => {
  webDavLoggedIn.value = !!loadWebDavConfig();
  // 退出登录时同步清空链路状态，避免残留上一次会话的失联提示
  if (!webDavLoggedIn.value) reportWebDavLink('unknown');
};

/**
 * ☁️ 登录成功后的首次云端同步：直接委托给 configsync 引擎，
 * 由引擎自动识别三种局面（远端缺失推送 / 本地缺失拉取 / 双方分域合并）
 */
const handleInitialCloudSync = async () => {
  await runConfigSync({ notify: (message, type) => showToast(message, type ?? 'info') });
};

// 🌓 主题模式：默认跟随系统，可手动切换并持久化
const THEME_KEY = 'kisama_theme';
const isDarkTheme = ref(false);
const applyTheme = (dark: boolean) => {
  isDarkTheme.value = dark;
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light');
};
const toggleTheme = () => applyTheme(!isDarkTheme.value);
const initTheme = () => {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === 'dark' || saved === 'light') {
    applyTheme(saved === 'dark');
  } else {
    applyTheme(window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false);
  }
};

// 用于页面底部显示的临时错误信息
const toastMsg = ref('');

// 🎨 自定义样式/脚本注入器已平移至 src/lib/runtime-inject.ts，供设置保存、导入恢复、云同步应用三处共用
// 保存全局设置
const handleSaveGlobalSettings = (payload: { config: any; customStyle: string; customScript: string }) => {
  // 1. 保存密钥到 useNodes 模块中
  saveGlobalConfig(payload.config);
  
  // 2. 持久化自定义 CSS 样式并即时热应用
  localStorage.setItem('kisama_custom_style', payload.customStyle);
  injectCustomStyle(payload.customStyle);
  
  // 3. ✨【必须要加的】持久化自定义 JS/HTML 脚本
  localStorage.setItem('kisama_custom_script', payload.customScript);
  
  // 如果你在 App.vue 里写了 injectCustomScript 运行器，记得在这里调用它
  if (typeof injectCustomScript === 'function') {
    injectCustomScript(payload.customScript);
  }
  
  showToast('设置与美化代码已保存生效', 'success');
};

const editNode = ref<NodeFormData | null>(null);

// ⚡ 【重命名落地】：将 App.vue 原有局部的基础 Toast 升级改名为独立 notification 变量
const notification = ref<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

// ⚡ 【重命名落地】：原有本地方网 showToast 改名为 showNotification，用于触发特定的独立右下角通知
const showNotification = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
  notification.value = { message, type };
  setTimeout(() => notification.value = null, 3000);
};
provide('showNotification', showNotification);

// 子组件通过 @toast 回调时，直接顺畅投递给全新全局 showToast
const handleToast = (payload: { message: string; type: 'success' | 'error' | 'info' }) => {
  showToast(payload.message, payload.type); 
};

// 🔥 修复 2️⃣：添加参数 + 传递给 addNode
const handleAddSubmit = async (data: NodeFormData) => {
  showForm.value = false;
  try {
    const cleanDomain = data.domain.trim().replace(/\/+$/, '');
    await addNode(
      data.name,
      cleanDomain,
      sanitizeKeyInput(data.eciesPrivateKey, 'ecies'),
      sanitizeKeyInput(data.ecdsaPrivateKey, 'ecdsa'),
      data.incognitoMode
    );
    showToast('节点添加成功', 'success');
  } catch (err: any) {
    showToast(err.message || '添加失败', 'error');
  }
};

// 🔥 修复 4️⃣：赋值时包含 ecdsaPrivateKey
const handleEdit = (id: string) => {
  const node = nodes.value.find(n => n.id === id);
  if (node) {
    // ✅ 极致灵活：把 node 里的所有属性摊开，通过 as 告诉 TS 把它当成 NodeFormData 对对待
    editNode.value = { ...node } as NodeFormData;
    showForm.value = true;
  }
};

// src/App.vue 内部修改
const handleEditSubmit = async (data: NodeFormData) => {
  if (!editNode.value || !editNode.value.id) return;
  try {
    const cleanDomain = data.domain.trim().replace(/\/+$/, '');
    const originalDomain = editNode.value.domain?.trim().replace(/\/+$/, '') || '';
    
    // 💡 智能查核：对比清洗后的新旧域名是否发生改变
    const isDomainChanged = cleanDomain !== originalDomain;

updateNode(editNode.value.id, {
      ...data,
      domain: cleanDomain,
      // 允许空字符串，仅当为 null/undefined 时才回退；并净化多余的换行符，防止破坏密钥格式
      eciesPrivateKey: sanitizeKeyInput(data.eciesPrivateKey ?? '', 'ecies'),
      ecdsaPrivateKey: sanitizeKeyInput(data.ecdsaPrivateKey ?? '', 'ecdsa'),
      
      // 🎯 核心变更：若域名发生改变则刚性重置创建时间为当前时刻，使其视作新节点排序或管理
      ...(isDomainChanged ? { createdAt: Date.now() } : {})
    });
    
    showToast('节点已更新', 'success');
    showForm.value = false;
    editNode.value = null;
  } catch (err: any) {
    showToast(err.message || '更新失败', 'error');
  }
};

// ---- ☁️ 全量备份包构建 / 应用已平移至 src/lib/configsync.ts ----
// （导出、导入、云端首次同步三方共用同一数据结构，见 configsync.ts 顶部注解）

const handleExport = () => {
  const data = JSON.stringify(buildFullBackupBundle(), null, 2); // 格式化缩进，方便肉眼排查
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  // 改名明确提示这是全量配置备份
  a.download = `kisama-panel-full-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('🎉 控制面板全量配置(含通用设置、样式与脚本)已导出', 'success');
};
const handleImport = (e: Event) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const rawText = reader.result as string;
      const json = JSON.parse(rawText);
      
      // 💡 ✨【智能路由识别】：判断是新版的“全量备份复合包”，还是旧版的“纯节点资产包”
      if (json && json.dataType === "kisama_full_backup" && json.globalSettings) {
        // 🟢 场景 A：全量导入与即时热加载
        applyFullBackupBundle(json);

        showToast(`✓ 全量恢复成功: 资产包已还原，美化与注入脚本已实时热应用！`, 'success');
        
        // ⚡ 强约束提示：由于 Setting 设置弹窗打开时会读取 LocalStorage 状态，
        // 提示用户刷新可以确保 Setting 面板里的开关完全对齐刚导入的最新的状态数据。
        setTimeout(() => {
          if (confirm('控制面板全量配置已导入成功，建议刷新页面以彻底刷新表单状态，是否立即刷新？')) {
            window.location.reload();
          }
        }, 800);

      } else {
        // 🟡 场景 B：完美向下兼容老版本的纯节点名单 JSON
        const result = importConfig(rawText);
        showToast(`✓ 资产导入成功: ${result.success} 新增, ${result.skipped} 更新`, 'success');
      }
    } catch (err: any) {
      showToast(err.message || '导入失败，请检查文件格式是否损坏', 'error');
    }
  };
  reader.readAsText(file);
  (e.target as HTMLInputElement).value = '';
};
const handleSyncAll = async () => {
  try {
    const result = await syncAllNodes();
    showToast(`同步完成: ${result.success}/${result.total} 成功`, 'success');
  } catch {
    showToast('部分节点同步失败', 'error');
  }
};
//-----终端功能
const showTerminal = ref(false);
const selectedTerminalNode = ref<AgentNode | null>(null);
// 🔹 新增：全能终端状态
const showTerminal2 = ref(false);
const selectedTerminal2Node = ref<AgentNode | null>(null);

function openTerminal(nodeId: string) {
  const node = nodes.value.find(n => n.id === nodeId);
  if (node) {
    selectedTerminalNode.value = node;
    showTerminal.value = true;
  }
}
function openTerminal2(nodeId: string) {
  const node = nodes.value.find(n => n.id === nodeId);
  if (node) {
    selectedTerminal2Node.value = { ...node };
    terminalWsUrl.value = getTerminalWsUrl(node);
    showTerminal2.value = true;
    showToast(`🚀 打开全能终端: ${node.name}`, 'info');
  }
}
// 状态定义
const showFileManager = ref(false)                        // ✅ 新增
const selectedFileNode = ref<AgentNode | null>(null)      // ✅ 新增

// 打开文件管理器的方法
function openFileManager(nodeId: string) {
  const node = nodes.value.find(n => n.id === nodeId)
  if (node) {
    selectedFileNode.value = node
    showFileManager.value = true
  }
}
const showTaskManager = ref(false)
const selectedTaskNode = ref<AgentNode | null>(null)

function openTaskManager(nodeId: string) {
  const node = nodes.value.find(n => n.id === nodeId)
  if (node) {
    selectedTaskNode.value = node
    showTaskManager.value = true
  }
}
const showAiPrompt = ref(false)
const selectedAiNode = ref<AgentNode | null>(null)

function openAiPrompt(nodeId: string) {
  const node = nodes.value.find(n => n.id === nodeId)
  if (node) {
    selectedAiNode.value = node
    showAiPrompt.value = true
  }
}
// 🌐 内网映射（Argo 临时隧道）
const showArgoTunnel = ref(false)
const selectedArgoNode = ref<AgentNode | null>(null)

function openArgoTunnel(nodeId: string) {
  const node = nodes.value.find(n => n.id === nodeId)
  if (node) {
    selectedArgoNode.value = node
    showArgoTunnel.value = true
  }
}
//任务守护
onMounted(() => {
  initTheme();
  taskDaemon.start();
  refreshWebDavLoginState();
  
  // 应用初始化时，自动读取本地历史样式代码并注入 DOM
  const savedStyle = localStorage.getItem('kisama_custom_style');
  if (savedStyle) {
    injectCustomStyle(savedStyle);
  }
  const savedScript = localStorage.getItem('kisama_custom_script');
  if (savedScript) injectCustomScript(savedScript);
});

onUnmounted(() => {
  // 可选：应用卸载时停止（单页面应用通常不需要，但写上更严谨）
  taskDaemon.stop();
});
// 生成随机 8 位字母数字字符串
const generateRandomPath = () => Math.random().toString(36).substring(2, 10);

// 版本号比较逻辑 (判断 v1 是否大于 v2)
const isVersionGreater = (v1: string, v2: string) => {
  // 处理格式如 "0.0.6-python"，只取前面的数字部分
  const cleanV1 = v1.split('-')[0].split('.').map(Number);
  const cleanV2 = v2.split('-')[0].split('.').map(Number);
  
  for (let i = 0; i < 3; i++) {
    const a = cleanV1[i] || 0;
    const b = cleanV2[i] || 0;
    
    if (a > b) return true; 
    if (a < b) return false;
    
  }
  return true; 
};

// 获取最终的 WebSocket URL
const getTerminalWsUrl = (node: AgentNode) => {
  let isProxyEnabled = false;
  let shouldProxyAll = false;
  let chosenProxy = '';
  try {
    const proxyRaw = localStorage.getItem('kisama_proxy_config');
    if (proxyRaw) {
      const parsed = JSON.parse(proxyRaw);
      const targetPool = Array.isArray(parsed.healthyDomains) ? parsed.healthyDomains : parsed.domains;

      if (parsed.enabled && Array.isArray(targetPool) && targetPool.length > 0) {
        isProxyEnabled = true;
        shouldProxyAll = !!parsed.allSites;
        // 🔥 自己不能中转自己：剔除与被访问节点自身同域名的中转站，找不到其它中转站则保持直连
        const nodeHost = node.domain.replace(/^https?:\/\//i, '').split('/')[0].split('?')[0].toLowerCase();
        const usablePool = targetPool.filter((d: string) =>
          d.replace(/^https?:\/\//i, '').split('/')[0].split('?')[0].toLowerCase() !== nodeHost
        );
        if (usablePool.length > 0) {
          chosenProxy = usablePool[Math.floor(Math.random() * usablePool.length)];
        }
      }
    }
  } catch (e) {
    console.error('[Proxy Terminal] 提取全局中转配置失败:', e);
  }

  const nodeProtocol = node.domain.startsWith('https') ? 'https' : 'http';
  const wsProtocol = node.domain.startsWith('https') ? 'wss' : 'ws';
  const host = node.domain.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  
  const version = node.baseinfo?.version || '0.0.0';
  const useRandomPath = isVersionGreater(version, '0.0.9');
  const path = useRandomPath ? generateRandomPath() : 'terminal';

  const isNodeHttps = node.domain.toLowerCase().startsWith('https://');
  // 🔥 即使配置了「中转全部站点（含 HTTPS）」，只要候选池只剩被访问节点自身（chosenProxy 为空），
  //    也强制回退为直连，绝不触发无意义的“自中转”
  const finalShouldProxy = isProxyEnabled && !!chosenProxy && (shouldProxyAll || !isNodeHttps);

  if (finalShouldProxy) {
    const proxyHost = chosenProxy.replace(/^https?:\/\//, '').replace(/\/+$/, '');
    const proxyWsProtocol = chosenProxy.startsWith('https') ? 'wss' : 'ws';
    return `${proxyWsProtocol}://${proxyHost}/kisamaproxy/${nodeProtocol}://${host}/api/ws/${path}`;
  }

  return `${wsProtocol}://${host}/api/ws/${path}`;
};
</script>

<template>
  <div class="app">
    <header class="header">
      <h1>
        <img src="/favicon.svg" alt="Kisama Logo" width="32" height="32" />
        Kisama
        <span class="version-chip" :title="`面板版本 v${panelVersion}`">v{{ panelVersion }}</span>
      </h1>
      <div class="header-actions">
        <div class="action-group">
          <span class="status-badge">
            在线: {{ onlineCount }} / {{ nodes.length }}
          </span>
        </div>

        <div class="action-group">
          <button class="btn secondary" :title="isDarkTheme ? '切换到浅色模式' : '切换到暗色模式'" @click="toggleTheme">
            {{ isDarkTheme ? '☀️' : '🌙' }}
          </button>
          <button
            class="btn secondary"
            :class="webDavLoggedIn ? (webdavLinkStatus === 'error' ? 'webdav-link-error' : 'webdav-logged-in') : ''"
            :title="!webDavLoggedIn
              ? '登录 WebDAV 以启用配置云同步'
              : webdavLinkStatus === 'error'
                ? `云端失联：${webdavLinkMessage || '最近一轮自动同步失败'}（点击管理账号）`
                : webdavLinkStatus === 'ok'
                  ? '云同步已登录且链路正常（点击管理账号）'
                  : '已登录，等待首轮自动同步探测链路（点击管理账号）'"
            @click="showWebDavLogin = true"
          >
            {{ !webDavLoggedIn ? '🔑 登录' : webdavLinkStatus === 'error' ? '⚠️ 已登录·失联' : '☁️ 已登录' }}
          </button>
          <button class="btn secondary" @click="showGlobalSettings = true">⚙️ 设置</button>
          <button class="btn secondary" @click="showAgentDownload = true">⬇️ 探针下载</button>
          <button class="btn secondary" @click="handleExport">📤 导出</button>
          <label class="btn secondary" style="cursor: pointer;">
            📥 导入
            <input type="file" accept=".json" @change="handleImport" style="display: none" />
          </label>
        </div>

        <div class="action-group">
          <button class="btn primary" @click="showForm = true">➕ 添加</button>
        </div>
      </div>
    </header>
    <AgentDownload 
      v-if="showAgentDownload" 
      :global-config="globalConfig" 
      @close="showAgentDownload = false" 
      @toast="handleToast"
    />
    <Setting
      v-model:visible="showGlobalSettings"
      :global-config="globalConfig"
      @save="handleSaveGlobalSettings"
      @toast="handleToast"
    />
    <WebDavLogin
      v-model:visible="showWebDavLogin"
      @toast="handleToast"
      @changed="refreshWebDavLoginState"
      @logged-in="handleInitialCloudSync"
    />
    <Transition name="modal">
      <div v-if="showForm" class="modal-overlay" @click.self="showForm = false; editNode = null">
        <div class="modal-content" style="max-width: 720px;">
          <div class="modal-header">
            <h3>{{ editNode ? '✏️ 编辑节点' : '➕ 添加新节点' }}</h3>
            <button class="btn icon" @click="showForm = false; editNode = null">×</button>
          </div>
          <NodeForm
            :model-value="editNode || undefined"
            :is-edit="!!editNode"
            @submit="(data) => (editNode ? handleEditSubmit(data) : handleAddSubmit(data))"
            @cancel="showForm = false; editNode = null"
          />
        </div>
      </div>
    </Transition>

    <NodeFilterSort @sync="handleSyncAll" />

    <main class="main">
      <NodeList 
          @edit-node="handleEdit" 
          @terminal="openTerminal"
          @files="openFileManager"
          @tasks="openTaskManager"
          @ai-prompt="openAiPrompt"
          @argo-tunnel="openArgoTunnel"
          @full-terminal="openTerminal2" 
          @update-agent="handleUpdateAgent"
          @add="showForm = true"
          @download="showAgentDownload = true"
          @sync="handleSyncAll"
      />
      
    </main>

    <Transition name="fade">
      <div v-if="notification" class="toast" :class="notification.type">
        {{ notification.message }}
      </div>
    </Transition>

    <Transition name="global-toast">
      <div v-if="toastState.show" class="global-toast" :class="toastState.type">
        <span class="toast-icon">
          {{ toastState.type === 'success' ? '✅' : toastState.type === 'error' ? '❌' : 'ℹ️' }}
        </span>
        <span class="toast-message">{{ toastState.message }}</span>
      </div>
    </Transition>
  </div>

  <Terminal
    v-if="selectedTerminalNode"
    v-model:visible="showTerminal"
    :node="selectedTerminalNode"
    :global-config="globalConfig"
    @close="showTerminal = false"
  />
  <FileManager
    v-if="selectedFileNode"
    v-model:visible="showFileManager"
    :node="selectedFileNode"
    :global-config="globalConfig"
    @close="showFileManager = false"
  />
  <TaskManager
    v-if="selectedTaskNode"
    v-model:visible="showTaskManager"
    :node="selectedTaskNode"
    :global-config="globalConfig"
    @close="showTaskManager = false"
  />
  <AiPrompt
    v-if="selectedAiNode"
    v-model:visible="showAiPrompt"
    :node="selectedAiNode"
    :global-config="globalConfig"
    @close="showAiPrompt = false"
  />
  <ArgoTunnel
    v-if="selectedArgoNode"
    v-model:visible="showArgoTunnel"
    :node="selectedArgoNode"
    :global-config="globalConfig"
    @close="showArgoTunnel = false"
  />
  <div class="app-container">
    <Transition name="toast">
      <div v-if="toastMsg" class="bottom-error-toast">
        <span class="icon">⚠️</span> {{ toastMsg }}
      </div>
    </Transition>
  </div>
  <Terminal2
    v-if="showTerminal2 && selectedTerminal2Node"
    v-model:visible="showTerminal2"
    :node="selectedTerminal2Node"
    :global-config="globalConfig"
    :node-id="selectedTerminal2Node.id"
    :node-name="selectedTerminal2Node.name"
    :ws-url="terminalWsUrl"
    @close="() => { showTerminal2 = false; selectedTerminal2Node = null; }"
  />
  <UpdateModal
    v-if="showUpdateModal && targetUpdateNode"
    v-model:visible="showUpdateModal"
    :node="targetUpdateNode"
    :global-config="globalConfig"
    @confirm="handleExecuteUpdatePayload"
  />
  <NodePreview :node="hoveredNode" />

</template>
  
<style>
/* ========================================================
   1. 🌟 全局变量定义（浅色 + 暗色双主题，默认跟随系统）
   ======================================================== */
:root {
  color-scheme: light;

  --bg: #f5f7fa;
  --card: #ffffff;
  --header-bg: #ffffff;
  --text: #1e293b;
  --muted: #64748b;
  --primary: #3b82f6;
  --primary-hover: #2563eb;
  --success: #10b981;
  --danger: #ef4444;
  --warning: #f59e0b;
  --border: #e2e8f0;
  --border-strong: #cbd5e1;

  --surface-2: #f8fafc;
  --surface-3: #f1f5f9;
  --hover-bg: #f8fafc;
  --btn-bg: #ffffff;
  --text-soft: #475569;
  --text-strong: #0f172a;

  --chip-online-bg: #ecfdf5;
  --chip-online-border: #a7f3d0;
  --chip-online-text: #065f46;
  --chip-offline-bg: #fef2f2;
  --chip-offline-border: #fecaca;
  --chip-offline-text: #991b1b;
  --chip-syncing-bg: #eff6ff;
  --chip-syncing-border: #bfdbfe;
  --chip-syncing-text: #1e40af;
  --chip-error-bg: #fff1f2;
  --chip-error-border: #fecdd3;
  --chip-error-text: #be123c;

  --hover-tint-green: #f0fdf4;
  --hover-tint-purple: #f5f3ff;
  --hover-tint-teal: #f0fdfa;
  --hover-tint-red: #fef2f2;
  --code-bg: #1e293b;

  --shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.05);
  --shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);
  --shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1);
  --radius: 16px;
  --radius-sm: 10px;
}

:root[data-theme='dark'] {
  color-scheme: dark;

  --bg: #0f172a;
  --card: #1e293b;
  --header-bg: #16213a;
  --text: #e2e8f0;
  --muted: #94a3b8;
  --border: #334155;
  --border-strong: #475569;

  --surface-2: #1b2942;
  --surface-3: #24344d;
  --hover-bg: #26344c;
  --btn-bg: #1e293b;
  --text-soft: #cbd5e1;
  --text-strong: #f1f5f9;

  --chip-online-bg: rgba(16, 185, 129, 0.15);
  --chip-online-border: rgba(16, 185, 129, 0.4);
  --chip-online-text: #34d399;
  --chip-offline-bg: rgba(239, 68, 68, 0.15);
  --chip-offline-border: rgba(239, 68, 68, 0.4);
  --chip-offline-text: #f87171;
  --chip-syncing-bg: rgba(59, 130, 246, 0.15);
  --chip-syncing-border: rgba(59, 130, 246, 0.4);
  --chip-syncing-text: #60a5fa;
  --chip-error-bg: rgba(244, 63, 94, 0.15);
  --chip-error-border: rgba(244, 63, 94, 0.4);
  --chip-error-text: #fb7185;

  --hover-tint-green: rgba(16, 185, 129, 0.12);
  --hover-tint-purple: rgba(124, 58, 237, 0.18);
  --hover-tint-teal: rgba(13, 148, 136, 0.12);
  --hover-tint-red: rgba(239, 68, 68, 0.12);
  --code-bg: #0b1120;

  --shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.3);
  --shadow: 0 4px 6px -1px rgb(0 0 0 / 0.4), 0 2px 4px -2px rgb(0 0 0 / 0.4);
  --shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.5), 0 4px 6px -4px rgb(0 0 0 / 0.4);
}

:root,
html,
body {
  background-color: var(--bg);
  color: var(--text);
}

/* ========================================================
   2. 🧱 基础核心 Reset 与滚动条重塑
   ======================================================== */
* { 
  box-sizing: border-box; 
  margin: 0; 
  padding: 0; 
}

body {
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

.app {
  max-width: 1440px;
  margin: 0 auto;
  padding: 24px 20px;
  min-height: 100vh;
  width: 100%;
}

.main { 
  margin-top: 24px; 
}

::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-track { background: var(--bg); }
::-webkit-scrollbar-thumb { background: var(--border-strong); border-radius: 10px; }
::-webkit-scrollbar-thumb:hover { background: var(--muted); }


/* ========================================================
   3. 🧭 顶部导航条（Header）与响应式栅格布局合并
   ======================================================== */
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 28px; 
  background: var(--header-bg);
  border-radius: var(--radius);
  margin-bottom: 28px;
  border: 1px solid var(--border);
  box-shadow: var(--shadow-sm);
  flex-wrap: wrap;
  gap: 20px;          
}

.header h1 {
  font-size: 1.6rem;
  font-weight: 600;
  letter-spacing: -0.02em;
  background: linear-gradient(135deg, var(--primary) 0%, #8b5cf6 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  display: flex;
  align-items: center;
  gap: 10px;
}

/* 🏷️ 标题旁的面板版本号角标（配色对齐 status-badge / domain-badge 的中性文字风格） */
.version-chip {
  font-size: 0.75rem;
  font-weight: 500;
  letter-spacing: 0;
  font-family: monospace;
  padding: 2px 8px;
  border-radius: 6px;
  background: var(--surface-3);
  border: 1px solid var(--border);
  color: var(--muted);
  -webkit-text-fill-color: currentColor;
  cursor: default;
  white-space: nowrap;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 24px; 
  flex-wrap: wrap;
  justify-content: flex-end;
  flex: 1;   
}

.action-group {
  display: flex;
  align-items: center;
  gap: 8px;  
}

.status-badge {
  padding: 6px 14px;
  background: var(--chip-syncing-bg);
  border-radius: 40px;
  font-size: 0.85rem;
  font-weight: 500;
  color: var(--primary);
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--chip-syncing-border);
}

@media (max-width: 768px) {
  .header {
    flex-direction: column;
    align-items: flex-start;
    padding: 16px;
  }
  .header-actions {
    justify-content: flex-start;
    gap: 12px;
  }
  .action-group {
    width: 100%;
    justify-content: flex-start;
    flex-wrap: wrap;
  }
}


/* ========================================================
   4. ⚡ 按钮控制系统（Buttons）
   ======================================================== */
.btn {
  padding: 10px 18px;
  border: none;
  border-radius: 40px;
  cursor: pointer;
  font-weight: 500;
  font-size: 0.9rem;
  transition: all 0.15s ease;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--btn-bg);
  border: 1px solid var(--border);
  color: var(--text);
  box-shadow: var(--shadow-sm);
}

.btn.primary {
  padding: 10px 20px; 
  background: var(--primary);
  border-color: var(--primary);
  color: white;
  box-shadow: var(--shadow);
}
.btn.primary:hover {
  background: var(--primary-hover);
  transform: scale(0.98);
}

.btn.secondary {
  padding: 8px 14px; 
  font-size: 0.85rem;
  background: var(--btn-bg);
  border-color: var(--border);
  color: var(--text);
}
.btn.secondary:hover {
  background: var(--hover-bg);
  border-color: var(--border-strong);
}
.btn.secondary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 🔑 登录按钮的已登录态：绿色胶囊提示云同步已就绪 */
.btn.webdav-logged-in {
  color: var(--chip-online-text);
  border-color: var(--chip-online-border);
  background: var(--chip-online-bg);
}

/* ⚠️ 已登录但云端失联：黄色警示态（配置仍在本地，仅链路不可达） */
.btn.webdav-link-error {
  color: var(--warning);
  border-color: rgba(245, 158, 11, 0.4);
  background: rgba(245, 158, 11, 0.12);
}

.btn.icon {
  padding: 10px 12px;
  border-radius: 40px;
  background: var(--btn-bg);
}
.btn.icon:hover {
  background: var(--surface-3);
}
.btn.icon.danger:hover {
  background: var(--chip-offline-bg);
  border-color: var(--danger);
  color: var(--danger);
}

.btn-sm {
  padding: 6px 14px;
  font-size: 0.8rem;
}


/* ========================================================
   5. 📋 表单与配置面板系统（Forms）
   ======================================================== */
.grid-form {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.form-section h4 {
  margin-bottom: 12px;
  font-size: 0.95rem;
  color: var(--primary);
  display: flex;
  align-items: center;
  gap: 8px;
}

.form-group {
  margin-bottom: 18px;
}
.form-group label {
  font-size: 0.9rem;
  font-weight: 500;
  color: var(--text);
  margin-bottom: 6px;
  display: block;
}
.form-group input,
.form-group textarea {
  width: 100%;
  padding: 12px 14px;
  border-radius: var(--radius-sm);
  border: 1.5px solid var(--border);
  background: var(--btn-bg);
  color: var(--text);
  font-size: 0.95rem;
  transition: border 0.15s;
}
.form-group input:focus,
.form-group textarea:focus {
  outline: none;
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}
.form-group textarea {
  font-family: 'SF Mono', 'Menlo', monospace;
  resize: vertical;
  min-height: 100px;
}

.input-error { border-color: var(--danger) !important; }
.error-message { color: var(--danger); font-size: 0.8rem; margin-top: 6px; }

.readonly-style {
  background-color: var(--surface-2);
  font-size: 0.85rem !important;
}
.readonly-input {
  background-color: var(--surface-3) !important;
  color: var(--muted) !important;
  cursor: not-allowed;
  border-style: dashed !important;
}

.label-with-action {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.divider {
  border: 0;
  border-top: 1px solid var(--border);
  margin: 15px 0;
}


/* ========================================================
   6. 📥 代理下载及快捷小组件风格
   ======================================================== */
.download-link {
  font-size: 0.75rem;
  color: var(--primary);
  text-decoration: underline;
  cursor: pointer;
}
.download-link:hover {
  color: var(--primary-hover);
}

.quick-actions {
  background: var(--chip-syncing-bg);
  padding: 12px 16px;
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
  border: 1px solid var(--chip-syncing-border);
}
.quick-actions span {
  font-weight: 600;
  font-size: 0.9rem;
  color: var(--chip-syncing-text);
}

.toggle-link {
  cursor: pointer;
  color: #409eff; 
  font-size: 13px;
  margin-top: -5px; 
  margin-bottom: 10px;
  user-select: none;
  transition: color 0.2s;
}
.toggle-link:hover {
  opacity: 0.8;
  text-decoration: underline;
}


/* ========================================================
   7. 🔮 模态弹窗与动态反馈系统（Modal, Toast）
   ======================================================== */
.modal-overlay {
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

.modal-content {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 24px;
  width: 100%;
  max-width: 560px;
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: var(--shadow-lg);
  animation: modalSlideIn 0.2s ease;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}
.modal-header h3 {
  font-size: 1.3rem;
  font-weight: 600;
}
.modal-header .header-actions {
  display: flex;
  gap: 10px;
  align-items: center;
}

.modal-body { padding: 8px 0; }
.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
}

.hint {
  font-size: 0.85rem;
  color: var(--muted);
  margin-bottom: 20px;
}

/* ============ 右下角系统 Toast 通知 ============ */
.toast {
  position: fixed;
  bottom: 24px;
  right: 24px;
  padding: 14px 24px;
  border-radius: 40px;
  background: var(--btn-bg);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-lg);
  color: var(--text);
  z-index: 2000;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 8px;
  animation: toastSlideIn 0.3s ease;
}
.toast.success { border-left: 6px solid var(--success); }
.toast.error { border-left: 6px solid var(--danger); }
.toast.info { border-left: 6px solid var(--primary); }

/* ============ 底部报错专属大面包屑（ToastMsg） ============ */
.bottom-error-toast {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  background-color: #ef4444; 
  color: white;
  padding: 12px 24px;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 9999;
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 500;
  pointer-events: none; 
}

/* ============ ✨ 新增：高维全局统一胶囊样式的 Toast 展现 ============ */
.global-toast {
  position: fixed;
  bottom: 30px;
  left: 50%;
  transform: translateX(-50%);
  min-width: 300px;
  max-width: 70vw;
  padding: 14px 24px;
  background: #1e293b;
  color: white;
  border-radius: 50px;
  box-shadow: 0 20px 30px -8px rgba(0, 0, 0, 0.25);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  font-size: 1rem;
  font-weight: 500;
  z-index: 9999;
  pointer-events: none;
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.1);
}
.global-toast.success { background: #0f766e; }
.global-toast.error { background: #b91c1c; }
.global-toast.info { background: #2563eb; }
.toast-icon { font-size: 1.4rem; line-height: 1; }
.toast-message { word-break: break-word; }


/* ========================================================
   8. 🎬 核心动画库（Animations）
   ======================================================== */
.animate-fade {
  transition: all 0.3s ease;
}

@keyframes modalSlideIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes toastSlideIn {
  from { transform: translateX(100%); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
}

/* Vue 内置 Transition 路由过渡态控制 */
.modal-enter-active, .modal-leave-active { transition: opacity 0.2s; }
.modal-enter-from, .modal-leave-to { opacity: 0; }

.fade-enter-active, .fade-leave-active { transition: opacity 0.2s, transform 0.2s; }
.fade-enter-from, .fade-leave-to { opacity: 0; transform: translateY(10px); }

.v-show-hide-enter-active, .v-show-hide-leave-active { transition: opacity 0.3s ease, transform 0.3s ease; }
.v-show-hide-enter-from, .v-show-hide-leave-to { opacity: 0; transform: translateY(-10px); }

.toast-enter-active, .toast-leave-active { transition: all 0.3s cubic-bezier(0.18, 0.89, 0.32, 1.28); }
.toast-enter-from { opacity: 0; transform: translate(-50%, 20px); }
.toast-leave-to { opacity: 0; transform: translate(-50%, 10px); }

/* 全局统一胶囊通知动画流 */
.global-toast-enter-active, .global-toast-leave-active { transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); }
.global-toast-enter-from { opacity: 0; transform: translateX(-50%) translateY(30px); }
.global-toast-leave-to { opacity: 0; transform: translateX(-50%) translateY(-20px); }

/* ========================================================
   9. 🌙 暗色模式通用兜底（重面板工具界面）
   ======================================================== */
:root[data-theme='dark'] .filemanager-modal,
:root[data-theme='dark'] .picker-container,
:root[data-theme='dark'] .update-panel-container,
:root[data-theme='dark'] .argo-modal,
:root[data-theme='dark'] .ai-modal,
:root[data-theme='dark'] .dialog-content {
  background: var(--card);
  border-color: var(--border);
  color: var(--text);
}
:root[data-theme='dark'] .update-panel-container,
:root[data-theme='dark'] .filemanager-modal h3,
:root[data-theme='dark'] .argo-modal h3,
:root[data-theme='dark'] .ai-modal h3,
:root[data-theme='dark'] .picker-header h5,
:root[data-theme='dark'] .custom-file-zone h4 {
  color: var(--text);
}
:root[data-theme='dark'] .fm-header,
:root[data-theme='dark'] .fm-footer,
:root[data-theme='dark'] .task-manager-footer {
  background: var(--header-bg);
  border-color: var(--border);
}
:root[data-theme='dark'] .fm-toolbar {
  background: var(--surface-2);
  border-color: var(--border);
}
:root[data-theme='dark'] .fm-toolbar button,
:root[data-theme='dark'] .picker-back-btn,
:root[data-theme='dark'] .file-browse-btn {
  background: var(--btn-bg);
  border-color: var(--border);
  color: var(--text-soft);
}
:root[data-theme='dark'] .fm-toolbar button:hover:not(:disabled) {
  background: var(--hover-bg);
  border-color: var(--border-strong);
  color: var(--text);
}
:root[data-theme='dark'] .file-table th {
  background: var(--surface-2);
  color: var(--muted);
  border-color: var(--border);
}
:root[data-theme='dark'] .file-table td {
  color: var(--text-soft);
  border-color: var(--border);
}
:root[data-theme='dark'] .file-table tr:hover { background: var(--hover-bg); }
:root[data-theme='dark'] .file-table tr.selected { background: var(--chip-syncing-bg); }
:root[data-theme='dark'] .breadcrumb,
:root[data-theme='dark'] .dir-list {
  background: var(--card);
  border-color: var(--border);
}
:root[data-theme='dark'] .file-info {
  background: var(--surface-3);
  border-color: var(--border-strong);
}
:root[data-theme='dark'] .file-info code {
  background: var(--surface-2);
  color: var(--text);
}
:root[data-theme='dark'] .argo-status,
:root[data-theme='dark'] .info-section,
:root[data-theme='dark'] .picker-path-bar {
  background: var(--surface-2);
  border-color: var(--border);
  color: var(--text-soft);
}
:root[data-theme='dark'] .custom-select,
:root[data-theme='dark'] .custom-input,
:root[data-theme='dark'] .custom-select-grouped,
:root[data-theme='dark'] .custom-input-grouped {
  background: var(--btn-bg);
  color: var(--text);
  border-color: var(--border-strong);
}
:root[data-theme='dark'] .custom-file-zone h4 { color: var(--text); }
:root[data-theme='dark'] .form-group label,
:root[data-theme='dark'] .form-section h4 { color: var(--text); }
:root[data-theme='dark'] .bg-warm-paper {
  background: rgba(245, 158, 11, 0.1);
  border-color: rgba(245, 158, 11, 0.3);
  color: #fbbf24;
}
:root[data-theme='dark'] .bg-danger-capsule {
  background: rgba(239, 68, 68, 0.12);
  border-color: rgba(239, 68, 68, 0.35);
  color: #fca5a5;
}
:root[data-theme='dark'] .error-banner {
  background: var(--chip-error-bg);
  border-color: var(--chip-error-border);
  color: var(--chip-error-text);
}
:root[data-theme='dark'] .success-banner {
  background: var(--chip-online-bg);
  border-color: var(--chip-online-border);
  color: var(--chip-online-text);
}
:root[data-theme='dark'] .picker-item {
  color: var(--text-soft);
  border-color: var(--border);
}
:root[data-theme='dark'] .picker-item:hover {
  background: var(--hover-bg);
  color: var(--text);
}
:root[data-theme='dark'] .select-input {
  background: var(--btn-bg);
  color: var(--text);
  border-color: var(--border);
}
</style>