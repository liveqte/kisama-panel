<script setup lang="ts">
import { ref, watch, computed, onMounted } from 'vue';
import DialogModal from './DialogModal.vue';
import { AgentClient } from '../lib/agent-client';
import type { AgentNode } from '../types';

// ==================== 1. 契约定义 ====================
const props = defineProps<{
  visible: boolean;
  node: AgentNode;
  globalConfig: { ecdsaPrivateKey?: string; eciesPrivateKey?: string };
}>();

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void;
  (e: 'confirm', payload: { agentType: string; primaryFile: string; secondaryFile?: string }): void;
  (e: 'cancel'): void;
}>();

// ==================== 2. 状态保持变量 ====================
const isLoading = ref(false);
const errorMsg = ref('');
const remoteFiles = ref<string[]>([]);
const detectedType = ref<'nodejs' | 'python' | 'go' | 'java' | 'unknown'>('unknown');

const selectedPrimaryFile = ref('');   // 主脚本/二进制
const selectedSecondaryFile = ref(''); // 配套依赖环境

// 远程 file 浏览器相关状态保持
const showFilePicker = ref(false);
const pickerPath = ref('./');
const pickerFiles = ref<any[]>([]);
const isPickerLoading = ref(false);
const pickerPathHistory = ref<string[]>([]);

// 💡 ✨ 规范的分布式多环境文件夹定性函数
const isDirectory = (file: any) => {
  if (!file) return false;
  const t = String(file.type || '').toLowerCase();
  return t === 'dir' || t === 'directory';
};

// ==================== 3. 核心计算属性 ====================
const filteredPrimaryOptions = computed(() => {
  const list = remoteFiles.value;
  switch (detectedType.value) {
    case 'nodejs':
      return list.filter(name => name.endsWith('.js'));
    case 'python':
      return list.filter(name => name.endsWith('.py'));
    case 'go':
      return list.filter(name => !name.includes('.') && !['makefile', 'readme', 'license', 'go.mod', 'go.sum'].includes(name.toLowerCase()));
    case 'java':
      return list.filter(name => name.endsWith('.jar'));
    default:
      return list;
  }
});

// ==================== 4. 多维自适应环境探测与资产列表拉取 ====================
const probeRemoteEnvironment = async () => {
  if (!props.visible || !props.node) return;

  isLoading.value = true;
  errorMsg.value = '';
  remoteFiles.value = [];
  detectedType.value = 'unknown';
  selectedPrimaryFile.value = '';
  selectedSecondaryFile.value = '';

  const versionStr = props.node.baseinfo?.version || '';
  if (versionStr.includes('-')) {
    const suffix = versionStr.split('-').slice(1).join('-').toLowerCase();
    if (suffix === 'js' || suffix === 'nodejs') {
      detectedType.value = 'nodejs';
    } else if (suffix === 'py' || suffix === 'python') {
      detectedType.value = 'python';
    } else if (suffix === 'go') {
      detectedType.value = 'go';
    } else if (suffix === 'java') {
      detectedType.value = 'java';
    }
  }

  try {
    const ecdsaKey = props.node.ecdsaPrivateKey || props.globalConfig.ecdsaPrivateKey || '';
    const eciesKey = props.node.eciesPrivateKey || props.globalConfig.eciesPrivateKey || '';
    
    const client = new AgentClient({
      domain: props.node.domain,
      eciesPrivateKey: eciesKey,
      ecdsaPrivateKey: ecdsaKey,
      Encryption: true
    });

    try {
      await client.getBaseInfo();
      const res = await client.listFiles('./', false);
      remoteFiles.value = (res.files || []).map((f: any) => f.name);
    } catch (fileErr) {
      console.warn('[Update Probe] 远端核心文件资产列表扫描受限，将依赖版本特征与默认值兜底:', fileErr);
    }
  } catch (err: any) {
    console.error('[Update Probe] 远程网络通信中断:', err);
    if (detectedType.value === 'unknown') {
      errorMsg.value = `❌ 远程环境探针全面断开，且无法从节点版本号中识别环境: ${err.message || err}`;
    }
  }

  const lowerNames = remoteFiles.value.map(name => name.toLowerCase());
  if (detectedType.value === 'unknown') {
    if (lowerNames.includes('package.json') || lowerNames.includes('index.js')) {
      detectedType.value = 'nodejs';
    } else if (lowerNames.includes('requirements.txt') || lowerNames.includes('main.py') || lowerNames.includes('app.py')) {
      detectedType.value = 'python';
    } else if (lowerNames.includes('server.jar')) {
      detectedType.value = 'java';
    } else if (lowerNames.includes('agent')) {
      detectedType.value = 'go';
    }
  }

  syncDefaultFileNames();
  isLoading.value = false;
};

const syncDefaultFileNames = () => {
  if (detectedType.value === 'nodejs') {
    selectedPrimaryFile.value = remoteFiles.value.find(n => n.toLowerCase() === 'index.js') || remoteFiles.value.find(n => n.endsWith('.js')) || 'index.js';
    selectedSecondaryFile.value = 'package.json';
  } else if (detectedType.value === 'python') {
    selectedPrimaryFile.value = remoteFiles.value.find(n => n.toLowerCase() === 'main.py') || remoteFiles.value.find(n => n.toLowerCase() === 'app.py') || remoteFiles.value.find(n => n.endsWith('.py')) || 'main.py';
    selectedSecondaryFile.value = 'requirements.txt';
  } else if (detectedType.value === 'java') {
    selectedPrimaryFile.value = remoteFiles.value.find(n => n.toLowerCase() === 'server.jar') || 'server.jar';
    selectedSecondaryFile.value = '';
  } else if (detectedType.value === 'go') {
    selectedPrimaryFile.value = remoteFiles.value.find(n => n.toLowerCase() === 'agent') || 'agent';
    selectedSecondaryFile.value = '';
  }
};

// ==================== 📡 远程资产浏览与深度下钻 ====================
const openRemoteFilePicker = async () => {
  showFilePicker.value = true;
  pickerPath.value = './';
  pickerPathHistory.value = [];
  await loadPickerFiles();
};

const loadPickerFiles = async () => {
  isPickerLoading.value = true;
  pickerFiles.value = [];
  try {
    const ecdsaKey = props.node.ecdsaPrivateKey || props.globalConfig.ecdsaPrivateKey || '';
    const eciesKey = props.node.eciesPrivateKey || props.globalConfig.eciesPrivateKey || '';
    
    const client = new AgentClient({
      domain: props.node.domain,
      eciesPrivateKey: eciesKey,
      ecdsaPrivateKey: ecdsaKey,
      Encryption: true
    });
    
    await client.getBaseInfo();
    const res = await client.listFiles(pickerPath.value, false);
    pickerFiles.value = res.files || [];
  } catch (err: any) {
    console.error('[Picker Explorer] 路由拉取失败:', err);
    alert(`❌ 无法读取该节点的文件资产: ${err.message || '请检查密钥配置或节点网络状态'}`);
    showFilePicker.value = false;
  } finally {
    isPickerLoading.value = false;
  }
};

// 检查文件是否符合当前语言规则约束
const isFileCompliantWithTrack = (filename: string): boolean => {
  const lower = filename.toLowerCase();
  switch (detectedType.value) {
    case 'nodejs': return lower.endsWith('.js');
    case 'python': return lower.endsWith('.py');
    case 'go': return !lower.includes('.') && !['makefile', 'readme', 'license', 'go.mod', 'go.sum'].includes(lower);
    case 'java': return lower.endsWith('.jar');
    default: return true;
  }
};

const handlePickerItemClick = async (item: any) => {
  // 💡 ✨ 使用规范的 isDirectory 刚性判定
  if (isDirectory(item)) {
    pickerPathHistory.value.push(pickerPath.value);
    const base = pickerPath.value.replace(/\/+$/, '');
    pickerPath.value = `${base}/${item.name}/`;
    await loadPickerFiles();
  } else {
    if (!isFileCompliantWithTrack(item.name)) {
      alert(`⚠️ 策略拒绝：当前处于 ${detectedType.value.toUpperCase()} 体系，您只能指定并覆盖与之对等的脚本或组件包！`);
      return;
    }
    
    // 💡 ✨ 清洗拼接路径，防止未定义函数崩溃，完美生成带子目录层级的更新相对路径
    if (pickerPath.value === './' || pickerPath.value === '.') {
      selectedPrimaryFile.value = item.name;
    } else {
      let cleanDir = pickerPath.value.startsWith('./') ? pickerPath.value.substring(2) : pickerPath.value;
      if (cleanDir && !cleanDir.endsWith('/')) {
        cleanDir += '/';
      }
      selectedPrimaryFile.value = `./${cleanDir}${item.name}`;
    }
    showFilePicker.value = false;
  }
};

const handlePickerBack = async () => {
  if (pickerPathHistory.value.length > 0) {
    pickerPath.value = pickerPathHistory.value.pop()!;
    await loadPickerFiles();
  }
};

watch(detectedType, () => {
  syncDefaultFileNames();
  if (detectedType.value !== 'unknown' && errorMsg.value.includes('无法自动识别')) {
    errorMsg.value = '';
  }
});

onMounted(() => {
  probeRemoteEnvironment();
});

const handleConfirm = () => {
  if (detectedType.value === 'unknown') {
    alert('请先手动选择该节点的运行环境类型！');
    return;
  }
  if (!selectedPrimaryFile.value) {
    alert('请先指定需要覆盖的核心主文件名！');
    return;
  }
  
  emit('confirm', {
    agentType: detectedType.value,
    primaryFile: selectedPrimaryFile.value,
    secondaryFile: selectedSecondaryFile.value || undefined
  });
  emit('update:visible', false);
};

const handleCancel = () => {
  emit('cancel');
  emit('update:visible', false);
};
</script>

<template>
  <DialogModal
    :model-value="visible"
    title="远端代理端全自动在线热升级"
    width="large" 
    confirm-text="锁定目标并启动升级"
    cancel-text="暂缓操作"
    @confirm="handleConfirm"
    @cancel="handleCancel"
    @update:model-value="emit('update:visible', $event)"
  >
    <div class="update-panel-container">
      
      <div class="audit-section">
        <div v-if="isLoading" class="loading-bar">
          <span class="spinner">⏳</span> 正在流式审计远端根目录环境资产名录，请稍候...
        </div>
        <div v-else-if="errorMsg" class="error-banner">
          {{ errorMsg }}
        </div>
        <div v-else class="success-banner">
          <span class="badge-type" :class="detectedType">
            轨道：{{ detectedType.toUpperCase() }} 体系
          </span>
          <span class="text">
            {{ remoteFiles.length > 0 ? '远端环境扫描对齐成功，已解锁高级文件深度路由。' : '已通过双端版本号智能锚定导轨，已为您装填默认值。' }}
          </span>
        </div>
      </div>

      <div v-if="!isLoading" class="custom-file-zone">
        <h4>🎯 覆盖目标资产指定</h4>
        
        <div class="form-group">
          <label>1. 目标运行环境轨道体系：</label>
          <select v-model="detectedType" class="custom-select">
            <option value="unknown" disabled>⚠️ 未能识别，请手动选择...</option>
            <option value="nodejs">Node.js 导轨 (在线热织入公钥特征)</option>
            <option value="python">Python 导轨 (Unicode转译混淆封装)</option>
            <option value="go">Go 静态编译导轨 (2MB分块流式灌录)</option>
            <option value="java">Java 字节码导轨 (全量混淆类重写架构)</option>
          </select>
        </div>

        <div class="form-row">
          
          <div class="form-group flex-1">
            <label>2. 主实体核心文件覆盖对象：</label>
            
            <div class="input-group">
              <select 
                v-if="filteredPrimaryOptions.length > 0 && (!selectedPrimaryFile || filteredPrimaryOptions.includes(selectedPrimaryFile))" 
                v-model="selectedPrimaryFile" 
                class="custom-select-grouped"
              >
                <option v-for="name in filteredPrimaryOptions" :key="name" :value="name">
                  {{ name }} (根目录检测存在)
                </option>
              </select>
              
              <input  
                v-else 
                type="text" 
                v-model="selectedPrimaryFile" 
                class="custom-input-grouped" 
                placeholder="例如: main.py / server.jar"
              />
              <button type="button" class="file-browse-btn" @click="openRemoteFilePicker">
                📁 浏览服务器
              </button>
            </div>
          </div>

          <div v-if="detectedType === 'nodejs' || detectedType === 'python'" class="form-group flex-1">
            <label>3. 配套环境依赖清单（自动对齐）：</label>
            <input 
              type="text" 
              v-model="selectedSecondaryFile" 
              class="custom-input readonly-style" 
              placeholder="不需要更新依赖文件可留空"
            />
          </div>
        </div>
        
        <p class="input-hint">
          * 约束策略：{{ detectedType === 'nodejs' ? '约束指定为 *.js 核心脚本' : detectedType === 'python' ? '约束指定为 *.py 核心脚本' : detectedType === 'go' ? '核心可执行文件通常无扩展名' : detectedType === 'java' ? '刚性指定为 *.jar 字节码包' : '请手动输入或选择文件名' }}。
        </p>
      </div>

      <hr class="panel-divider" />

      <div class="info-section bg-warm-paper">
        <h4>⚙️ 自动化热编译与推送原理</h4>
        <p class="desc-text">
          系统将直接建立与节点 <strong>[{{ node?.name }}]</strong> 的全密文高可靠传输管道。首先从云端总控仓库拉取当前最新发行的底层主程序轨道代码，随后在控制端内部执行<b>无感就地特征编译</b>，将您当前在面板配置的不可逆核心授权公钥动态织入源码中，最后通过分块断点续传（2MB级联滑动窗口）无缝灌录覆盖远端代理 core，实现全自动版本对齐。
        </p>
      </div>

      <div class="info-section bg-danger-capsule">
        <h4>⚠️ 运维风险与注意事项</h4>
        <ul>
          <li><strong>回环路由隔离：</strong>部分节点处于复杂的 NAT 网络或回环路由沙箱中，升级中瞬时波动可能造成重连间隙。</li>
          <li><strong>文件死锁冲突：</strong>如果远端未配置自动热拉起守护机制（如 <code>systemd</code>、<code>pm2</code>），文件覆盖可能导致突发连不上，操作前请确保有守护环境。</li>
          <li><strong>动态依赖项变动：</strong>Node.js/Python 重写依赖清单（package.json/requirements.txt）后若远端缺失三方依赖且无法自动热修复，可能造成进程初始化失败。</li>
        </ul>
      </div>

    </div>

    <div v-if="showFilePicker" class="picker-overlay" @click.self="showFilePicker = false">
      <div class="picker-container">
        <div class="picker-header">
          <h5>📁 远程核心资产文件浏览器</h5>
          <button class="picker-close" @click="showFilePicker = false">✕</button>
        </div>
        
        <div class="picker-path-bar">
          <button 
            class="picker-back-btn" 
            :disabled="pickerPathHistory.length === 0" 
            @click="handlePickerBack"
          >
            ⬅️ 返回上级
          </button>
          <span class="path-text">当前位置：<code>{{ pickerPath }}</code></span>
        </div>

        <div class="picker-body">
          <div v-if="isPickerLoading" class="picker-loading">
            ⏳ 正在实时遍历服务器资产文件流...
          </div>
          <div v-else-if="pickerFiles.length === 0" class="picker-empty">
            🫙 这是一个空文件夹
          </div>
          <div v-else class="picker-list">
            <div 
              v-for="file in pickerFiles" 
              :key="file.name"
              class="picker-item"
              :class="{ 'non-compliant': !isDirectory(file) && !isFileCompliantWithTrack(file.name) }"
              @click="handlePickerItemClick(file)"
            >
              <span class="file-icon">{{ isDirectory(file) ? '📁' : '📄' }}</span>
              <span class="file-name">{{ file.name }}</span>
              
              <span v-if="isDirectory(file)" class="dir-hint">进入</span>
              <span v-else-if="!isFileCompliantWithTrack(file.name)" class="forbidden-hint">不符约束</span>
              <span v-else class="select-hint">选中</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </DialogModal>
</template>

<style scoped>
.update-panel-container { display: flex; flex-direction: column; gap: 16px; color: var(--text); width: 740px; max-width: 100%; }
.form-row { display: flex; gap: 16px; width: 100%; margin-top: 12px; }
.flex-1 { flex: 1; }
.desc-text { text-align: justify; text-justify: inter-word; }

.input-group { display: flex; width: 100%; gap: 0; align-items: stretch; margin-top: 4px; }
.custom-select-grouped, .custom-input-grouped { flex: 1; padding: 10px 12px; border-radius: 8px 0 0 8px; border: 1.5px solid var(--border-strong); border-right: none; background: var(--btn-bg); color: var(--text); font-size: 0.9rem; outline: none; }
.custom-select-grouped:focus, .custom-input-grouped:focus { border-color: var(--primary); }
.file-browse-btn { padding: 0 14px; background: var(--surface-3); border: 1.5px solid var(--border-strong); border-radius: 0 8px 8px 0; cursor: pointer; font-size: 0.82rem; font-weight: 600; color: var(--text-soft); transition: all 0.15s; white-space: nowrap; }
.file-browse-btn:hover { background: var(--surface-2); color: var(--text); border-color: var(--muted); }

.info-section { padding: 14px 18px; border-radius: 12px; border: 1px solid var(--border); font-size: 0.88rem; line-height: 1.6; color: var(--text-soft); }
.info-section h4 { margin-bottom: 8px; font-size: 0.95rem; font-weight: 600; display: flex; align-items: center; gap: 6px; }
.bg-warm-paper { background-color: rgba(245, 158, 11, 0.1); border-color: rgba(245, 158, 11, 0.3); color: #fbbf24; }
.bg-danger-capsule { background-color: rgba(239, 68, 68, 0.12); border-color: rgba(239, 68, 68, 0.35); color: #fca5a5; }
.info-section ul { margin-left: 20px; margin-top: 6px; }
.info-section li { margin-bottom: 6px; }
.panel-divider { border: 0; border-top: 1px dashed var(--border-strong); margin: 6px 0; }
.audit-section { padding: 4px 2px; font-size: 0.85rem; }
.loading-bar { color: var(--primary); font-weight: 500; display: flex; align-items: center; gap: 8px; }
.spinner { display: inline-block; animation: rotateSpinner 2s linear infinite; }
@keyframes rotateSpinner { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
.error-banner { background: var(--chip-error-bg); border: 1px solid var(--chip-error-border); color: var(--chip-error-text); padding: 8px 12px; border-radius: 8px; font-weight: 500; }
.success-banner { background: var(--chip-online-bg); border: 1px solid var(--chip-online-border); color: var(--chip-online-text); padding: 10px 14px; border-radius: 8px; display: flex; align-items: center; gap: 10px; }
.badge-type { padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; font-weight: 700; color: white; text-transform: uppercase; }
.badge-type.nodejs { background: #0284c7; }
.badge-type.python { background: #059669; }
.badge-type.go { background: #7c3aed; }
.badge-type.java { background: #b45309; }
.badge-type.unknown { background: #64748b; }
.custom-file-zone h4 { font-size: 0.95rem; font-weight: 600; margin-bottom: 12px; color: var(--text); }
.form-group label { font-size: 0.88rem; font-weight: 500; color: var(--text-soft); margin-bottom: 6px; display: block; }
.custom-select, .custom-input { width: 100%; padding: 10px 12px; border-radius: 8px; border: 1.5px solid var(--border-strong); background: var(--btn-bg); color: var(--text); font-size: 0.9rem; outline: none; transition: border-color 0.2s; margin-top: 4px; }
.custom-select:focus, .custom-input:focus { border-color: var(--primary); box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1); }
.input-hint { font-size: 0.75rem; color: var(--muted); margin-top: 6px; font-style: italic; }
.readonly-style { background-color: var(--surface-2); cursor: not-allowed; border-style: dashed; }

/* 远程资产浏览器浮层 */
.picker-overlay { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.4); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; z-index: 2200; }
.picker-container { background: var(--card); border-radius: 16px; padding: 20px; width: 500px; max-height: 75vh; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25); display: flex; flex-direction: column; gap: 14px; border: 1px solid var(--border); }
.picker-header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); padding-bottom: 10px; }
.picker-header h5 { font-size: 1.05rem; font-weight: 600; color: var(--text); }
.picker-close { border: none; background: transparent; font-size: 1.2rem; cursor: pointer; color: var(--muted); transition: color 0.15s; }
.picker-close:hover { color: var(--danger); }
.picker-path-bar { display: flex; align-items: center; gap: 10px; background: var(--surface-2); padding: 8px 12px; border-radius: 8px; border: 1px solid var(--border); }
.picker-back-btn { padding: 4px 8px; background: var(--btn-bg); border: 1px solid var(--border-strong); border-radius: 6px; font-size: 0.78rem; font-weight: 600; color: var(--text-soft); cursor: pointer; transition: all 0.15s; }
.picker-back-btn:hover:not(:disabled) { background: var(--surface-3); color: var(--text); border-color: var(--muted); }
.picker-back-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.path-text { font-size: 0.82rem; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.picker-body { flex: 1; overflow: hidden; min-height: 260px; display: flex; flex-direction: column; }
.picker-loading, .picker-empty { padding: 40px 0; text-align: center; font-size: 0.88rem; color: var(--muted); }
.picker-list { overflow-y: auto; border: 1px solid var(--border); border-radius: 10px; flex: 1; }
.picker-item { display: flex; align-items: center; padding: 10px 14px; cursor: pointer; font-size: 0.88rem; border-bottom: 1px solid var(--border); transition: all 0.15s; color: var(--text-soft); }
.picker-item:last-child { border-bottom: none; }
.picker-item:hover { background: var(--hover-bg); color: var(--text); }
.file-icon { font-size: 1.1rem; margin-right: 10px; flex-shrink: 0; }
.file-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: monospace; }
.dir-hint, .select-hint { font-size: 0.72rem; padding: 2px 6px; background: var(--surface-3); color: var(--muted); border-radius: 4px; font-weight: 500; }
.picker-item:hover .select-hint { background: var(--primary); color: white; }
.picker-item:hover .dir-hint { background: var(--surface-2); color: var(--text); }

.picker-item.non-compliant { opacity: 0.45; }
.forbidden-hint { font-size: 0.72rem; padding: 2px 6px; background: var(--chip-offline-bg); color: var(--chip-offline-text); border-radius: 4px; font-weight: 500; }
</style>