<script setup lang="ts">
import { ref, reactive, computed, watch, onUnmounted } from 'vue'
import { AgentClient } from '../lib/agent-client'
import type { AgentNode, OnetimeTaskLog ,CronTaskLog } from '../types'
import { useNodes } from '../composables/useNodes'

const props = defineProps<{
  node: AgentNode
  visible: boolean
  globalConfig?: { ecdsaPrivateKey?: string; eciesPrivateKey?: string }
}>()

// -------------------- 配置加载保存--------------------
const { updateNode } = useNodes()

// 缓存每个节点的任务数据
interface TaskSnapshot {
  onetimeTasks: string[]
  cronTasks: Record<string, string>
  taskStatus: any
  logSummary: any
  onetimeLogs: OnetimeTaskLog[]
  cronLogs: CronTaskLog[]
}

const snapshotMap = new Map<string, TaskSnapshot>()
const client = ref<AgentClient | null>(null)
const loading = ref(false)
const activeTab = ref<'onetime' | 'cron'>('onetime')

// 当前显示的数据（从快照恢复或初始化）
const onetimeLogs = ref<OnetimeTaskLog[]>([])
const cronLogs = ref<CronTaskLog[]>([])

// ------ 💡 新增：日志展开/收起状态管理 ------
const expandedOnetimeLogs = ref<Record<number, boolean>>({})
const expandedCronLogs = ref<Record<number, boolean>>({})

function toggleOnetimeLog(idx: number) {
  expandedOnetimeLogs.value[idx] = !expandedOnetimeLogs.value[idx]
}

function toggleCronLog(idx: number) {
  expandedCronLogs.value[idx] = !expandedCronLogs.value[idx]
}
// ------------------------------------------

// 编辑状态（不需要缓存）
const editingOnetime = ref(false)
const editingCron = ref(false)
const onetimeText = ref('')
const cronText = ref('')
const cronInputExpr = ref('')
const cronInputCmd = ref('')
const logLimit = ref(50)

//-------------------- 是否为加密会话 --------------------
const encryptionStatus = computed(() => {
  if (!client.value) return '未连接'
  return client.value.Encryption ? '🔒 加密会话' : '🔓 明文传输'
})

// 保存当前节点数据到快照
function saveSnapshot(targetId?: string) {
  const nodeId = targetId || props.node?.id
  if (!nodeId) return
  
  snapshotMap.set(nodeId, {
    onetimeTasks: [...onetimeTasks.value],
    cronTasks: { ...cronTasks.value },
    taskStatus: taskStatus.value ? { ...taskStatus.value } : null,
    logSummary: logSummary.value ? { ...logSummary.value } : null,
    onetimeLogs: [...onetimeLogs.value],
    cronLogs: [...cronLogs.value],
  })
}

// 从快照恢复或初始化
function restoreSnapshot() {
  const nodeId = props.node.id
  const snap = snapshotMap.get(nodeId)
  if (snap) {
    onetimeTasks.value = snap.onetimeTasks
    cronTasks.value = snap.cronTasks
    taskStatus.value = snap.taskStatus
    logSummary.value = snap.logSummary
    onetimeLogs.value = snap.onetimeLogs
    cronLogs.value = snap.cronLogs
  } else {
    // 初始化空数据
    onetimeTasks.value = props.node.onetimeTasks || []
    cronTasks.value = props.node.cronTasks || {}
    taskStatus.value = null
    logSummary.value = null
    onetimeLogs.value = []
    cronLogs.value = []
  }
}

// 监听节点切换
watch(() => props.node?.id, async (newId, oldId) => {
  if (oldId) {
    saveSnapshot(oldId)
  }
  
  if (newId) {
    restoreSnapshot()
    editingOnetime.value = false
    editingCron.value = false
    
    // 切换节点时清空旧节点的展开状态
    expandedOnetimeLogs.value = {}
    expandedCronLogs.value = {}
    
    if (props.visible) {
      await initClient()
      await loadAllData()
    }
  }
})
// -------------------- -------------------------------
const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void
  (e: 'close'): void
}>()

// -------------------- 客户端与状态 --------------------
// 任务数据
const onetimeTasks = ref<string[]>([])
const cronTasks = ref<Record<string, string>>({})
const taskStatus = ref<any>(null)
const logSummary = ref<any>(null)

// -------------------- 初始化客户端 --------------------
async function initClient() {
  const ecdsaKey = props.node.ecdsaPrivateKey || props.globalConfig?.ecdsaPrivateKey || ''
  const eciesKey = props.node.eciesPrivateKey || props.globalConfig?.eciesPrivateKey || ''
  client.value = new AgentClient({
    domain: props.node.domain,
    eciesPrivateKey: eciesKey,
    ecdsaPrivateKey: ecdsaKey,
    timeout: 30000,
    Encryption: true
  })
  try {
    await client.value.getBaseInfo()
  } catch (e) {
    console.error('任务管理器初始化失败:', e)
  }
}

// 加载所有数据
async function loadAllData() {
  if (!client.value) return
  loading.value = true
  try {
    const [ot, ct, status, summary, otLogs, ctLogs] = await Promise.all([
      client.value.getOneTimeTasks(),
      client.value.getCronTasks(),
      client.value.getTaskStatus(),
      client.value.getLogSummary(),
      client.value.getOneTimeLogs(logLimit.value),
      client.value.getCronLogs(logLimit.value)
    ])

    const remoteOnetime = ot.tasks || []
    const remoteCron = ct.tasks || {}
    const isRemoteEmpty = remoteOnetime.length === 0 && Object.keys(remoteCron).length === 0

    if (!isRemoteEmpty) {
      onetimeTasks.value = remoteOnetime
      cronTasks.value = remoteCron 

      updateNode(props.node.id, {
        onetimeTasks: onetimeTasks.value,
        cronTasks: cronTasks.value
      })
      console.log('已同步远端任务数据到本地')
    } else {
      console.log('远端任务为空，保留本地已有记录')
    }

    taskStatus.value = status
    logSummary.value = summary
    onetimeLogs.value = (otLogs.logs as OnetimeTaskLog[]) || []
    cronLogs.value = (ctLogs.logs as CronTaskLog[]) || []

    // 💡 重新拉取数据时，重置展开状态，防止索引错位
    expandedOnetimeLogs.value = {}
    expandedCronLogs.value = {}

    saveSnapshot()  
  } catch (err: any) {
    console.error('加载任务数据失败:', err)
  } finally {
    loading.value = false
  }
}

// -------------------- 一次性任务操作 --------------------
function startEditOnetime() {
  onetimeText.value = onetimeTasks.value.join('\n')
  editingOnetime.value = true
}

async function saveOnetime() {
  const tasks = onetimeText.value.split('\n').map(s => s.trim()).filter(s => s)
  try {
    const res = await client.value!.setOneTimeTasks(tasks)
    onetimeTasks.value = res.tasks || []
    editingOnetime.value = false
    
    updateNode(props.node.id, { onetimeTasks: onetimeTasks.value })
    await loadAllData() 
  } catch (err: any) {
    alert(`保存失败: ${err.message}`)
  }
}

async function triggerOnetime() {
  if (!confirm('确定立即执行所有启动任务吗？')) return
  try {
    await client.value!.triggerOneTimeTasks()
    await loadAllData()
  } catch (err: any) {
    alert(`执行失败: ${err.message}`)
  }
}

// -------------------- 定时任务操作 --------------------
function startEditCron() {
  const lines = Object.entries(cronTasks.value).map(([expr, cmd]) => `${expr} ${cmd}`)
  cronText.value = lines.join('\n')
  editingCron.value = true
}

function validateCronExpr(expr: string): boolean {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return false
  
  const allowed = /^[0-9*,/-]+$/
  return parts.every(part => allowed.test(part))
}

function addCronTask() {
  const expr = cronInputExpr.value.trim()
  const cmd = cronInputCmd.value.trim()
  
  if (!expr || !cmd) {
    alert('请填写 Cron 表达式和命令')
    return
  }
  
  if (!validateCronExpr(expr)) {
    alert('Cron 表达式格式无效，请使用标准5位格式：分 时 日 月 周')
    return
  }
  
  cronTasks.value = { ...cronTasks.value, [expr]: cmd }
  cronInputExpr.value = ''
  cronInputCmd.value = ''
}

function removeCronTask(expr: string) {
  const newTasks = { ...cronTasks.value }
  delete newTasks[expr]
  cronTasks.value = newTasks
}

async function saveCron() {
  try {
    const res = await client.value!.setCronTasks(cronTasks.value)
    cronTasks.value = res.tasks || {}
    editingCron.value = false
    
    updateNode(props.node.id, { cronTasks: cronTasks.value })
    await loadAllData()
    console.log('定时任务已保存并同步状态')
  } catch (err: any) {
    alert(`保存失败: ${err.message}`)
  }
}

// -------------------- 日志操作 --------------------
async function clearLogs(type: 'onetime' | 'cron') {
  if (!confirm(`确定清空${type === 'onetime' ? '启动任务' : '定时任务'}日志吗？`)) return
  try {
    if (type === 'onetime') {
      await client.value!.clearOneTimeLogs()
      onetimeLogs.value = []
      expandedOnetimeLogs.value = {}
    } else {
      await client.value!.clearCronLogs()
      cronLogs.value = []
      expandedCronLogs.value = {}
    }
    await loadAllData()
  } catch (err: any) {
    alert(`清空失败: ${err.message}`)
  }
}

// -------------------- 工具函数 --------------------
function formatTimestamp(ts: string): string {
  try {
    return new Date(ts).toLocaleString('zh-CN')
  } catch {
    return ts
  }
}

function truncate(str: string, maxLen = 60): string {
  if (!str) return ''
  return str.length > maxLen ? str.slice(0, maxLen) + '…' : str
}

function close() {
  emit('update:visible', false)
  emit('close')
}

function editCronTask(expr: string, cmd: string) {
  cronInputExpr.value = expr
  cronInputCmd.value = cmd
  removeCronTask(expr)
}

// -------------------- 监听弹窗打开 --------------------
watch(() => props.visible, async (val) => {
  if (val) {
    restoreSnapshot()
    await initClient()
    await loadAllData()
  }
}, { immediate: true })

onUnmounted(() => {
  // 无需清理定时器
})

function refresh() {
  loadAllData()
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="visible" class="taskmanager-overlay" @click.self="close">
        <div class="taskmanager-modal">
          <div class="tm-header">
            <div class="tm-title">
              <span class="icon">📋</span>
              <span>{{ node.name }} - 任务管理</span>
            </div>
            <div class="tm-status">
              <span v-if="taskStatus?.cron?.active" class="badge active">⚡ 定时器运行中</span>
              <span v-else class="badge inactive">⏸️ 定时器已停止</span>
            </div>
            <button class="close-btn" @click="close">✕</button>
          </div>

          <div class="tm-tabs">
            <button 
              class="tab-btn" 
              :class="{ active: activeTab === 'onetime' }"
              @click="activeTab = 'onetime'"
            >
              🚀 启动任务 ({{ onetimeTasks.length }})
            </button>
            <button 
              class="tab-btn" 
              :class="{ active: activeTab === 'cron' }"
              @click="activeTab = 'cron'"
            >
              ⏰ 定时任务 ({{ Object.keys(cronTasks).length }})
            </button>
            <span class="spacer"></span>
            <button class="refresh-btn" @click="refresh" :disabled="loading">🔄</button>
          </div>

          <div class="tm-content">
            <div v-if="loading" class="loading">加载中...</div>

            <div v-else-if="activeTab === 'onetime'" class="tab-pane">
              <div class="section">
                <div class="section-header">
                  <h3>任务列表</h3>
                  <div class="actions">
                    <button v-if="!editingOnetime" class="btn small" @click="startEditOnetime">✏️ 编辑</button>
                    <button v-else class="btn small primary" @click="saveOnetime">💾 保存</button>
                    <button v-if="editingOnetime" class="btn small" @click="editingOnetime = false">取消</button>
                    <button class="btn small" @click="triggerOnetime">▶️ 立即执行</button>
                  </div>
                </div>
                <div v-if="!editingOnetime" class="task-list">
                  <div v-if="onetimeTasks.length === 0" class="empty">暂无启动任务</div>
                  <div v-for="(cmd, idx) in onetimeTasks" :key="idx" class="task-item">
                    <code>{{ cmd }}</code>
                  </div>
                </div>
                <textarea v-else v-model="onetimeText" class="task-editor" placeholder="每行一个命令" rows="8"></textarea>
              </div>

              <div class="section">
                <div class="section-header">
                  <h3>执行日志 (最近 {{ onetimeLogs.length }} 条)</h3>
                  <button class="btn small" @click="clearLogs('onetime')">🗑️ 清空</button>
                </div>
                <div class="log-list">
                  <div v-if="onetimeLogs.length === 0" class="empty">暂无日志</div>
                  <div v-for="(log, idx) in onetimeLogs" :key="idx" class="log-item" :class="{ failed: log.exitcode !== 0 }">
                    <div class="log-header">
                      <span class="log-time">{{ formatTimestamp(log.ts) }}</span>
                      <span class="log-exitcode">退出码: {{ log.exitcode }}</span>
                    </div>
                    <div class="log-cmd">{{ log.cmd }}</div>
                    
                    <pre v-if="log.output" class="log-output">{{ expandedOnetimeLogs[idx] ? log.output : truncate(log.output, 200) }}</pre>
                    <div v-if="log.output && log.output.length > 200" class="log-toggle" @click="toggleOnetimeLog(idx)">
                      {{ expandedOnetimeLogs[idx] ? '🔼 收起全文' : '🔽 展开全文' }}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div v-else class="tab-pane">
              <div class="section">
                <div class="section-header">
                  <h3>Cron 任务列表</h3>
                  <div class="actions">
                    <button v-if="!editingCron" class="btn small" @click="startEditCron">✏️ 编辑</button>
                    <button v-else class="btn small" @click="saveCron">💾 保存</button>
                    <button v-if="editingCron" class="btn small" @click="editingCron = false">取消</button>
                  </div>
                </div>
                <div v-if="!editingCron" class="cron-list">
                  <div v-if="Object.keys(cronTasks).length === 0" class="empty">暂无定时任务</div>
                  <div v-for="(cmd, expr) in cronTasks" :key="expr" class="cron-item">
                    <span class="cron-expr">{{ expr }}</span>
                    <code class="cron-cmd">{{ cmd }}</code>
                  </div>
                </div>
                <div v-else class="cron-editor">
                  <div class="cron-add">
                    <input v-model="cronInputExpr" placeholder="Cron 表达式 (如 */5 * * * *)" />
                    <input v-model="cronInputCmd" placeholder="命令" />
                    <button class="btn small add-btn" @click="addCronTask">➕ 添加</button>
                  </div>
                  <div class="cron-editor-list">
                    <div v-for="(cmd, expr) in cronTasks" :key="expr" class="cron-editor-item">
                      <span>{{ expr }}</span>
                      <code>{{ cmd }}</code>
                       <div class="item-actions">
                        <button class="btn-icon" @click="editCronTask(expr, cmd)" title="编辑">✏️</button>
                        <button class="btn-icon" @click="removeCronTask(expr)">✕</button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div class="section">
                <div class="section-header">
                  <h3>执行日志 (最近 {{ cronLogs.length }} 条)</h3>
                  <button class="btn small" @click="clearLogs('cron')">🗑️ 清空</button>
                </div>
                <div class="log-list">
                  <div v-if="cronLogs.length === 0" class="empty">暂无日志</div>
                  <div v-for="(log, idx) in cronLogs" :key="idx" class="log-item" :class="{ failed: log.exitcode !== 0 }">
                    <div class="log-header">
                      <span class="log-time">{{ formatTimestamp(log.ts) }}</span>
                      <span class="log-cron">{{ log.cron }}</span>
                      <span class="log-exitcode">退出码: {{ log.exitcode }}</span>
                    </div>
                    <div class="log-cmd">{{ log.cmd }}</div>
                    
                    <pre v-if="log.output" class="log-output">{{ expandedCronLogs[idx] ? log.output : truncate(log.output, 200) }}</pre>
                    <div v-if="log.output && log.output.length > 200" class="log-toggle" @click="toggleCronLog(idx)">
                      {{ expandedCronLogs[idx] ? '🔼 收起全文' : '🔽 展开全文' }}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="tm-footer">
            <span v-if="logSummary">
              启动任务: {{ logSummary.onetime?.total_logged || 0 }}/{{ logSummary.onetime?.max_capacity || 100 }} 条日志
              | 定时任务: {{ logSummary.cron?.total_logged || 0 }}/{{ logSummary.cron?.max_capacity || 100 }} 条日志
            </span>
            <span class="encryption-status" :class="{ encrypted: client?.Encryption }">
              {{ encryptionStatus }}
            </span>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* 整体模态框 */
.taskmanager-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.5);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1001;
  padding: 20px;
}
.taskmanager-modal {
  width: 95%;
  max-width: 1000px;
  height: 85vh;
  background: var(--card);
  border-radius: 20px;
  box-shadow: 0 20px 40px rgba(0,0,0,0.2);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: var(--text);
}
.tm-header {
  display: flex;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
}
.tm-title {
  font-size: 1.2rem;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
}
.tm-status {
  margin-left: 20px;
}
.badge {
  padding: 4px 10px;
  border-radius: 20px;
  font-size: 0.8rem;
  font-weight: 500;
}
.badge.active {
  background: var(--chip-online-bg);
  color: var(--chip-online-text);
}
.badge.inactive {
  background: var(--surface-2);
  color: var(--muted);
}
.close-btn {
  margin-left: auto;
  background: none;
  border: none;
  font-size: 1.5rem;
  cursor: pointer;
  color: var(--muted);
}
.tm-tabs {
  display: flex;
  align-items: center;
  padding: 8px 20px;
  border-bottom: 1px solid var(--border);
  background: var(--surface-2);
}
.tab-btn {
  padding: 8px 16px;
  border: none;
  background: none;
  font-weight: 500;
  color: var(--muted);
  border-bottom: 2px solid transparent;
  cursor: pointer;
}
.tab-btn.active {
  color: var(--primary);
  border-bottom-color: var(--primary);
}
.spacer { flex: 1; }
.refresh-btn {
  background: none;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  padding: 6px 12px;
  cursor: pointer;
  color: var(--text);
}
.tm-content {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}
.tab-pane {
  display: flex;
  flex-direction: column;
  gap: 24px;
}
.section {
  background: var(--surface-2);
  border-radius: 12px;
  padding: 16px;
  border: 1px solid var(--border);
}
.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.section-header h3 {
  font-size: 1rem;
  font-weight: 600;
}
.actions {
  display: flex;
  gap: 8px;
}
.btn.small {
  padding: 4px 12px;
  font-size: 0.8rem;
}
.task-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.task-item {
  background: var(--btn-bg);
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid var(--border);
}
.task-editor {
  width: 100%;
  padding: 12px;
  font-family: monospace;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  resize: vertical;
  background: var(--btn-bg);
  color: var(--text);
}
.cron-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.cron-item {
  display: flex;
  align-items: center;
  gap: 16px;
  background: var(--btn-bg);
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid var(--border);
}
.cron-expr {
  font-family: monospace;
  font-weight: 600;
  min-width: 120px;
}
.cron-cmd {
  font-family: monospace;
  color: var(--text);
}
.cron-editor {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.cron-add {
  display: flex;
  gap: 8px;
}
.cron-add input {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  background: var(--btn-bg);
  color: var(--text);
}
.cron-editor-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.cron-editor-item {
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--btn-bg);
  padding: 6px 12px;
  border-radius: 8px;
}
.btn-icon {
  margin-left: auto;
  background: none;
  border: none;
  color: var(--danger);
  cursor: pointer;
}
.log-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: 300px;
  overflow-y: auto;
}
.log-item {
  background: var(--btn-bg);
  padding: 12px;
  border-radius: 8px;
  border-left: 4px solid var(--success);
  font-size: 0.85rem;
}
.log-item.failed {
  border-left-color: var(--danger);
}
.log-header {
  display: flex;
  gap: 16px;
  margin-bottom: 4px;
  color: var(--muted);
}
.log-cmd {
  font-family: monospace;
  margin-bottom: 6px;
}
.log-output {
  background: var(--surface-3);
  padding: 8px;
  border-radius: 6px;
  white-space: pre-wrap;
  word-break: break-all;
  font-family: monospace;
  margin: 0;
  color: var(--text-soft);
}

/* 💡 新增：日志收起/展开控制按钮样式 */
.log-toggle {
  text-align: right;
  font-size: 0.75rem;
  color: var(--primary);
  cursor: pointer;
  margin-top: 6px;
  user-select: none;
  font-weight: 500;
}
.log-toggle:hover {
  color: var(--primary-hover);
  text-decoration: underline;
}

.empty {
  text-align: center;
  color: var(--muted);
  padding: 20px;
}
.tm-footer {
  padding: 8px 20px;
  border-top: 1px solid var(--border);
  background: var(--surface-2);
  font-size: 0.8rem;
  color: var(--muted);
  display: flex;
  justify-content: space-between;
}
.loading {
  text-align: center;
  padding: 40px;
}
.modal-enter-active, .modal-leave-active { transition: opacity 0.2s; }
.modal-enter-from, .modal-leave-to { opacity: 0; }

.add-btn {
  background: var(--chip-syncing-bg);
  border: 1px solid var(--border-strong);
  color: var(--text);
  font-weight: 500;
}
.add-btn:hover {
  background: rgba(59, 130, 246, 0.18);
  border-color: rgba(59, 130, 246, 0.4);
}

.item-actions {
  display: flex;
  gap: 4px;
  margin-left: auto;
}
.btn-icon {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 0.9rem;
  padding: 4px 6px;
  border-radius: 4px;
  color: var(--muted);
}
.btn-icon:hover {
  background: var(--surface-3);
  color: var(--text);
}

.encryption-status {
  margin-left: auto;
  font-weight: 500;
}
.encryption-status.encrypted {
  color: var(--success);
}
</style>