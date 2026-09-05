<!-- src/components/Terminal2.vue -->
<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, watch , reactive } from 'vue';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import 'xterm/css/xterm.css';
import { Noise } from '../lib/noise';
import { AgentClient, computeWsDowngradeToken } from '../lib/agent-client'
import type { AgentProtoScheme } from '../lib/proto-detect'
import { getProtoScheme, isLegacyAgentVersion } from '../lib/proto-detect'
import type { AgentNode } from '../types'
import { markRaw } from 'vue';

// ============ 类型定义 ============
interface TerminalTab {
  id: string;
  name: string;
  terminal: Terminal;
  fitAddon: FitAddon;
  ws?: WebSocket;
  isActive: boolean;
  buffer: string[];
  connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'error';
  useNoise?: boolean;
  cipher?: Noise; // 🔥 新增：明确引入 Noise 类型
  latencyMs: number | null;
  lastHeartbeatSentAt: number;

  nodeId: string;
  wsUrl: string;
  nodeData: AgentNode;
  // ⚠️ LEGACY_AGENT_SUPPORT：以下协议兼容字段随旧版 agent 支持（面板 0.6.0）一起移除
  tokenScheme?: AgentProtoScheme;          // 本次连接使用的 token 方案
  wsTokenOverride?: AgentProtoScheme;      // 1008 降级探测后的强制方案（tab 生命周期内粘滞）
  wsFallbackDone?: boolean;                // token 方案 1008 互换探测是否已用过（收到服务端数据、认证确实通过后复位）
  wsAuthVerified?: boolean;                // 本次连接是否收到过服务端数据（token 认证通过的实证）
  keyRotationRetried?: boolean;            // Noise 握手被拒后的密钥重拉重试是否已用过（握手成功后复位）
}

interface TerminalSettings {
  fontSize: number;
  theme: 'dark' | 'light';
  cursorBlink: boolean;
}

// ============ Props & Emits ============
const props = defineProps<{
  node: AgentNode;
  globalConfig?: { ecdsaPrivateKey?: string; eciesPrivateKey?: string }
  visible: boolean;
  nodeId: string;
  nodeName: string;
  wsUrl?: string;
}>();

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void;
  (e: 'close'): void;
}>();

// ============ 响应式状态 ============
const containerRef = ref<HTMLElement | null>(null);
const terminalContainerRef = ref<HTMLElement | null>(null);
const settingsPanelRef = ref<HTMLElement | null>(null);

const tabs = ref<TerminalTab[]>([]);
const activeTabId = ref<string>('');
const isFullscreen = ref(false);
const showSettings = ref(false);

// 🔹 新增：最小化状态
const isMinimized = ref(false);

// 🔹 切换最小化/还原
const toggleMinimize = () => {
  isMinimized.value = !isMinimized.value;
  
  // 还原时重新适配终端尺寸并释放数据
  if (!isMinimized.value) {
    nextTick(() => {
      // 🚀 新增：取消最小化恢复窗口时，释放当前活动 Tab 的缓存数据
      if (activeTab.value) {
        if (activeTab.value.buffer && activeTab.value.buffer.length > 0) {
          activeTab.value.buffer.forEach(data => activeTab.value!.terminal.write(data));
          activeTab.value.buffer = [];
        }
        activeTab.value.fitAddon.fit();
        activeTab.value.terminal.focus();
      }
    });
  }
};
// ✅ 新增：动态计算当前 Tab 的连接状态
const currentConnectionStatus = computed(() => {
  if (!activeTab.value) return 'disconnected';
  return activeTab.value.connectionStatus;
});
// 🔹 最近一次 WebSocket 心跳往返延迟（浏览器正常通信时采样）
const currentLatency = computed(() => {
  return activeTab.value?.latencyMs ?? null;
});
const latencyClass = computed(() => {
  const ms = currentLatency.value;
  if (ms === null) return '';
  if (ms <= 500) return 'latency-good';
  if (ms < 1000) return 'latency-mid';
  return 'latency-bad';
});
// 🔹 监听 visible 变化，关闭时重置最小化状态
watch(() => props.visible, (val) => {
  if (!val) isMinimized.value = false;
});

// 🔹 新增：最小化悬浮窗拖拽逻辑（默认位于屏幕左下角）
const floatWidgetRef = ref<HTMLElement | null>(null);
const widgetPos = ref({ left: 24, bottom: 24 }); // 默认左下角：left 24px / bottom 24px
const isDraggingWidget = ref(false);
let widgetDragStart = { mouseX: 0, mouseY: 0, left: 0, bottom: 0 };

const onWidgetDragStart = (e: MouseEvent) => {
  // 仅响应鼠标左键；点击头部按钮（还原/关闭）时不触发拖拽
  if (e.button !== 0) return;
  if ((e.target as HTMLElement).closest('button')) return;

  isDraggingWidget.value = true;
  widgetDragStart = {
    mouseX: e.clientX,
    mouseY: e.clientY,
    left: widgetPos.value.left,
    bottom: widgetPos.value.bottom,
  };
  document.addEventListener('mousemove', onWidgetDragMove);
  document.addEventListener('mouseup', onWidgetDragEnd);
  e.preventDefault(); // 防止拖拽时选中文本
};

const onWidgetDragMove = (e: MouseEvent) => {
  if (!isDraggingWidget.value) return;
  const dx = e.clientX - widgetDragStart.mouseX;
  const dy = e.clientY - widgetDragStart.mouseY;

  // 边界限制：不允许拖出视口
  const el = floatWidgetRef.value;
  const w = el?.offsetWidth || 260;
  const h = el?.offsetHeight || 90;
  const margin = 8;
  const maxLeft = Math.max(window.innerWidth - w - margin, margin);
  const maxBottom = Math.max(window.innerHeight - h - margin, margin);

  widgetPos.value = {
    left: Math.min(Math.max(widgetDragStart.left + dx, margin), maxLeft),
    bottom: Math.min(Math.max(widgetDragStart.bottom - dy, margin), maxBottom),
  };
};

const onWidgetDragEnd = () => {
  isDraggingWidget.value = false;
  document.removeEventListener('mousemove', onWidgetDragMove);
  document.removeEventListener('mouseup', onWidgetDragEnd);
};
const settings = ref<TerminalSettings>({
  fontSize: 14,
  // 🌙 主题：优先跟随应用/系统主题，仅当用户手动切换过后才使用记忆值
  theme: (() => {
    const saved = localStorage.getItem('kisama_terminal_theme');
    if (saved === 'dark' || saved === 'light') return saved;
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  })(),
  cursorBlink: true,
});

const version = '0.1.1';

const TERMINAL_THEMES = {
  dark: {
    background: '#0d1117',
    foreground: '#c9d1d9',
    cursor: '#c9d1d9',
    selectionBackground: 'rgba(17, 165, 157, 0.3)',
  },
  light: {
    background: '#f8f9fa',
    foreground: '#24292e',
    cursor: '#24292e',
    selectionBackground: 'rgba(3, 102, 214, 0.2)',
    ansi: [
      '#24292e', '#cf222e', '#116329', '#7c4a03', '#0969da', '#8250df', '#0550ae', '#656d76',
      '#6e7781', '#a40e26', '#1a7f37', '#9a6700', '#0550ae', '#8250df', '#0550ae', '#656d76',
    ],
  },
};

// ============ 计算属性 ============
const activeTab = computed(() => {
  return tabs.value.find(tab => tab.id === activeTabId.value);
});

const fontSizeOptions = computed(() => {
  return [10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24];
});

const client = ref<AgentClient | null>(null)
// 核心：初始化或切换节点时，同步 Client 状态
async function initTerminalClient2(tab: TerminalTab) {
  client.value?.destroy?.()
  // 优先节点配置，否则使用传入的全局配置
  const ecdsaKey = tab.nodeData.ecdsaPrivateKey || props.globalConfig?.ecdsaPrivateKey || '';
  const eciesKey = tab.nodeData.eciesPrivateKey || props.globalConfig?.eciesPrivateKey || '';

  // 检查是否为空
  if (!ecdsaKey) {
    throw new Error('未配置 ECDSA 私钥，请在全局设置或节点高级设置中填写');
    return;
  }

  // 注意：如果 eciesPrivateKey 是十六进制字符串，需要转换
  // （前端已有验证，只接受 PKCS#8 PEM，所以这里应当是转换后的 PEM）
  // 如果全局配置中存的是十六进制，需要在此处转换，但建议统一在前端保存时就转换为 PEM

  const newClient = new AgentClient({
    domain: tab.nodeData.domain,
    eciesPrivateKey: eciesKey,
    ecdsaPrivateKey: ecdsaKey,
    timeout: 30000,
    Encryption: true // 是否加密
  });
  let baseinfo;
  try {
    baseinfo = await newClient.getBaseInfo();
    client.value = newClient;
    //console(client.value.baseURL)
    console.log("newClient"+JSON.stringify((client.value as any).baseURL))
  } catch (err: any) {
    throw new Error(`[初始化失败] ${err.message}`);
  }
  return baseinfo
}
// ============ Terminal 管理 ============
const createTerminal = (): { terminal: Terminal; fitAddon: FitAddon } => {
  const fitAddon = new FitAddon();
  const webLinksAddon = new WebLinksAddon();
  
  const terminal = new Terminal({
    fontSize: settings.value.fontSize,
    fontFamily: '"JetBrains Mono", "Fira Code", Consolas, Menlo, Monaco, "Courier New", monospace',
    theme: TERMINAL_THEMES[settings.value.theme],
    cursorBlink: settings.value.cursorBlink,
    cursorStyle: 'block',
    scrollback: 10000,
    tabStopWidth: 4,
    convertEol: true,
  });
  
  terminal.loadAddon(fitAddon);
  terminal.loadAddon(webLinksAddon);
  
  return { terminal, fitAddon };
};

// 🔥 新增：专门处理大文本切片串行发送的工具函数
// 🔥 修复后的：专门处理大文本切片串行发送的工具函数
function sendLargeTextInChunks(text: string, tab: any) {
  // 💡 ✨【兼顾方案】：统一归一化为纯 \r（回车）作为行分隔符，与真实终端模拟器粘贴行为一致
  // - nano（raw 模式）：\r 即换行并归零列，避免裸 \n 只下移不回车导致的“吞换行/行错位”
  // - shell（cooked 模式，icrnl 开启）：\r 被翻译为 \n，单行换行正常，
  //   且 "\"+回车 仍被识别为反斜杠多行续接（\），不会提前截断执行
  const normalizedText = text.replace(/\r\n/g, '\r').replace(/[\r\n]/g, '\r');

  const chunkSize = 128; // 稍微收紧单包体积，给高压密文环境下留足回显空间
  let offset = 0;
  const encoder = new TextEncoder();

  function sendNextChunk() {
    if (offset >= normalizedText.length) return;
    
    const chunk = normalizedText.slice(offset, offset + chunkSize);
    offset += chunkSize;

    if (tab.ws && tab.ws.readyState === WebSocket.OPEN) {
      const encoded = encoder.encode(chunk);
      // 对齐您原有的 Noise 握手和加密状态判定逻辑
      if (tab.useNoise && tab.cipher?.isEstablished) {
        tab.ws.send(tab.cipher.encrypt(encoded) as any);
      } else {
        tab.ws.send(encoded);
      }
    }
    // 每包严格保持 15ms 间隔，让远程 Linux 缓冲区稳步吞噬数据
    setTimeout(sendNextChunk, 15);
  }
  sendNextChunk();
}

const addTab = () => {
  const id = `tab-${Date.now()}`;
  const { terminal, fitAddon } = createTerminal();
  
  // 🔥 修复：使用 reactive 包裹对象，使其从诞生起就是响应式的
  const newTab = reactive<TerminalTab>({
    id,
    name: props.nodeName,         // 🔥 使用节点名称作为标签名，而不是 "标签 1"
    nodeId: props.nodeId,         // 🔥 绑定节点 ID
    wsUrl: props.wsUrl || '',     // 🔥 绑定连接地址
    nodeData: props.node,         // 🔥 保存当前节点的配置快照
    terminal,
    fitAddon,
    isActive: true,
    buffer: [],
    connectionStatus: 'connecting',
    latencyMs: null,
    lastHeartbeatSentAt: 0,
  });
  
  tabs.value.forEach(tab => {
    tab.isActive = false;
  });
  
  tabs.value.push(newTab);
  activeTabId.value = id;
  
  nextTick(() => {
    const container = document.getElementById(`terminal-container-${id}`);
    if (container) {
      terminal.open(container);
      fitAddon.fit();
      terminal.focus();
      if (terminal.textarea) {
        terminal.textarea.addEventListener('paste', (event: ClipboardEvent) => {
          // 强行制止事件向下投递，彻底让 xterm.js 的内部原生粘贴流“失聪”
          event.preventDefault();
          event.stopPropagation();
          
          const text = event.clipboardData?.getData('text') || '';
          if (text) {
            // 移交给洗涤后的切片分块发送函数
            sendLargeTextInChunks(text, newTab);
          }
        }, { capture: true }); // 稳稳开启核心捕获阶段拦截
      }
      terminal.onData(data => {
        if (newTab.ws && newTab.ws.readyState === WebSocket.OPEN) {
          if (newTab.useNoise) {
            const cipher = newTab.cipher;
            if (cipher && cipher.isEstablished) {
              // 终端数据（字符）转二进制 -> 加密 -> 发送
              const textEncoder = new TextEncoder();
              const encrypted = cipher.encrypt(textEncoder.encode(data));
              newTab.ws.send(encrypted as any);
            }
          } else {
            // 明文直发
            const textEncoder = new TextEncoder();
            newTab.ws.send(textEncoder.encode(data));
          }
        } else if (data === '\r') {
          terminal.writeln('\r\n\x1b[1;36m🔄 正在尝试重新连接...\x1b[0m');
          connectWebSocket(newTab as unknown as TerminalTab);
        }
      });

      terminal.onResize(({ cols, rows }) => {
        if (newTab.ws && newTab.ws.readyState === WebSocket.OPEN) {
          const resizePayload = JSON.stringify({ type: 'resize', cols, rows });
          
          // 🔥 区分是否使用加密
          if (newTab.useNoise) {
            const cipher = newTab.cipher;
            if (cipher && cipher.isEstablished) {
              try {
                const textEncoder = new TextEncoder();
                const encrypted = cipher.encrypt(textEncoder.encode(resizePayload));
                newTab.ws.send(encrypted as any);
              } catch (err) {
                console.error("Resize 加密发送失败:", err);
              }
            }
          } else {
            // 明文直发
            const textEncoder = new TextEncoder();
            newTab.ws.send(textEncoder.encode(resizePayload));
          }
        }
      });
      connectWebSocket(newTab as unknown as TerminalTab);
    }
  });
};

const closeTab = (tabId: string, event?: Event) => {
  event?.stopPropagation();
  
  const index = tabs.value.findIndex(tab => tab.id === tabId);
  if (index === -1) return;
  
  const tab = tabs.value[index];
  
  // 关闭 WebSocket 连接
  if (tab.ws) {
    tab.ws.close();
  }
  // 🔥 新增：释放 Noise 占用的 WASM 内存
  if (tab.cipher) {
    tab.cipher.destroy();
    tab.cipher = undefined;
  }
  // 销毁终端
  tab.terminal.dispose();
  
  tabs.value.splice(index, 1);
  
  // 如果关闭的是当前标签，激活下一个
  if (activeTabId.value === tabId && tabs.value.length > 0) {
    const newIndex = Math.min(index, tabs.value.length - 1);
    switchTab(tabs.value[newIndex].id);
  } else if (tabs.value.length === 0) {
    activeTabId.value = '';
    emit('update:visible', false);
    emit('close');
  }
};

const switchTab = (tabId: string) => {
  tabs.value.forEach(tab => {
    tab.isActive = tab.id === tabId;
  });
  activeTabId.value = tabId;
  
  nextTick(() => {
    const tab = tabs.value.find(t => t.id === tabId);
    if (tab) {
      // 🚀 新增：切回该标签时，如果存在积压的缓存数据，批量写入
      if (tab.buffer && tab.buffer.length > 0) {
        tab.buffer.forEach(data => tab.terminal.write(data));
        tab.buffer = []; // 写入后清空
      }
      tab.fitAddon.fit();
      tab.terminal.focus();
    }
  });
};

// ============ WebSocket 连接 (方案 B 动态监听完美擦除版) ============
// ============ WebSocket 连接 (方案 B 动态监听完美擦除 + 作用域修复版) ============
const connectWebSocket = async (tab: TerminalTab) => {
  if (!props.wsUrl) {
    tab.terminal.writeln('\x1b[1;32m✓ 已连接\x1b[0m');
    tab.terminal.writeln(`\x1b[1;36mINCUDAL\x1b[0m`);
    tab.terminal.writeln(`\x1b[1;33m${props.nodeName}\x1b[0m`);
    tab.terminal.writeln(`\x1b[1;34mu302-6zbhpev0:~# \x1b[0m`);
    return;
  }

  // 🚀 【核心修复】将控制状态与心跳控制函数提升到 try 块上方，建立完整的函数作用域
  let initCmdSent = false;
  let heartbeatInterval: any = null;

  // 🚀 安全发送心跳包的函数
  const sendHeartbeat = () => {
    if (tab.ws && tab.ws.readyState === WebSocket.OPEN) {
      tab.lastHeartbeatSentAt = Date.now();
      const heartbeatPayload = JSON.stringify({ type: 'heartbeat' });
      const textEncoder = new TextEncoder();
      
      if (tab.useNoise && tab.cipher?.isEstablished) {
        const encrypted = tab.cipher.encrypt(textEncoder.encode(heartbeatPayload));
        tab.ws.send(encrypted as any);
      } else {
        tab.ws.send(textEncoder.encode(heartbeatPayload));
      }
    }
  };

  const startHeartbeat = () => {
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    // 每 10 秒送秋波一次（SKILL.md 推荐频率），同时作为延迟采样包
    heartbeatInterval = setInterval(sendHeartbeat, 10000);
  };

  const stopHeartbeat = () => {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
  };
  
  try {
    tab.connectionStatus = 'connecting';
    tab.terminal.writeln('\x1b[1;33m正在获取节点配置...\x1b[0m');
    
    const baseinfo = await initTerminalClient2(tab);
    if (!baseinfo || !baseinfo.noise_key) {
      throw new Error("节点返回的数据中缺失 noise_key 配置");
    }
    
    // 🔥 新增：根据系统判断是 Windows (PowerShell) 还是 Unix (Bash)，用于发送兼容的无痕预命令
    const isWindows = (baseinfo.os || '').toLowerCase().includes('windows');
    
    const CONTROL_PRIVATE_KEY = baseinfo.noise_key.controller.private;
    const AGENT_PUBLIC_KEY = baseinfo.noise_key.agent.public;
    
    const baseURL = (client.value as any)?.baseURL || '';
    tab.useNoise = tab.nodeData?.forceNoiseWss || !baseURL.startsWith('https://');

    if (tab.useNoise) {
      if (tab.nodeData?.forceNoiseWss) {
        tab.terminal.writeln('\x1b[1;35m🛡️ [安全策略] 已开启强制 Noise 加密，正在初始化安全通道...\x1b[0m');
      } else {
        tab.terminal.writeln('\x1b[1;33m⚠️ 当前为 HTTP 环境，自动启用 Noise 安全通道...\x1b[0m');
      }
      if (tab.cipher) {
        tab.cipher.destroy();
        tab.cipher = undefined;
      }
      const cipher = await Noise.create(true, CONTROL_PRIVATE_KEY, AGENT_PUBLIC_KEY);
      tab.cipher = markRaw(cipher) as unknown as Noise;
      
    } else {
      tab.terminal.writeln('\x1b[1;32m🔒 检测到 HTTPS 安全通道，将使用 Token 认证进行标准传输...\x1b[0m');
    }

    const uniqueRequestId = `${tab.nodeId}_${tab.id}`;
    let wsUrl = `${tab.wsUrl}?request_id=${uniqueRequestId}`;

    if (!tab.useNoise) {
      // ⚠️ LEGACY_AGENT_SUPPORT：token 方案按 agent 版本选择（0.6.0 起仅保留 v2 HMAC）
      // - v2（agent ≥ 0.4.8）：token = Base64(HMAC-SHA256(base64decode(session_key), "kisama-ws-token-v1"))
      // - v1-legacy（agent ≤ 0.4.7）：token = agent 公钥（旧公式）
      let tokenScheme: AgentProtoScheme;
      if (tab.wsTokenOverride) {
        tokenScheme = tab.wsTokenOverride;
      } else if (getProtoScheme(tab.nodeData.domain)) {
        tokenScheme = getProtoScheme(tab.nodeData.domain)!;
      } else if (baseinfo.version) {
        tokenScheme = isLegacyAgentVersion(baseinfo.version) ? 'v1-legacy' : 'v2';
      } else {
        tokenScheme = 'v2';
      }
      tab.tokenScheme = tokenScheme;
      if (tokenScheme === 'v2') {
        if (!baseinfo.session_key) {
          throw new Error("节点未下发 session_key，无法生成 WS 认证 token");
        }
        wsUrl += `&token=${encodeURIComponent(computeWsDowngradeToken(baseinfo.session_key))}`;
      } else {
        wsUrl += `&token=${encodeURIComponent(AGENT_PUBLIC_KEY)}`;
      }
    }

    tab.ws = new WebSocket(wsUrl);
    tab.ws.binaryType = 'arraybuffer';
    // 每次连接尝试重置认证实证哨兵，供 onclose 判断 1008 是否发生在认证通过前
    tab.wsAuthVerified = false;

    tab.ws.onopen = async () => {
      if (tab.useNoise) {
        if (!tab.cipher) {
          tab.terminal.writeln('\r\n\x1b[1;31m✗ 加密模块未初始化\x1b[0m');
          return;
        }
        try {
          const cipher = tab.cipher;
          const msg1 = cipher.processHandshake(new Uint8Array(0));
          tab.ws?.send(msg1 as any);
          tab.terminal.writeln('\x1b[1;34m🔒 正在协商端到端加密...\x1b[0m');
        } catch (err) {
          tab.terminal.writeln(`\r\n\x1b[1;31m✗ 握手发起失败: ${err}\x1b[0m`);
          tab.ws?.close();
        }
      } else {
        tab.terminal.writeln('\x1b[1;32m✓ 终端通道已建立\x1b[0m');
        tab.connectionStatus = 'connected';
        // 注意：此处不复位 wsFallbackDone —— onopen 仅代表 WS 升级完成，
        // token 认证被拒 (1008) 发生在这之后。哨兵只在真正收到服务端数据
        // （onmessage，认证确实通过）后才复位，否则会形成 1008 无限互换探测。
        startHeartbeat();
        const resizePayload = JSON.stringify({ type: 'resize', cols: tab.terminal.cols, rows: tab.terminal.rows });
        const textEncoder = new TextEncoder();
        tab.ws?.send(textEncoder.encode(resizePayload));
      }
    };
    
    tab.ws.onmessage = (event) => {
      let dataToWrite: string | Uint8Array | null = null;

      // 非加密模式下，收到任何服务端消息（含心跳）即证明 token 认证通过，
      // 此时才复位 1008 降级探测哨兵，让后续真正的断线仍可再探测一次
      if (!tab.useNoise && !tab.wsAuthVerified) {
        tab.wsAuthVerified = true;
        tab.wsFallbackDone = false;
      }

      // ==================== 1. 加密状态下的解密与握手流程 ====================
      if (tab.useNoise) {
        if (!tab.cipher) return;
        const cipher = tab.cipher;
        
        if (event.data instanceof ArrayBuffer) {
          const rawBytes = new Uint8Array(event.data);
          
          if (!cipher.isEstablished) {
            try {
              const msg3 = cipher.processHandshake(rawBytes);
              if (msg3.length > 0) tab.ws?.send(msg3 as any);
              
              if (cipher.isEstablished) {
                tab.terminal.writeln('\x1b[1;32m✓ 握手成功，加密通道已建立\x1b[0m');
                tab.connectionStatus = 'connected';
                // 握手成功后复位一次性重试哨兵
                tab.keyRotationRetried = false;

                startHeartbeat();
                
                const resizePayload = JSON.stringify({ type: 'resize', cols: tab.terminal.cols, rows: tab.terminal.rows });
                const textEncoder = new TextEncoder();
                tab.ws?.send(cipher.encrypt(textEncoder.encode(resizePayload)) as any);
              }
            } catch (err) {
              tab.terminal.writeln(`\r\n\x1b[1;31m🚨 密码学握手被拒绝: ${err}\x1b[0m`);
              tab.ws?.close();
            }
            return;
          }

          try {
            dataToWrite = cipher.decrypt(rawBytes);
          } catch (err) {
            console.error("解密失败", err);
          }
        } else {
          dataToWrite = event.data;
        }
      } 
      else {
        if (event.data instanceof ArrayBuffer) {
          dataToWrite = new Uint8Array(event.data);
        } else {
          dataToWrite = event.data;
        }
      }

      // ==================== 2. 🎯 数据拦截、清洗与终端渲染器 ====================
      if (dataToWrite !== null) {
        let textCheck = '';
        if (dataToWrite instanceof Uint8Array) {
          textCheck = new TextDecoder().decode(dataToWrite);
        } else if (typeof dataToWrite === 'string') {
          textCheck = dataToWrite;
        }

        const cleanText = textCheck.replace(/\0/g, '').trim();

        if (cleanText.includes('"type"') && cleanText.includes('"heartbeat"')) {
          if (tab.lastHeartbeatSentAt > 0) {
            tab.latencyMs = Date.now() - tab.lastHeartbeatSentAt;
            tab.lastHeartbeatSentAt = 0;
          }
          return; 
        }

        const isHidden = !tab.isActive || isMinimized.value || !props.visible;
        if (isHidden) {
          tab.buffer.push(dataToWrite as any);
        } else {
          tab.terminal.write(dataToWrite);
        }

        // ==================== 3. 方案 B 核心：动态擦除注入拦截器 ====================
        const isReady = tab.useNoise ? tab.cipher?.isEstablished : (tab.connectionStatus === 'connected');
        if (isReady && !initCmdSent) {
          initCmdSent = true;
          
          // 🔥 无痕模式：仅当节点开启了无痕模式（默认开启）时才注入"不写历史到磁盘"的预命令
          if (tab.nodeData?.incognitoMode !== false) {
            setTimeout(() => {
              // 🔥 Windows (PowerShell) 与 Unix (Bash) 各自的兼容版无痕预命令：
              // - Unix: 重定向 HISTFILE=/dev/null + 用 printf 发送 ANSI 清除注入的命令行
              // - Windows: 用 Set-PSReadLineOption 禁止历史写入磁盘 + Clear-Host 清屏，避免 ANSI 擦除在换行时失效
              const initCmd = isWindows
                ? ' Set-PSReadLineOption -HistorySaveStyle SaveNothing;Clear-Host\r'
                : ' export HISTFILE=/dev/null; printf "%b" "\\033[A\\033[2K"\r';
              const textEncoder = new TextEncoder();
              
              if (tab.ws && tab.ws.readyState === WebSocket.OPEN) {
                if (tab.useNoise && tab.cipher?.isEstablished) {
                  const encryptedCmd = tab.cipher.encrypt(textEncoder.encode(initCmd));
                  tab.ws.send(encryptedCmd as any);
                } else {
                  tab.ws.send(textEncoder.encode(initCmd));
                }
              }
            }, 50);
          }
        }
      }
    };
    
    tab.ws.onerror = () => {
      stopHeartbeat();
      tab.connectionStatus = 'error';
      tab.terminal.writeln('\x1b[1;31m✗ 连接错误\x1b[0m');
    };
    
    tab.ws.onclose = (ev: CloseEvent) => {
      stopHeartbeat();
      tab.connectionStatus = 'disconnected';

      // ⚠️ LEGACY_AGENT_SUPPORT：1008 token 降级探测（0.6.0 移除）。
      // agent 0.4.8 用 HMAC(session_key) token，旧版用 agent 公钥 token；
      // 被对方 1008 拒绝且未探测过时，切换 token 方案自动重连一次。
      // 若两种方案都未收到任何服务端数据即被拒（wsAuthVerified=false），
      // 说明认证本身不可用，停止自动重连避免无限互换探测。
      if (ev.code === 1008 && !tab.useNoise) {
        if (!tab.wsFallbackDone) {
          tab.wsFallbackDone = true;
          tab.wsTokenOverride = tab.tokenScheme === 'v2' ? 'v1-legacy' : 'v2';
          tab.terminal.writeln(`\r\n\x1b[1;33m⚠️ Token 认证被拒绝 (1008)，切换${tab.wsTokenOverride === 'v2' ? '新版 HMAC' : '旧版兼容'} token 方案自动重连...\x1b[0m`);
          connectWebSocket(tab);
          return;
        }
        if (!tab.wsAuthVerified) {
          tab.terminal.writeln(`\r\n\x1b[1;31m✗ 两种 token 方案均被节点拒绝 (1008)，已停止自动重连。请确认面板与节点的 agent 版本是否匹配，或按 <Enter> 键手动重连。\x1b[0m`);
          return;
        }
        // 走到这说明本次会话认证通过后才被 1008 断开：不自动探测，交给通用断线提示
      }

      // agent 0.4.8 密钥轮换恢复：Noise 握手完成前被服务端 close 1000，
      // 多为节点已轮换 session_key / Noise 密钥 —— 重新拉取 baseinfo（connectWebSocket 内部
      // 会重跑 initTerminalClient2 取最新密钥）后自动重试一次。
      if (ev.code === 1000 && tab.useNoise && !tab.cipher?.isEstablished && !tab.keyRotationRetried) {
        tab.keyRotationRetried = true;
        tab.terminal.writeln(`\r\n\x1b[1;33m⚠️ 加密握手被节点拒绝 (1000)，可能是密钥已轮换，正在重新拉取节点密钥并重试...\x1b[0m`);
        connectWebSocket(tab);
        return;
      }

      tab.terminal.writeln('\r\n\x1b[1;31m✗ 连接已断开。按 <Enter> 键重新连接...\x1b[0m');
    };
  } catch (error) {
    // ✨ ✨ ✨ 完美修复：由于声明提升，现在 catch 块里能顺利调用并执行它了！
    stopHeartbeat(); 
    tab.connectionStatus = 'error';
    tab.terminal.writeln(`\r\n\x1b[1;31m✗ 连接失败: ${error}\x1b[0m`);
    tab.terminal.writeln('\x1b[1;33m按 <Enter> 键尝试重新连接...\x1b[0m');
  }
};

// ============ 工具栏功能 ============
const clearTerminal = () => {
  // 🔥 必须判断 .value，因为 activeTab 作为 ref 对象本身永远为 true
  if (activeTab.value) {
    activeTab.value.terminal.clear();
  }
};

const exportLogs = () => {
  if (!activeTab.value) return;
  
  const buffer = [];
  // 💡 ✨【核心修复点】：由原本可见视口的 rows 改为 active.length，从而彻底击穿视口，遍历整条历史滚动轴
  const totalLines = activeTab.value.terminal.buffer.active.length;
  
  for (let i = 0; i < totalLines; i++) {
    const line = activeTab.value.terminal.buffer.active.getLine(i);
    if (line) {
      let lineText = '';
      for (let j = 0; j < line.length; j++) {
        lineText += line.getCell(j)?.getChars() || '';
      }
      // 去掉每行末尾多余的空白占位符（右侧 trimmer 清洗）
      buffer.push(lineText.trimEnd());
    }
  }
  
  const blob = new Blob([buffer.join('\n')], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `terminal-${props.nodeName}-${Date.now()}.log`;
  a.click();
  URL.revokeObjectURL(url);
};

const toggleSettings = () => {
  showSettings.value = !showSettings.value;
};

const toggleFullscreen = () => {
  isFullscreen.value = !isFullscreen.value;
  
  // 🔹 延迟适配终端大小（等待 DOM 更新）
  nextTick(() => {
    activeTab.value?.fitAddon.fit();
  });
};

const handleClose = () => {
  // 关闭所有标签
  tabs.value.forEach(tab => {
    if (tab.ws) {
      tab.ws.close();
    }
    // 🔥 新增：释放 Noise 内存
    if (tab.cipher) {
      tab.cipher.destroy();
      tab.cipher = undefined;
    }
    tab.terminal.dispose();
  });
  tabs.value = [];
  activeTabId.value = '';
  
  emit('update:visible', false);
  emit('close');
};

// ============ 设置功能 ============
const updateFontSize = (size: number) => {
  settings.value.fontSize = size;
  tabs.value.forEach(tab => {
    tab.terminal.options.fontSize = size;
  });
  nextTick(() => {
    activeTab.value?.fitAddon.fit();
  });
};

const updateTheme = (theme: 'dark' | 'light') => {
  settings.value.theme = theme;
  localStorage.setItem('kisama_terminal_theme', theme);
  // DOM 渲染器下颜色由 .xterm-fg-N 的 CSS 类决定，
  // 已通过全局（非 scoped）样式在 .theme-light 下强制覆盖，
  // 因此只需更新终端主题，已有文字会自动随 CSS 变化，无需重建终端。
  const colors = TERMINAL_THEMES[theme];
  tabs.value.forEach(tab => {
    tab.terminal.options.theme = colors;
  });
};

// ============ 生命周期 ============
onMounted(() => {
  if (props.visible) {
    nextTick(() => {
      addTab();
    });
  }
});

onUnmounted(() => {
  // 清理所有 WebSocket 连接
  tabs.value.forEach(tab => {
    if (tab.ws) {
      tab.ws.close();
    }
    // 🔥 新增：释放 Noise 内存
    if (tab.cipher) {
      tab.cipher.destroy();
      tab.cipher = undefined;
    }
    tab.terminal.dispose();
  });
});

// ============ 智能调度器 ============
// 🔥 1. 监听传入节点的变化
watch(() => props.node, (newNode) => {
  if (!newNode || !props.visible) return;

  if (isMinimized.value) {
    isMinimized.value = false;
    nextTick(() => { 
      // 🚀 新增：解除最小化时释放缓存
      if (activeTab.value && activeTab.value.buffer.length > 0) {
        activeTab.value.buffer.forEach(data => activeTab.value!.terminal.write(data));
        activeTab.value.buffer = [];
      }
      activeTab.value?.fitAddon.fit(); 
    });
  }

  const existingTab = tabs.value.find(t => t.nodeId === newNode.id);
  if (existingTab) {
    switchTab(existingTab.id);
  } else {
    addTab();
  }
}, { deep: true }); 

// 🔥 2. 监听整个弹窗的显示/隐藏
watch(() => props.visible, (newVal) => {
  if (newVal) {
    isMinimized.value = false;
    nextTick(() => { 
      // 🚀 新增：弹窗唤醒时释放缓存
      if (activeTab.value && activeTab.value.buffer.length > 0) {
        activeTab.value.buffer.forEach(data => activeTab.value!.terminal.write(data));
        activeTab.value.buffer = [];
      }
      activeTab.value?.fitAddon.fit(); 
    });
    
    if (tabs.value.length === 0) {
      nextTick(() => { addTab(); });
    }
  }
});


// ============ 点击外部关闭设置面板 ============
const handleClickOutside = (event: MouseEvent) => {
  if (showSettings.value && settingsPanelRef.value && 
      !settingsPanelRef.value.contains(event.target as Node)) {
    showSettings.value = false;
  }
};

onMounted(() => {
  document.addEventListener('click', handleClickOutside);
});

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside);
  // 🔹 清理悬浮窗拖拽监听
  document.removeEventListener('mousemove', onWidgetDragMove);
  document.removeEventListener('mouseup', onWidgetDragEnd);
});

</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-show="visible && !isMinimized" class="terminal-modal" :class="{ fullscreen: isFullscreen, 'theme-light': settings.theme === 'light' }" ref="containerRef">
        <!-- 主容器 -->
        <div class="terminal-container">
          <!-- 顶部工具栏 -->
          <div class="toolbar">
            <!-- 左侧：标签页 -->
            <div class="toolbar-left">
              <div class="tabs">
                <div
                  v-for="tab in tabs"
                  :key="tab.id"
                  class="tab"
                  :class="{ active: tab.isActive }"
                  @click="switchTab(tab.id)"
                >
                  <span class="tab-name">{{ tab.name }}</span>
                  <button class="tab-close" @click.stop="closeTab(tab.id, $event)">
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                      <path d="M1 1L11 11M11 1L1 11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                    </svg>
                  </button>
                </div>
                <button class="tab-add" @click="addTab" title="新建标签">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M7 1V13M1 7H13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                  </svg>
                </button>
              </div>
            </div>
            
            <!-- 右侧：工具按钮 -->
            <div class="toolbar-right">
              <!-- 连接状态 -->
              <div class="status-badge" :class="currentConnectionStatus">
                <span class="status-dot"></span>
                <span class="status-text" :class="latencyClass">
                  {{ currentConnectionStatus === 'connected' ? 
                     (currentLatency === null ? '已连接' : `${currentLatency}ms`) : 
                     currentConnectionStatus === 'connecting' ? '连接中...' : 
                     currentConnectionStatus === 'error' ? '错误' : '未连接' }}
                </span>
              </div>
              
              <!-- Shell 类型 -->
              <div class="shell-type">
                Shell
              </div>
              
              <!-- 字体大小选择 -->
              <div class="font-size-selector">
                <select 
                  :value="settings.fontSize" 
                  @change="updateFontSize(Number(($event.target as HTMLSelectElement).value))"
                  class="font-size-select"
                >
                  <option v-for="size in fontSizeOptions" :key="size" :value="size">
                    {{ size }}px
                  </option>
                </select>
              </div>
              
              <!-- 清空日志 -->
              <button class="tool-btn" @click="clearTerminal" title="清空日志">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M2 4H14M5 4V2H11V4M3 4L4 14H12L13 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
              
              <!-- 导出日志 -->
              <button class="tool-btn" @click="exportLogs" title="导出日志">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M8 1V11M8 1L4 5M8 1L12 5M2 11V13C2 13.5523 2.44772 14 3 14H13C13.5523 14 14 13.5523 14 13V11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
              
              <!-- 设置 -->
              <div class="settings-wrapper" ref="settingsPanelRef">
                <button class="tool-btn" :class="{ active: showSettings }" @click="toggleSettings" title="设置">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M14 8C14 11.3137 11.3137 14 8 14C4.68629 14 2 11.3137 2 8C2 4.68629 4.68629 2 8 2C11.3137 2 14 4.68629 14 8Z" stroke="currentColor" stroke-width="1.5"/>
                    <circle cx="8" cy="8" r="2.5" fill="currentColor"/>
                  </svg>
                </button>
                
                <!-- 设置面板 -->
                <Transition name="dropdown">
                  <div v-if="showSettings" class="settings-panel">
                    <div class="settings-header">
                      <h3>终端设置</h3>
                    </div>
                    <div class="settings-content">
                      <div class="setting-item">
                        <span class="setting-label">版本号</span>
                        <span class="setting-value">{{ version }}</span>
                      </div>
                      <div class="setting-item">
                        <span class="setting-label">节点</span>
                        <span class="setting-value">{{ nodeName }}</span>
                      </div>
                      <div class="setting-item">
                        <span class="setting-label">字体大小</span>
                        <span class="setting-value">{{ settings.fontSize }}px</span>
                      </div>
                      <div class="setting-item">
                        <span class="setting-label">主题</span>
                        <div class="theme-toggle">
                          <button
                            class="theme-btn"
                            :class="{ active: settings.theme === 'dark' }"
                            @click="updateTheme('dark')"
                            title="深色"
                          >🌙</button>
                          <button
                            class="theme-btn"
                            :class="{ active: settings.theme === 'light' }"
                            @click="updateTheme('light')"
                            title="浅色"
                          >☀️</button>
                        </div>
                      </div>
                    </div>
                  </div>
                </Transition>
              </div>
              <!-- 🔹 新增：最小化按钮 -->
                <button class="tool-btn" @click="toggleMinimize" :title="isMinimized ? '还原终端' : '最小化'">
                <svg v-if="!isMinimized" width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M2 12H14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                </svg>
                <svg v-else width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M4 12L12 4M12 12V4H4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
              <!-- 全屏 -->
              <button class="tool-btn" @click="toggleFullscreen" :title="isFullscreen ? '退出全屏' : '全屏'">
                <svg v-if="!isFullscreen" width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M3 7V3H7M13 7V3H9M3 9V13H7M13 9V13H9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                <svg v-else width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M9 3H13V7M3 3H7V7M3 13H7V9M13 13H9V9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
              
              <!-- 关闭 -->
              <button class="tool-btn close-btn" @click="handleClose" title="关闭">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M1 1L15 15M15 1L1 15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                </svg>
              </button>
            </div>
          </div>
          
          <!-- 终端主体区域 -->
          <div class="terminal-body">
            
            <!-- 终端容器 -->
            <div class="terminal-wrapper">
              <div 
                v-for="tab in tabs" 
                :key="tab.id"
                :id="`terminal-container-${tab.id}`"
                v-show="tab.isActive"
                class="terminal-content"
                style="height: 100%; width: 100%;"
              ></div>
            </div>
          </div>
        </div>
      </div>
    </Transition>
     <!-- 2️⃣ 最小化悬浮组件 -->
        <Transition name="float">
            <div
              v-if="visible && isMinimized"
              ref="floatWidgetRef"
              class="terminal-float-widget"
              :class="{ 'theme-light': settings.theme === 'light', dragging: isDraggingWidget }"
              :style="{ left: widgetPos.left + 'px', bottom: widgetPos.bottom + 'px' }"
            >
            <div class="widget-header" @mousedown="onWidgetDragStart" title="按住拖动">
                <div class="widget-title-row">
                <span class="widget-icon">️</span>
                <span class="widget-title">{{ nodeName }}</span>
                </div>
                <div class="widget-actions">
                <button class="widget-btn" @click="toggleMinimize" title="还原窗口">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M2 10L10 2M10 10V2H2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                </button>
                <button class="widget-btn close" @click="handleClose" title="关闭终端">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M2 2L12 12M12 2L2 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                    </svg>
                </button>
                </div>
            </div>
            <div class="widget-status">
                <span class="status-dot" :class="currentConnectionStatus"></span>
                <span>{{ currentConnectionStatus === 'connected' ? '已连接' : '连接中...' }}</span>
            </div>
            </div>
        </Transition>
  </Teleport>
</template>

<style scoped>
/* ============ 模态框动画 ============ */
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.3s ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-active .terminal-container,
.modal-leave-active .terminal-container {
  transition: transform 0.3s ease;
}

.modal-enter-from .terminal-container,
.modal-leave-to .terminal-container {
  transform: scale(0.95);
}

/* ============ 下拉动画 ============ */
.dropdown-enter-active,
.dropdown-leave-active {
  transition: all 0.2s ease;
}

.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}

/* ============ 主容器 ============ */
.terminal-modal {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.terminal-modal.fullscreen {
  padding: 0;
}

.terminal-container {
  position: relative;
  width: 100%;
  max-width: 1400px;
  height: 80vh;
  min-height: 500px;
  background: #0d1117;
  border-radius: 12px;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  z-index: 1;
}

.terminal-modal.fullscreen .terminal-container {
  max-width: 100%;
  height: 100vh;
  border-radius: 0;
}

/* ============ 工具栏 ============ */
.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: #161b22;
  border-bottom: 1px solid #30363d;
  gap: 12px;
}

.toolbar-left {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
}

.tabs {
  display: flex;
  align-items: center;
  gap: 2px;
  overflow-x: auto;
  scrollbar-width: none;
}

.tabs::-webkit-scrollbar {
  display: none;
}

.tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: #21262d;
  border: 1px solid #30363d;
  border-bottom: none;
  border-radius: 6px 6px 0 0;
  color: #8b949e;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
}

.tab:hover {
  background: #30363d;
  color: #c9d1d9;
}

.tab.active {
  background: #0d1117;
  border-color: #30363d;
  color: #c9d1d9;
}

.tab-name {
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tab-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: 3px;
  color: #8b949e;
  cursor: pointer;
  opacity: 0.7;
  transition: all 0.15s;
}

.tab-close:hover {
  background: rgba(255, 255, 255, 0.1);
  opacity: 1;
  color: #f85149;
}

.tab-add {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  background: transparent;
  border: 1px dashed #30363d;
  border-radius: 6px;
  color: #8b949e;
  cursor: pointer;
  transition: all 0.15s;
  margin-left: 4px;
}

.tab-add:hover {
  background: #21262d;
  border-color: #8b949e;
  color: #c9d1d9;
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

/* ============ 状态徽章 ============ */
.status-badge {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  background: #21262d;
  border: 1px solid #30363d;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 500;
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #8b949e;
}

.status-badge.connected .status-dot {
  background: #3fb950;
  box-shadow: 0 0 0 2px rgba(63, 185, 80, 0.2);
}

.status-badge.connecting .status-dot {
  background: #d29922;
  animation: pulse 1.5s infinite;
}

.status-badge.error .status-dot {
  background: #f85149;
}

.status-badge.disconnected .status-dot {
  background: #8b949e;
}

/* ============ 延迟颜色 ============ */
.status-text.latency-good {
  color: #3fb950;
}

.status-text.latency-mid {
  color: #b8860b;
}

.status-text.latency-bad {
  color: #f85149;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

/* ============ Shell 类型 ============ */
.shell-type {
  padding: 4px 10px;
  background: #21262d;
  border: 1px solid #30363d;
  border-radius: 4px;
  font-size: 12px;
  color: #8b949e;
}

/* ============ 字体大小选择 ============ */
.font-size-selector {
  position: relative;
}

.font-size-select {
  padding: 4px 8px;
  background: #21262d;
  border: 1px solid #30363d;
  border-radius: 4px;
  color: #c9d1d9;
  font-size: 12px;
  cursor: pointer;
  outline: none;
}

.font-size-select:hover {
  border-color: #8b949e;
}

/* ============ 工具按钮 ============ */
.tool-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 6px;
  color: #8b949e;
  cursor: pointer;
  transition: all 0.15s;
}

.tool-btn:hover {
  background: #21262d;
  border-color: #30363d;
  color: #c9d1d9;
}

.tool-btn.active {
  background: #30363d;
  border-color: #8b949e;
  color: #c9d1d9;
}

.tool-btn.close-btn:hover {
  background: rgba(248, 81, 73, 0.1);
  border-color: rgba(248, 81, 73, 0.3);
  color: #f85149;
}

/* ============ 设置面板 ============ */
.settings-wrapper {
  position: relative;
}

.settings-panel {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  width: 240px;
  background: #161b22;
  border: 1px solid #30363d;
  border-radius: 8px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
  z-index: 1000;
  overflow: hidden;
}

.settings-header {
  padding: 12px 16px;
  border-bottom: 1px solid #30363d;
}

.settings-header h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: #c9d1d9;
}

.settings-content {
  padding: 12px 16px;
}

.setting-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 0;
  border-bottom: 1px solid #21262d;
}

.setting-item:last-child {
  border-bottom: none;
}

.setting-label {
  font-size: 13px;
  color: #8b949e;
}

.setting-value {
  font-size: 13px;
  color: #c9d1d9;
  font-weight: 500;
}

/* ============ 终端主体 ============ */
.terminal-body {
  flex: 1;
  display: flex;
  overflow: hidden;
}

/* ============ 侧边栏 ============ */
.sidebar {
  width: 200px;
  min-width: 200px;
  padding: 16px;
  background: #0d1117;
  border-right: 1px solid #30363d;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.sidebar-title {
  font-size: 14px;
  font-weight: 700;
  color: #58a6ff;
  letter-spacing: 0.5px;
}

.sidebar-divider {
  height: 1px;
  background: #30363d;
}

.sidebar-node {
  font-size: 13px;
  color: #8b949e;
  font-family: 'Courier New', monospace;
}

.sidebar-prompt {
  font-size: 13px;
  color: #c9d1d9;
  font-family: 'Courier New', monospace;
  font-weight: 600;
}

/* ============ 终端包装器 ============ */
.terminal-wrapper {
  flex: 1;
  padding: 12px;
  background: #0d1117;
  overflow: hidden;
}

.terminal-content {
  width: 100%;
  height: 100%;
}

/* ============ 悬浮组件样式 ============ */
.terminal-float-widget {
  position: fixed;
  bottom: 24px;
  left: 24px; /* 🔹 默认显示在屏幕左下角 */
  width: 260px;
  background: #161b22;
  border: 1px solid #30363d;
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  z-index: 10000;
  overflow: hidden;
  cursor: pointer;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

/* 🔹 拖拽中：禁用悬浮动画与文本选中 */
.terminal-float-widget.dragging {
  transform: none !important;
  user-select: none;
}

.terminal-float-widget:hover {
  transform: translateY(-2px);
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.6);
  border-color: #58a6ff;
}

.widget-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 12px;
  background: #0d1117;
  border-bottom: 1px solid #30363d;
  cursor: grab; /* 🔹 提示可拖动 */
  user-select: none;
}

.terminal-float-widget.dragging .widget-header {
  cursor: grabbing;
}

.widget-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.widget-icon { font-size: 14px; }
.widget-title {
  font-size: 13px;
  font-weight: 600;
  color: #c9d1d9;
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.widget-actions {
  display: flex;
  gap: 4px;
}

.widget-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: 4px;
  color: #8b949e;
  cursor: pointer;
  transition: all 0.15s;
}

.widget-btn:hover {
  background: #21262d;
  color: #c9d1d9;
}

.widget-btn.close:hover {
  background: rgba(248, 81, 73, 0.15);
  color: #f85149;
}

.widget-status {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  font-size: 12px;
  color: #8b949e;
  background: #161b22;
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #8b949e;
}
.status-dot.connected { background: #3fb950; box-shadow: 0 0 0 2px rgba(63, 185, 80, 0.2); }
.status-dot.connecting { background: #d29922; animation: pulse 1.5s infinite; }

/* ============ 过渡动画 ============ */
.float-enter-active,
.float-leave-active {
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.float-enter-from,
.float-leave-to {
  opacity: 0;
  transform: scale(0.9) translateY(10px);
}

/* ============ 主题切换按钮 ============ */
.theme-toggle {
  display: flex;
  gap: 4px;
}
.theme-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 24px;
  border: 1px solid #30363d;
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.15s;
  opacity: 0.5;
}
.theme-btn.active {
  opacity: 1;
  background: #21262d;
  border-color: #58a6ff;
}
.theme-btn:hover {
  opacity: 1;
}

/* ============ 浅色主题覆盖 ============ */
.theme-light .terminal-container {
  background: #ffffff;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.15);
}
.theme-light .toolbar {
  background: #f6f8fa;
  border-bottom-color: #d0d7de;
}
.theme-light .tab {
  background: #f6f8fa;
  border-color: #d0d7de;
  color: #656d76;
}
.theme-light .tab:hover {
  background: #eaeef2;
  color: #24292f;
}
.theme-light .tab.active {
  background: #ffffff;
  border-color: #d0d7de;
  color: #24292f;
}
.theme-light .tab-add {
  border-color: #d0d7de;
  color: #656d76;
}
.theme-light .tab-add:hover {
  background: #f6f8fa;
  border-color: #656d76;
  color: #24292f;
}
.theme-light .tab-close:hover {
  background: rgba(0, 0, 0, 0.06);
  color: #cf222e;
}
.theme-light .toolbar-right .status-badge {
  background: #f6f8fa;
  border-color: #d0d7de;
  color: #24292f;
}
.theme-light .status-text.latency-good {
  color: #1a7f37;
}
.theme-light .status-text.latency-mid {
  color: #9a6700;
}
.theme-light .status-text.latency-bad {
  color: #cf222e;
}
.theme-light .toolbar-right .shell-type {
  background: #f6f8fa;
  border-color: #d0d7de;
  color: #656d76;
}
.theme-light .font-size-select {
  background: #f6f8fa;
  border-color: #d0d7de;
  color: #24292f;
}
.theme-light .tool-btn {
  color: #656d76;
}
.theme-light .tool-btn:hover {
  background: #f6f8fa;
  border-color: #d0d7de;
  color: #24292f;
}
.theme-light .tool-btn.active {
  background: #eaeef2;
  border-color: #656d76;
  color: #24292f;
}
.theme-light .tool-btn.close-btn:hover {
  background: rgba(207, 34, 46, 0.08);
  border-color: rgba(207, 34, 46, 0.2);
  color: #cf222e;
}
.theme-light .terminal-wrapper {
  background: #ffffff;
}
.theme-light .settings-panel {
  background: #ffffff;
  border-color: #d0d7de;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.15);
}
.theme-light .settings-header {
  border-bottom-color: #d0d7de;
}
.theme-light .settings-header h3 {
  color: #24292f;
}
.theme-light .setting-item {
  border-bottom-color: #f6f8fa;
}
.theme-light .setting-label {
  color: #656d76;
}
.theme-light .setting-value {
  color: #24292f;
}
.theme-light .theme-btn {
  border-color: #d0d7de;
}
.theme-light .theme-btn.active {
  background: #f6f8fa;
  border-color: #0969da;
}
.theme-light .terminal-float-widget {
  background: #ffffff;
  border-color: #d0d7de;
}
.theme-light .widget-header {
  background: #f6f8fa;
  border-bottom-color: #d0d7de;
}
.theme-light .widget-title {
  color: #24292f;
}
.theme-light .widget-btn:hover {
  background: #f6f8fa;
  color: #24292f;
}
.theme-light .widget-status {
  background: #f6f8fa;
  color: #656d76;
}

/* ============ 响应式 ============ */
@media (max-width: 768px) {
  .terminal-modal {
    padding: 0;
  }
  
  .terminal-container {
    position: relative;
    width: 100%;
    max-width: 1400px;  /* 🔹 默认最大宽度 */
    height: 80vh;        /* 🔹 默认高度 80vh */
    min-height: 500px;
    background: #0d1117;
    border-radius: 12px;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    z-index: 1;
    }
    /* 🔹 全屏模式：占满整个视口 */
    .terminal-modal.fullscreen .terminal-container {
    max-width: 100%;     /* 🔹 移除最大宽度限制 */
    width: 100%;         /* 🔹 宽度 100% */
    height: 100vh;       /* 🔹 高度 100vh（整个视口） */
    min-height: 100vh;   /* 🔹 最小高度 100vh */
    border-radius: 0;    /* 🔹 移除圆角 */
    }

    /* 🔹 可选：如果希望全屏时保留顶部工具栏高度 */
    .terminal-modal.fullscreen .terminal-body {
    height: calc(100vh - 48px);  /* 减去工具栏高度 */
    }
  .sidebar {
    display: none;
  }
  
  .toolbar {
    flex-wrap: wrap;
  }
  
  .tabs {
    flex: 1;
  }
  
  .toolbar-right {
    width: 100%;
    justify-content: flex-end;
    margin-top: 8px;
  }
  
}
</style>

<!-- 浅色模式：强制覆盖 xterm DOM 渲染器的 ANSI 前景色（.xterm-fg-N 由 xterm 内部样式表注入，需非 scoped 全局覆盖） -->
<style>
.terminal-modal.theme-light .xterm-fg-1 { color: #cf222e !important; }
.terminal-modal.theme-light .xterm-fg-2 { color: #116329 !important; }
.terminal-modal.theme-light .xterm-fg-3 { color: #7c4a03 !important; }
.terminal-modal.theme-light .xterm-fg-4 { color: #0969da !important; }
.terminal-modal.theme-light .xterm-fg-5 { color: #8250df !important; }
.terminal-modal.theme-light .xterm-fg-6 { color: #0550ae !important; }
.terminal-modal.theme-light .xterm-fg-9 { color: #a40e26 !important; }
.terminal-modal.theme-light .xterm-fg-10 { color: #1a7f37 !important; }
.terminal-modal.theme-light .xterm-fg-11 { color: #9a6700 !important; }
.terminal-modal.theme-light .xterm-fg-12 { color: #0550ae !important; }
.terminal-modal.theme-light .xterm-fg-13 { color: #8250df !important; }
.terminal-modal.theme-light .xterm-fg-14 { color: #0550ae !important; }
.terminal-modal.theme-light .xterm-fg-15 { color: #24292e !important; }

/* ============ 终端滚动条配色（xterm-viewport 默认黑色滚动条，需全局覆盖） ============ */
/* 浅色主题：浅灰滚动条，与整体风格一致 */
.terminal-modal.theme-light .xterm-viewport {
  color-scheme: light;
  background-color: #f8f9fa !important;
}
.terminal-modal.theme-light .xterm-viewport::-webkit-scrollbar {
  width: 10px;
}
.terminal-modal.theme-light .xterm-viewport::-webkit-scrollbar-track {
  background: #f0f2f5;
}
.terminal-modal.theme-light .xterm-viewport::-webkit-scrollbar-thumb {
  background: #c9d1d9;
  border-radius: 6px;
  border: 2px solid #f0f2f5;
}
.terminal-modal.theme-light .xterm-viewport::-webkit-scrollbar-thumb:hover {
  background: #b0bac4;
}
.terminal-modal.theme-light .xterm-viewport {
  scrollbar-width: thin;
  scrollbar-color: #c9d1d9 #f0f2f5;
}

/* 深色主题：显式声明深色滚动条，避免跟随系统亮色模式时突兀 */
.terminal-modal:not(.theme-light) .xterm-viewport {
  color-scheme: dark;
}
.terminal-modal:not(.theme-light) .xterm-viewport::-webkit-scrollbar {
  width: 10px;
}
.terminal-modal:not(.theme-light) .xterm-viewport::-webkit-scrollbar-track {
  background: #0d1117;
}
.terminal-modal:not(.theme-light) .xterm-viewport::-webkit-scrollbar-thumb {
  background: #30363d;
  border-radius: 6px;
  border: 2px solid #0d1117;
}
.terminal-modal:not(.theme-light) .xterm-viewport::-webkit-scrollbar-thumb:hover {
  background: #484f58;
}
.terminal-modal:not(.theme-light) .xterm-viewport {
  scrollbar-width: thin;
  scrollbar-color: #30363d #0d1117;
}
</style>