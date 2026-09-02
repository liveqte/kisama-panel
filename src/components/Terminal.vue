<!-- src/components/Terminal.vue -->
<script setup lang="ts">
import { ref, nextTick, onMounted, watch, onUnmounted } from 'vue'
import { AgentClient } from '../lib/agent-client'
import type { AgentNode } from '../types'

interface OutputLine {
  type: 'command' | 'result' | 'error' | 'info'
  content: string
  timestamp?: number
}

// ==================== 🔒 核心修复：独立会话状态矩阵 ====================
const clientMap = new Map<string, AgentClient | null>()
const historyMap = new Map<string, OutputLine[]>()
// 💡 ✨【新增】：按节点隔离的“命令历史”（仅存命令，不存输出），供 ↑/↓ 翻阅
const commandHistoryMap = new Map<string, string[]>()

// 视图层激活状态绑定（仅对准当前 UI 选中的节点）
const client = ref<AgentClient | null>(null)
const outputLines = ref<OutputLine[]>([])

const inputCommand = ref('')
const isExecuting = ref(false)
const outputContainer = ref<HTMLElement | null>(null)
const inputRef = ref<HTMLInputElement | null>(null)
// 💡 ✨【新增】：历史翻阅游标。-1 表示位于“新输入”位置（未翻阅）
const historyIndex = ref<number>(-1)

const countdown = ref(30)
let countdownTimer: ReturnType<typeof setInterval> | null = null

const props = defineProps<{
  node: AgentNode
  visible: boolean
  globalConfig?: { ecdsaPrivateKey?: string; eciesPrivateKey?: string }
}>()

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void
  (e: 'close'): void
}>()

/**
 * 💡 ✨【会话沙箱加固 1】：严格基于节点 ID 追溯的安全日志追加器
 * 刚性隔离物理数组引用，100% 杜绝 A 节点的初始化失败日志飘到 B 节点屏幕上
 */
function addNodeLine(nodeId: string, type: OutputLine['type'], content: string) {
  if (!nodeId) return;

  if (!historyMap.has(nodeId)) {
    historyMap.set(nodeId, [
      { type: 'info', content: `已连接到 ${props.node.name} (${props.node.domain})` },
      { type: 'info', content: '输入命令后按回车执行，仅支持非交互式命令。' },
      { type: 'info', content: '' }
    ]);
  }

  const lines = historyMap.get(nodeId)!;
  lines.push({ type, content, timestamp: Date.now() });

  // 联动刷新：只有当被追加的节点正是当前用户在屏幕上看到的节点时，才同步推给 ref 渲染
  if (props.node?.id === nodeId) {
    // 💡 ✨【绝杀修复点】：通过 [...lines] 产生全新数组指针，强行逼迫 Vue 立即全量刷新终端屏幕
    outputLines.value = [...lines];
    scrollToBottom();
  }
}

/**
 * 💡 ✨【会话沙箱加固 2】：异步隔离型独立会话建立引擎
 * 捕获调用那一瞬间的 targetNodeId 闭包，运行时完全脱离对外部易变 ref 的依赖
 */
async function initTerminalClient(targetNode: AgentNode) {
  const targetNodeId = targetNode.id;
  
  // 析构清理：若该节点之前存在旧客户端，执行销毁并从矩阵中重置
  if (clientMap.has(targetNodeId)) {
    clientMap.get(targetNodeId)?.destroy?.();
    clientMap.set(targetNodeId, null);
    if (props.node?.id === targetNodeId) {
      client.value = null;
    }
  }
  
  const ecdsaKey = targetNode.ecdsaPrivateKey || props.globalConfig?.ecdsaPrivateKey || '';
  const eciesKey = targetNode.eciesPrivateKey || props.globalConfig?.eciesPrivateKey || '';

  if (!ecdsaKey) {
    addNodeLine(targetNodeId, 'error', '[初始化失败] 未配置 ECDSA 私钥，请在全局设置或节点高级设置中填写');
    return;
  }

  const newClient = new AgentClient({
    domain: targetNode.domain,
    eciesPrivateKey: eciesKey,
    ecdsaPrivateKey: ecdsaKey,
    timeout: 30000,
    Encryption: true
  });

  try {
    const baseInfo = await newClient.getBaseInfo();
    
    if (newClient.Encryption && (!baseInfo || !baseInfo.session_key)) {
      throw new Error('密码学握手失败：中转解密异常或服务端 Session Key 缺失');
    }

    // 认证通过，将新实例稳稳送入该节点的专属会话槽位
    clientMap.set(targetNodeId, newClient);
    
    // 如果握手成功后，用户还没切换走，则同步刷新当前激活的客户端 ref 供立即发送命令
    if (props.node?.id === targetNodeId) {
      client.value = newClient;
    }

    if (newClient.Encryption) {
      addNodeLine(targetNodeId, 'info', '✅ 加密会话已成功建立');
    } else {
      addNodeLine(targetNodeId, 'info', '✅ 明文会话已建立');
    }
  } catch (err: any) {
    addNodeLine(targetNodeId, 'error', `[初始化失败] ${err.message}`);
  }
}

/**
 * 💡 ✨【会话沙箱加固 3】：动态路由激活切换器
 */
function loadOrCreateHistory(nodeId: string) {
  if (!nodeId) return; 
  
  if (!historyMap.has(nodeId)) {
    historyMap.set(nodeId, [
      { type: 'info', content: `已连接到 ${props.node.name} (${props.node.domain})` },
      { type: 'info', content: '输入命令后按回车执行，仅支持非交互式命令。' },
      { type: 'info', content: '' }
    ]);
  }
  
  // 💡 ✨【同步加固】：换轨时同样投喂新克隆指针，确保响应式链条绝对紧绷
  outputLines.value = [...historyMap.get(nodeId)!];
  client.value = clientMap.get(nodeId) || null;
  
  // 💡 ✨【新增】：切换节点时硬性归零历史翻阅游标，避免跨节点串味
  historyIndex.value = -1;
  
  scrollToBottom();
}
// 🔄 修改后（引入新旧状态对比，破除过期 session_key 缓存死锁）：
watch(
  [() => props.node?.id, () => props.visible],
  ([newId, isVisible], oldValues) => {
    // 💡 提取上一轮的可见性状态（首次执行时 oldValues 为 undefined，用空数组兜底）
    const [, oldIsVisible] = oldValues || [];

    if (newId && isVisible) {
      console.log(`[Terminal] 激活独立会话轨道: ${props.node.name} (ID: ${newId})`);
      
      // 1. 先让视图无缝平滑切入该节点的历史画面和实例
      loadOrCreateHistory(newId);

      // 🎯 2. 【核心修复点】：判断窗口是否是“刚刚被重新打开”
      const isWindowJustOpened = isVisible && !oldIsVisible;

      // 槽位为空（初次连接） OR 窗口被重新打开（会话可能已变动），都刚性触发重连刷新 session_key
      if (!clientMap.get(newId) || isWindowJustOpened) {
        initTerminalClient(props.node);
      }
      
      nextTick(() => inputRef.value?.focus());
    }
  },
  { immediate: true }
);

function clearCountdown() {
  if (countdownTimer) {
    clearInterval(countdownTimer)
    countdownTimer = null
  }
  countdown.value = 30
}

function startCountdown() {
  countdown.value = 30
  countdownTimer = setInterval(() => {
    if (countdown.value > 0) {
      countdown.value--
    } else {
      clearCountdown()
    }
  }, 1000)
}

async function scrollToBottom() {
  await nextTick()
  if (outputContainer.value) outputContainer.value.scrollTop = outputContainer.value.scrollHeight
}

async function executeCommand(cmd: string) {
  const targetNodeId = props.node?.id;
  if (!targetNodeId || !cmd.trim()) return;
  
  // 刚性提取当前映射矩阵中的专属实例进行发射，绝不使用错位残留的实例
  const activeClient = clientMap.get(targetNodeId);
  if (!activeClient) {
    addNodeLine(targetNodeId, 'error', '[拦截] 密码学管道未就绪，请等待握手成功或重新打开终端');
    return;
  }
  
  addNodeLine(targetNodeId, 'command', `${props.node.name}> ${cmd}`)
  isExecuting.value = true
  startCountdown()

  // 💡 ✨【新增】：将本次命令写入当前节点的命令历史（与节点 ID 隔离）
  // 仅在末尾已存在不同命令时才追加，避免连续重复命令堆叠
  const cmdHist = commandHistoryMap.get(targetNodeId) || [];
  if (cmdHist[cmdHist.length - 1] !== cmd) cmdHist.push(cmd);
  commandHistoryMap.set(targetNodeId, cmdHist);
  // 执行后游标复位到“新输入”位置，下一次 ↑ 从最新命令开始
  historyIndex.value = -1;

  try {
    const response = await activeClient.exec(cmd) as any;
    
    // 💡 ✨【核心新增】：硬拦截并提示 401、500 等由网关、中间件或后端抛出的非标准执行异常结构体
    if (response && (response.error || response.status === 'error')) {
      const systemError = response.error || response.message || '未知系统级别异常';
      addNodeLine(targetNodeId, 'error', `[服务器响应异常] ${systemError}`);
      return;
    }

    // 正常命令回显流
    if (response.result) addNodeLine(targetNodeId, 'result', response.result)
    
    const exitCode = response.exitcode !== undefined ? response.exitcode : 0
    if (exitCode !== 0) addNodeLine(targetNodeId, 'error', `[命令退出码: ${exitCode}]`)
    
    if (response.timeout) addNodeLine(targetNodeId, 'error', '[命令执行超时]')
  } catch (err: any) {
    const isTimeout = err.name === 'AbortError' || 
                      err.message?.toLowerCase().includes('timeout') ||
                      err.message?.toLowerCase().includes('abort')
    if (isTimeout) {
      addNodeLine(targetNodeId, 'error', '[错误] 命令执行超时（30秒）')
    } else {
      // 💡 ✨【核心修复】：同时修正了上一版本中误用全局不确定引用 addLine 的冷场 Bug，全面看齐沙箱安全线
      addNodeLine(targetNodeId, 'error', `[网络物理断开] ${err.message || '无法建立与远程探针的通信'}`)
    }
  } finally {
    clearCountdown()
    isExecuting.value = false
    inputCommand.value = ''
    await nextTick()
    inputRef.value?.focus()
    scrollToBottom()
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !isExecuting.value) {
    e.preventDefault()
    const cmd = inputCommand.value.trim()
    if (cmd) executeCommand(cmd)
    return
  }

  // 💡 ✨【新增】：↑/↓ 翻阅当前节点的命令历史
  if (isExecuting.value) return
  const nodeId = props.node?.id || ''
  const hist = commandHistoryMap.get(nodeId) || []

  if (e.key === 'ArrowUp') {
    e.preventDefault()
    if (hist.length === 0) return
    // -1（新输入位）时从最后一条开始；否则上移一条
    if (historyIndex.value === -1) {
      historyIndex.value = hist.length - 1
    } else if (historyIndex.value > 0) {
      historyIndex.value--
    }
    inputCommand.value = hist[historyIndex.value]
  } else if (e.key === 'ArrowDown') {
    e.preventDefault()
    if (hist.length === 0 || historyIndex.value === -1) return
    if (historyIndex.value < hist.length - 1) {
      historyIndex.value++
      inputCommand.value = hist[historyIndex.value]
    } else {
      // 已到最旧一条的再下一条：回到空白“新输入”位
      historyIndex.value = -1
      inputCommand.value = ''
    }
  }
}

function close() {
  emit('update:visible', false)
  emit('close')
}

function clearScreen() {
  const targetNodeId = props.node?.id;
  if (!targetNodeId) return;
  historyMap.set(targetNodeId, []);
  addNodeLine(targetNodeId, 'info', '屏幕已清空');
}

onMounted(() => {
  if (props.visible && props.node?.id) loadOrCreateHistory(props.node.id)
})

onUnmounted(() => {
  clearCountdown()
})
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="visible" class="terminal-overlay" @click.self="close">
        <div class="terminal-modal">
          <div class="terminal-header">
            <div class="header-left">
              <span class="terminal-icon">🖥️</span>
              <span class="terminal-title">{{ node.name }} - 终端</span>
            </div>
            <div class="header-right">
              <button class="clear-btn" @click="clearScreen" title="清屏">🗑️</button>
              <button class="close-btn" @click="close" title="关闭">✕</button>
            </div>
          </div>
          <div class="terminal-output" ref="outputContainer">
            <div v-for="(line, idx) in outputLines" :key="idx" class="output-line">
              <span v-if="line.type === 'command'" class="command-line">{{ line.content }}</span>
              <pre v-else-if="line.type === 'result'" class="result-line">{{ line.content }}</pre>
              <span v-else-if="line.type === 'error'" class="error-line">{{ line.content }}</span>
              <span v-else class="info-line">{{ line.content }}</span>
            </div>
            <div v-if="isExecuting" class="executing-indicator">
              <span class="spinner"></span> 执行中 (剩余 {{ countdown }} 秒)...
            </div>
          </div>
          <div class="terminal-input-area">
            <span class="prompt">{{ node.name }}&gt;</span>
            <input
              ref="inputRef"
              v-model="inputCommand"
              type="text"
              class="command-input"
              :disabled="isExecuting"
              @keydown="handleKeydown"
              placeholder="输入命令..."
              autofocus
            />
          </div>
          <div class="terminal-footer">
            <span class="hint">回车执行 · ↑/↓ 翻阅本节点历史命令 · 不支持交互式程序 (如 nano) · 超时 30 秒</span>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>


<style scoped>
.terminal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1001;
  padding: 20px;
}

.terminal-modal {
  width: 100%;
  max-width: 900px;
  height: 80vh;
  max-height: 700px;
  background: #0d1117;
  border: 1px solid #30363d;
  border-radius: 16px;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.terminal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: #161b22;
  border-bottom: 1px solid #30363d;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.terminal-icon {
  font-size: 1.2rem;
}

.terminal-title {
  font-weight: 600;
  color: #f0f6fc;
}

.header-right {
  display: flex;
  gap: 8px;
}

.clear-btn, .close-btn {
  background: transparent;
  border: none;
  color: #8b949e;
  font-size: 1.2rem;
  cursor: pointer;
  width: 32px;
  height: 32px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
}

.clear-btn:hover, .close-btn:hover {
  background: #30363d;
  color: #f0f6fc;
}

.terminal-output {
  flex: 1;
  padding: 16px;
  overflow-y: auto;
  font-family: 'SF Mono', 'Menlo', 'Monaco', 'Cascadia Code', 'Consolas', monospace;
  font-size: 14px;
  line-height: 1.5;
  color: #e6edf3;
  background: #0d1117;
  white-space: pre-wrap;
  word-break: break-all;
}

.output-line {
  margin-bottom: 4px;
}

.command-line {
  color: #58a6ff;
}

.result-line {
  margin: 4px 0 8px 0;
  color: #e6edf3;
  font-family: inherit;
  white-space: pre-wrap;
}

.error-line {
  color: #f85149;
}

.info-line {
  color: #8b949e;
  font-style: italic;
}

.executing-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #8b949e;
  margin-top: 8px;
}

.spinner {
  width: 14px;
  height: 14px;
  border: 2px solid #30363d;
  border-top-color: #58a6ff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.terminal-input-area {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  background: #161b22;
  border-top: 1px solid #30363d;
  border-bottom: 1px solid #30363d;
}

.prompt {
  color: #3fb950;
  font-weight: 600;
  font-family: monospace;
  margin-right: 10px;
}

.command-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  color: #f0f6fc;
  font-family: monospace;
  font-size: 14px;
  padding: 4px 0;
}

.command-input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.terminal-footer {
  padding: 8px 16px;
  background: #161b22;
  color: #8b949e;
  font-size: 0.75rem;
  text-align: right;
}

/* 过渡动画 */
.modal-enter-active, .modal-leave-active {
  transition: opacity 0.2s ease;
}
.modal-enter-from, .modal-leave-to {
  opacity: 0;
}
.modal-enter-active .terminal-modal {
  transition: transform 0.2s ease;
}
.modal-enter-from .terminal-modal {
  transform: scale(0.95) translateY(10px);
}
.modal-leave-to .terminal-modal {
  transform: scale(0.95) translateY(10px);
}
</style>