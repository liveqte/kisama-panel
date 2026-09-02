<script setup lang="ts">
import { ref, watch } from 'vue';
import { generateProxyKeys, deriveEcdsaPublicKey, deriveEciesPublicKey } from '../lib/generate_key';
import { strToU8, zip } from 'fflate';
import { validatePemKey } from "../lib/validatePemKey";
import { sanitizeKeyInput } from '../lib/key-normalize';
import { inject } from 'vue';
// 💡 ✨ 引入刚才升级好的安保网络层单例
import { AgentClient } from '../lib/agent-client'; //
const showNotification = inject<(message: string, type?: 'success' | 'error' | 'info') => void>('showNotification');

const props = defineProps<{
  visible: boolean;
  globalConfig: any;
}>();

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void;
  (e: 'save', payload: { config: any; customStyle: string; customScript: string }): void;
  (e: 'toast', payload: { message: string; type: 'success' | 'error' | 'info' }): void;
}>();

// ---- Tab 状态 ----
const activeTab = ref<'keys' | 'general' | 'styles' | 'scripts'>('keys'); //

// ---- 密钥及脚本样式状态保持原有不变 ----
const showEcdsaPub = ref(false); //
const showEciesPub = ref(false); //
const globalErrors = ref({ ecdsa: '', ecies: '' }); //
const isGenerating = ref(false); //

const globalForm = ref({ ecdsaPrivateKey: '', ecdsaPublicKey: '', eciesPrivateKey: '', eciesPublicKey: '' }); //
const customStyle = ref(''); //
const customScript = ref(''); //

// ---- 中转代理隧道路由状态保持原有不变 ----
const proxyEnabled = ref(false); 
const proxyAllSites = ref(false);
const proxyDomains = ref<string[]>([]); 
const newDomainInput = ref(''); 
const domainStatuses = ref<Record<string, 'checking' | 'available' | 'unavailable'>>({}); //

// ---- 通用状态页面发布控制状态 ----
const statusPageEnabled = ref(false); //
const statusPageUrl = ref(''); //
const statusPageToken = ref(''); //
const statusPageSyncStatus = ref<'idle' | 'syncing' | 'success' | 'error'>('idle'); //

// ---- 中转代理探针检测（官方 API 极速修正版） ----
const checkDomainAvailability = async (domain: string) => {
  domainStatuses.value[domain] = 'checking';
  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 4000);
    
    // 💡 ✨【核心修改】：将主机头修正为合规的 api.cdnjs.com，满足中转 api 字样匹配的同时刚性确保 200 返回
    const testUrl = `${domain}/kisamaproxy/https://api.cdnjs.com/libraries?limit=1`;
    const res = await fetch(testUrl, { method: 'GET', signal: controller.signal });
    clearTimeout(id);
    
    if (res.ok && res.status >= 200 && res.status < 300) {
      domainStatuses.value[domain] = 'available';
    } else {
      domainStatuses.value[domain] = 'unavailable';
    }
  } catch {
    domainStatuses.value[domain] = 'unavailable';
  }
};
const checkAllDomains = () => {
  // 💡 进入设置页面时豁免门禁：中转可能已启用但尚未保存生效（localStorage 仍为旧值），
  // 因此进入页面一律真实探测，让用户在保存前就能看到每个中转的可用状态
  proxyDomains.value.forEach(d => checkDomainAvailability(d));
}; //
const addProxyDomain = () => { //
  let url = newDomainInput.value.trim(); //
  if (!url) return; //
  if (!url.startsWith('https://')) { alert('中转连接域名必须以 https:// 开头！'); return; } //
  url = url.replace(/\/+$/, ''); //
  if (proxyDomains.value.includes(url)) { alert('请勿重复添加。'); return; } //
  proxyDomains.value.push(url); //
  newDomainInput.value = ''; //
  // 💡 设置页内同样豁免门禁：开关已打开但尚未保存时也要即时探测出可用状态
  checkDomainAvailability(url); //
}; //
const removeProxyDomain = (d: string) => { proxyDomains.value = proxyDomains.value.filter(x => x !== d); delete domainStatuses.value[d]; }; //


// ---- 💡 💡 💡 核心资产数据剥离提取与同步函数 (精简无 Bug 终极版) ----
const triggerStatusPageUpload = async (url: string, token: string) => {
  try {
    // 1. 从本地存储读取当前时刻的原始资产名录
    const rawNodes = localStorage.getItem('agent_nodes_config') || '[]';
    const parsedNodes = JSON.parse(rawNodes);
    
    // 🔒【安保核心】：严格过滤，仅隔离提取三项非敏感字段，彻底熔断密钥泄漏
    const cleanNodes = parsedNodes.map((n: any) => ({
      id: n.id,
      name: n.name,
      domain: n.domain
    })); //
    
    // 💡 ✨【核心优化】：彻底移除多余的 local 变量和对全局状态产生副作用的 localStorage 覆写块。
    // 直接组装大信封，proxies 刚性绑定组件原生、处于最新状态的 proxyDomains.value 即可！
    const bigEnvelope = {
      nodes: cleanNodes,
      proxies: proxyDomains.value // 🎯 直接使用原装响应式数据，既安全又干净
    };

    // 使用 as any 强行绕过原有旧参数类型的静态类型检查，执行打包投递
    await AgentClient.uploadStatusPage(url, token, bigEnvelope as any);
    return true; //
  } catch (e) { //
    console.error('[Status Page Sync] 资产上报发布管道破裂失败:', e); //
    return false; //
  } //
};

const handleManualStatusUpload = async () => { //
  if (!statusPageUrl.value.trim()) return; //
  statusPageSyncStatus.value = 'syncing'; //
  
  const success = await triggerStatusPageUpload(statusPageUrl.value.trim(), statusPageToken.value.trim()); //
  if (success) { //
    statusPageSyncStatus.value = 'success'; //
    emit('toast', { message: '监控状态页面数据同步成功！', type: 'success' }); //
  } else { //
    statusPageSyncStatus.value = 'error'; //
    emit('toast', { message: '同步失败，请检查接收端 URL 或 Token', type: 'error' }); //
  } //
}; //

// 💡 弹窗打开一体化初始化加载器
watch(() => props.visible, (val) => { //
  if (val) { //
    globalForm.value = { //
      ecdsaPrivateKey: props.globalConfig.ecdsaPrivateKey || '', //
      ecdsaPublicKey: props.globalConfig.ecdsaPublicKey || '', //
      eciesPrivateKey: props.globalConfig.eciesPrivateKey || '', //
      eciesPublicKey: props.globalConfig.eciesPublicKey || '', //
    }; //
    globalErrors.value = { ecdsa: '', ecies: '' }; //
    customStyle.value = localStorage.getItem('kisama_custom_style') || ''; //
    customScript.value = localStorage.getItem('kisama_custom_script') || ''; //
     //
      // 读取中转配置
    try { //
      const proxyRaw = localStorage.getItem('kisama_proxy_config'); //
      if (proxyRaw) { //
        const parsed = JSON.parse(proxyRaw); //
        proxyDomains.value = Array.isArray(parsed.domains) ? parsed.domains : []; //
        // 🛡️ 站点池为空时禁止处于启用态（历史脏数据归一化），必须先录入站点
        proxyEnabled.value = !!parsed.enabled && proxyDomains.value.length > 0; //
      } else { proxyEnabled.value = false; proxyDomains.value = []; } //
    } catch { proxyEnabled.value = false; proxyDomains.value = []; } //
    domainStatuses.value = {}; //
    checkAllDomains(); //
 //
    // 读取并恢复监控状态页面缓存配置
    try { //
      const statusRaw = localStorage.getItem('kisama_status_page_config'); //
      if (statusRaw) { //
        const parsed = JSON.parse(statusRaw); //
        statusPageEnabled.value = !!parsed.enabled; //
        statusPageUrl.value = parsed.url || ''; //
        statusPageToken.value = parsed.token || ''; //
      } else { statusPageEnabled.value = false; statusPageUrl.value = ''; statusPageToken.value = ''; } //
    } catch { statusPageEnabled.value = false; statusPageUrl.value = ''; statusPageToken.value = ''; } //
    statusPageSyncStatus.value = 'idle'; //
  } //
}); //

// ---- 密钥核心方法 ----
const handleGenerateAllKeys = async () => { //
  if (!confirm('确定要生成新的密钥对吗？')) return; //
  isGenerating.value = true; //
  try { //
    const keys = await generateProxyKeys(); //
    globalForm.value = { ecdsaPrivateKey: keys.controlEcdsaPrivate, ecdsaPublicKey: keys.agentEcdsaPublic, eciesPrivateKey: keys.controlEciesPrivate, eciesPublicKey: keys.agentEciesPublic }; //
    emit('toast', { message: '密钥已成功生成', type: 'success' }); //
  } catch (err: any) { emit('toast', { message: '生成失败: ' + err.message, type: 'error' }); } finally { isGenerating.value = false; } //
}; //
 //
const downloadSingleFile = (content: string, fileName: string) => { //
  if (!content) return emit('toast', { message: '内容为空', type: 'error' }); //
  const blob = new Blob([content], { type: 'text/plain' }); //
  const url = URL.createObjectURL(blob); //
  const a = document.createElement('a'); a.href = url; a.download = fileName; a.click(); URL.revokeObjectURL(url); //
}; //
 //
const handleDownloadBundle = () => { //
  const { ecdsaPublicKey, eciesPublicKey } = globalForm.value; //
  if (!ecdsaPublicKey || !eciesPublicKey) return emit('toast', { message: '未找到已生成的公钥', type: 'error' }); //
  zip({ "agent_ecdsa_pub.pem": strToU8(ecdsaPublicKey), "agent_ecies_pub.b64": strToU8(eciesPublicKey) }, (err, data) => { //
    if (err) return emit('toast', { message: '打包失败', type: 'error' }); //
    const url = URL.createObjectURL(new Blob([data as any], { type: 'application/zip' })); //
    const a = document.createElement('a'); a.href = url; a.download = 'agent_keys.zip'; a.click(); URL.revokeObjectURL(url); //
    emit('toast', { message: '配置包已导出', type: 'success' }); //
  }); //
}; //

// ---- 全局统一大保存 ----
const handleSaveSettings = () => { //
  // 🔒 密钥净化：先清洗多余换行符/空白，再校验与落盘，防止粘贴时混入的换行破坏格式
  if (globalForm.value.ecdsaPrivateKey) {
    globalForm.value.ecdsaPrivateKey = sanitizeKeyInput(globalForm.value.ecdsaPrivateKey, 'ecdsa');
  }
  if (globalForm.value.eciesPrivateKey) {
    globalForm.value.eciesPrivateKey = sanitizeKeyInput(globalForm.value.eciesPrivateKey, 'ecies');
  }
  if (globalForm.value.ecdsaPublicKey) {
    globalForm.value.ecdsaPublicKey = sanitizeKeyInput(globalForm.value.ecdsaPublicKey, 'ecdsa');
  }
  if (globalForm.value.eciesPublicKey) {
    globalForm.value.eciesPublicKey = globalForm.value.eciesPublicKey.trim().replace(/\s+/g, '');
  }
  if (globalForm.value.ecdsaPrivateKey) { //
    const res = validatePemKey(globalForm.value.ecdsaPrivateKey, 'ecdsa'); //
    if (!res.valid) { globalErrors.value.ecdsa = res.error || '无效私钥'; activeTab.value = 'keys'; return; } //
  } //
  if (globalForm.value.eciesPrivateKey) { //
    const res = validatePemKey(globalForm.value.eciesPrivateKey, 'ecies'); //
    if (!res.valid) { globalErrors.value.ecies = res.error || '无效私钥'; activeTab.value = 'keys'; return; } //
  } //

  // 🚫 站点池门禁：开启中转模式的前提是至少录入了一个中转站点
  if (proxyEnabled.value && proxyDomains.value.length === 0) {
    const msg = '🚫 中转站点池为空：请先在「通用设置」中录入至少一个中转站点，再开启全局中转！';
    if (showNotification) {
      showNotification(msg, 'error');
    } else {
      emit('toast', { message: msg, type: 'error' });
    }
    activeTab.value = 'general';
    return;
  }

  // 🎯 【最高优先级门禁】：仅当用户正停留在「通用设置」页时，才被探针检测阻挡；
  // 其它页面保存时不因后台测速而卡住（健康池为空时保存逻辑会自动平滑降级回全量池）
  const hasChecking = activeTab.value === 'general' &&
    proxyDomains.value.some(d => domainStatuses.value[d] === 'checking');
  if (hasChecking) {
    // 💡 优先走原装 emit 机制投递消息，如果存在注入的 showNotification 则做兜底，确保 100% 不崩
    if (showNotification) {
      showNotification('⏳ 探针仍在密集检测中，请稍等 1~2 秒状态刷新后再点击保存！', 'info');
    } else {
      emit('toast', { message: '⏳ 探针仍在密集检测中，请稍等 1~2 秒状态刷新后再点击保存！', type: 'info' });
    }
    return; // 刚性熔断，直接返回
  }

  // 走到这里，说明全部站点的状态都尘埃落定了（要么 available，要么 unavailable）
  const activeHealthyDomains = proxyDomains.value.filter(
    domain => domainStatuses.value[domain] === 'available'
  );

  // 1. 持久化中转配置到 LocalStorage
  localStorage.setItem('kisama_proxy_config', JSON.stringify({ 
    enabled: proxyEnabled.value, 
    allSites: proxyAllSites.value, 
    domains: proxyDomains.value,
    // 如果全灭，平滑降级回全量池
    healthyDomains: activeHealthyDomains.length > 0 ? activeHealthyDomains : proxyDomains.value
  }));

  // 2. 持久化状态监控发布站点设置到 LocalStorage
  localStorage.setItem('kisama_status_page_config', JSON.stringify({ //
    enabled: statusPageEnabled.value, //
    url: statusPageUrl.value.trim(), //
    token: statusPageToken.value.trim() //
  })); //

  // 3.【大联动】：由于中转代理的落盘行为发生在上方的第 1 步，此时 triggerStatusPageUpload 会完美抓取到最新修改后的中转池数据并合并上报！
  if (statusPageEnabled.value && statusPageUrl.value.trim()) { //
    triggerStatusPageUpload(statusPageUrl.value.trim(), statusPageToken.value.trim()); //
  } //

  const configPayload = { //
    ecdsaPrivateKey: globalForm.value.ecdsaPrivateKey || undefined, //
    ecdsaPublicKey: globalForm.value.ecdsaPublicKey || undefined, //
    eciesPrivateKey: globalForm.value.eciesPrivateKey || undefined, //
    eciesPublicKey: globalForm.value.eciesPublicKey || undefined //
  }; //
  emit('save', { config: configPayload, customStyle: customStyle.value, customScript: customScript.value }); //
  emit('update:visible', false); //
}; //


// 💡 ✨【核心新增】：监听手动填入的 ECDSA 私钥，合法时自动反向衍生公钥
watch(() => globalForm.value.ecdsaPrivateKey, async (newVal) => {
  globalErrors.value.ecdsa = '';
  const trimmed = newVal ? sanitizeKeyInput(newVal, 'ecdsa') : '';
  // 🔒 反向回写：把粘贴时混入的多余换行符/空白清理掉，保证显示与落盘完全一致
  if (newVal && newVal !== trimmed) globalForm.value.ecdsaPrivateKey = trimmed;
  
  if (!trimmed) {
    globalForm.value.ecdsaPublicKey = '';
    return;
  }

  // 校验 PEM 格式合法性
  const res = validatePemKey(trimmed, 'ecdsa');
  if (res.valid) {
    try {
      // 像素级对齐：调用底层密码学引擎，从私钥中流式提取出公钥
      globalForm.value.ecdsaPublicKey = await deriveEcdsaPublicKey(trimmed);
    } catch (err: any) {
      globalErrors.value.ecdsa = '公钥衍生失败: ' + err.message;
    }
  } else {
    globalForm.value.ecdsaPublicKey = '';
  }
});

// 💡 ✨【核心新增】：监听手动填入的 ECIES 私钥，合法时自动反向衍生公钥
watch(() => globalForm.value.eciesPrivateKey, async (newVal) => {
  globalErrors.value.ecies = '';
  const trimmed = newVal ? sanitizeKeyInput(newVal, 'ecies') : '';
  // 🔒 反向回写：剔除粘贴时混入的空格/换行等无关空白，保证 64 位 hex 纯净
  if (newVal && newVal !== trimmed) globalForm.value.eciesPrivateKey = trimmed;

  if (!trimmed) {
    globalForm.value.eciesPublicKey = '';
    return;
  }

  // 校验 Hex 格式合法性
  const res = validatePemKey(trimmed, 'ecies');
  if (res.valid) {
    try {
      // 像素级对齐：调用底层密码学引擎，从 32 字节 Hex 中换算出压缩公钥 Base64
      globalForm.value.eciesPublicKey = await deriveEciesPublicKey(trimmed);
    } catch (err: any) {
      globalErrors.value.ecies = '公钥衍生失败: ' + err.message;
    }
  } else {
    globalForm.value.eciesPublicKey = '';
  }
});
</script>

<template>
  <Transition name="modal">
    <div v-if="visible" class="modal-overlay" @click.self="emit('update:visible', false)">
      <div class="modal-content" style="max-width: 720px;">
        
        <div class="tabs-nav">
            <button class="tab-btn" :class="{ active: activeTab === 'keys' }" @click="activeTab = 'keys'">🔐 密钥设置</button>
            <button class="tab-btn" :class="{ active: activeTab === 'general' }" @click="activeTab = 'general'">⚙️ 通用设置</button>
            <button class="tab-btn" :class="{ active: activeTab === 'styles' }" @click="activeTab = 'styles'">🎨 样式美化</button>
            <button class="tab-btn" :class="{ active: activeTab === 'scripts' }" @click="activeTab = 'scripts'">⚡ 脚本注入</button>
        </div>

        <div class="modal-body" style="min-height: 320px;">
          <div v-if="activeTab === 'keys'" class="tab-pane animate-fade">
            <div class="quick-header">
              <span class="hint">全局默认连接及加密私钥（手动填入或向导生成）</span>
              <button class="btn secondary btn-sm" @click="handleGenerateAllKeys" :disabled="isGenerating">🪄 重新生成</button>
            </div>
            <div class="quick-actions" v-if="globalForm.ecdsaPublicKey && globalForm.eciesPublicKey">
              <span>📦 代理端配置包:</span>
              <button class="btn primary btn-sm" @click="handleDownloadBundle">📥 下载 keys.zip</button>
            </div>
            <div class="grid-form">
              <div class="form-section">
                <h4>🔐 签名认证 (ECDSA P-256)</h4>
                <div class="form-group">
                  <label>控制端私钥</label>
                  <textarea v-model="globalForm.ecdsaPrivateKey" :class="{'input-error': globalErrors.ecdsa}" rows="3" placeholder="-----BEGIN PRIVATE KEY-----"></textarea>
                  <p v-if="globalErrors.ecdsa" class="error-message">{{ globalErrors.ecdsa }}</p>
                </div>
                <div class="toggle-link" v-if="globalForm.ecdsaPublicKey" @click="showEcdsaPub = !showEcdsaPub">{{ showEcdsaPub ? '▼ 收起代理端公钥' : '▶ 显示代理端公钥' }}</div>
                <div class="form-group" v-show="globalForm.ecdsaPublicKey && showEcdsaPub">
                  <div class="label-with-action">
                    <label>代理端公钥 (agent_ecdsa_pub.pem)</label>
                    <a @click="downloadSingleFile(globalForm.ecdsaPublicKey, 'agent_ecdsa_pub.pem')" class="download-link">下载文件</a>
                  </div>
                  <textarea :value="globalForm.ecdsaPublicKey" readonly rows="3" class="readonly-input"></textarea>
                </div>
              </div>
              <hr class="divider" />
              <div class="form-section">
                <h4>📦 数据加密 (ECIES secp256k1)</h4>
                <div class="form-group">
                  <label>控制端私钥</label>
                  <textarea v-model="globalForm.eciesPrivateKey" :class="{'input-error': globalErrors.ecies}" rows="2" placeholder="32字节 Hex 字符串"></textarea>
                  <p v-if="globalErrors.ecies" class="error-message">{{ globalErrors.ecies }}</p>
                </div>
                <div class="toggle-link" v-if="globalForm.eciesPublicKey" @click="showEciesPub = !showEciesPub">{{ showEciesPub ? '▼ 收起代理端公钥' : '▶ 显示代理端公钥' }}</div>
                <div class="form-group" v-show="globalForm.eciesPublicKey && showEciesPub">
                  <div class="label-with-action">
                    <label>代理端公钥 (agent_ecies_pub.b64)</label>
                    <a @click="downloadSingleFile(globalForm.eciesPublicKey, 'agent_ecies_pub.b64')" class="download-link">下载文件</a>
                  </div>
                  <textarea :value="globalForm.eciesPublicKey" readonly rows="2" class="readonly-input"></textarea>
                </div>
              </div>
            </div>
          </div>

          <div v-if="activeTab === 'general'" class="tab-pane animate-fade">
            <div class="form-section">
              <h4>⚙️ 全局网络中转配置</h4>
              <p class="hint" style="margin-bottom: 16px;">提示：主要用于绕过浏览器的安全策略拦截，并解决**节点在内部网络下“连不上外网自己”**的奇特现象。当控制端是 HTTPS 时，浏览器严禁直接勾连明文的 HTTP 节点；同时中转机制还能充当外部桥梁，帮那些被内网路由困住的节点从外网顺利“跨越”访问到自身，保障 100% 互通。</p>
              <div class="form-group checkbox-group" style="background:var(--card); padding:12px 14px; border-radius:12px; border:1px solid var(--border)">
                <label class="checkbox-label" style="display:flex; align-items:center; gap:10px; cursor:pointer;">
                  <input type="checkbox" v-model="proxyEnabled" style="width:18px; height:18px; accent-color:var(--primary)" />
                  <span class="checkbox-text" style="font-size:0.95rem; font-weight:600;">启动全局中转连接域名功能</span>
                </label>
                <p v-if="proxyEnabled && proxyDomains.length === 0" class="hint" style="margin:8px 0 0;">⚠️ 当前中转站点池为空：请在下方录入至少一个中转站点，否则保存时将被拦截。</p>
              </div>

              <div v-if="proxyEnabled" class="form-group checkbox-group" style="background:var(--card); padding:10px 14px; margin-top:-12px; margin-left: 24px; border-radius:10px; border:1px solid var(--border)">
                <label class="checkbox-label" style="display:flex; align-items:center; gap:10px; cursor:pointer;">
                  <input type="checkbox" v-model="proxyAllSites" style="width:16px; height:16px; accent-color:var(--primary)" />
                  <span class="checkbox-text" style="font-size:0.88rem; font-weight:500; color:var(--text);">中转全部站点（包括https节点）</span>
                </label>
              </div>
              <div v-if="proxyEnabled" class="proxy-settings-box" style="margin-top:16px; background:var(--surface-2); padding:16px; border-radius:14px; border:1px solid var(--border)">
                <div class="form-group" style="margin-bottom:16px;">
                  <label style="font-weight:600; font-size:0.85rem; color:var(--text-soft); margin-bottom:6px;">新增中转站点 (必须以 https:// 开头)</label>
                  <div style="display:flex; gap:10px;">
                    <input v-model="newDomainInput" type="text" placeholder="https://proxy.example.com" style="flex:1; padding:8px 12px; border:1px solid var(--border); border-radius:8px; background:var(--btn-bg); color:var(--text);" @keydown.enter.prevent="addProxyDomain" />
                    <button type="button" class="btn primary btn-sm" style="border-radius:8px;" @click="addProxyDomain">➕ 添加</button>
                  </div>
                </div>
                <div class="proxy-list-wrapper">
                  <label style="font-weight:600; font-size:0.85rem; color:var(--text-soft); display:block; margin-bottom:8px;">中转站点池及探针情况</label>
                  <div v-if="proxyDomains.length === 0" style="text-align:center; padding:16px; color:var(--muted); font-size:0.85rem;">暂无站点，请在上方录入</div>
                  <div v-else style="display:flex; flex-direction:column; gap:8px;">
                    <div v-for="domain in proxyDomains" :key="domain" style="display:flex; align-items:center; justify-content:between; background:var(--btn-bg); padding:10px 14px; border-radius:8px; border:1px solid var(--border)">
                      <div style="display:flex; align-items:center; gap:12px; flex:1; min-width:0;">
                        <span style="width:8px; height:8px; border-radius:50%; display:inline-block; flex-shrink:0;" :style="{ backgroundColor: domainStatuses[domain] === 'available' ? '#10b981' : domainStatuses[domain] === 'unavailable' ? '#ef4444' : '#f59e0b' }"></span>
                        <span style="font-size:0.8rem; font-weight:700; min-width:64px; flex-shrink:0;">{{ domainStatuses[domain] === 'available' ? '🟢 可用' : domainStatuses[domain] === 'unavailable' ? '🔴 离线' : '🟡 检测中' }}</span>
                        <code style="font-family:monospace; color:var(--text-soft); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">{{ domain }}</code>
                      </div>
                      <button type="button" style="background:none; border:none; color:var(--muted); font-size:1rem; cursor:pointer; padding:2px 6px;" @click="removeProxyDomain(domain)">✕</button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <hr class="divider" />
            <div class="form-section">
              <h4>📊 全局状态监控页面发布设置</h4>
              <p class="hint" style="margin-bottom: 16px;">启用后，可将当前控制端管理的节点资产名录（仅提取 ID、名称和域名）安全推送到外部的 PHP 接收端，用于在公共或私有状态面板上进行无感展示。</p>
              
              <div class="form-group checkbox-group" style="background:var(--card); padding:12px 14px; border-radius:12px; border:1px solid var(--border)">
                <label class="checkbox-label" style="display:flex; align-items:center; gap:10px; cursor:pointer;">
                  <input type="checkbox" v-model="statusPageEnabled" style="width:18px; height:18px; accent-color:var(--primary)" />
                  <span class="checkbox-text" style="font-size:0.95rem; font-weight:600;">启动资产状态监控自动同步发布</span>
                </label>
              </div>

              <div v-if="statusPageEnabled" class="proxy-settings-box" style="margin-top:16px; background:var(--surface-2); padding:16px; border-radius:14px; border:1px solid var(--border)">
                <div class="form-group" style="margin-bottom:12px;">
                  <label style="font-weight:600; font-size:0.85rem; color:var(--text-soft); margin-bottom:6px;">接收端 PHP URL</label>
                  <input v-model="statusPageUrl" type="text" placeholder="https://status.yourdomain.com/receiver.php" style="width:100%; padding:8px 12px; border:1px solid var(--border); border-radius:8px; background:var(--btn-bg); color:var(--text);" />
                </div>

                <div class="form-group" style="margin-bottom:16px;">
                  <label style="font-weight:600; font-size:0.85rem; color:var(--text-soft); margin-bottom:6px;">认证密钥 (Token)</label>
                  <input v-model="statusPageToken" type="password" placeholder="请输入在 PHP 端预设的鉴权验证密钥" style="width:100%; padding:8px 12px; border:1px solid var(--border); border-radius:8px; background:var(--btn-bg); color:var(--text);" />
                </div>

                <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px;">
                  <span style="font-size:0.8rem; font-weight:600;" :style="{ color: statusPageSyncStatus === 'success' ? 'var(--chip-online-text)' : statusPageSyncStatus === 'error' ? 'var(--chip-error-text)' : '#dd6b20' }">
                    {{ statusPageSyncStatus === 'syncing' ? '🔄 正在建立连接并同步发布...' : statusPageSyncStatus === 'success' ? '✅ 资产名录配置包同步发布成功！' : statusPageSyncStatus === 'error' ? '❌ 同步失败，请检查网路连接或 Token 密钥' : '💤 等待手动或保存时自动触发同步' }}
                  </span>
                  <button type="button" class="btn secondary btn-sm" style="border-radius:8px;" :disabled="statusPageSyncStatus === 'syncing' || !statusPageUrl" @click="handleManualStatusUpload">🚀 立即同步</button>
                </div>
              </div>
            </div>
          </div>

          <div v-if="activeTab === 'styles'" class="tab-pane animate-fade">
            <div class="form-section">
              <h4>🎨 自定义注入 Style 代码</h4>
              <p class="hint" style="margin-bottom: 12px;">在下方编写 CSS 代码。保存后，样式会通过运行时 &lt;style&gt; 标签动态插入到页面中。</p>
              <div class="form-group"><textarea v-model="customStyle" rows="12" class="css-code-editor" placeholder="body { background: #f0f2f5 !important; }" spellcheck="false"></textarea></div>
            </div>
          </div>

          <div v-if="activeTab === 'scripts'" class="tab-pane animate-fade">
            <div class="form-section">
              <h4>⚡ 自定义注入 HTML / JavaScript 脚本</h4>
              <p class="hint" style="margin-bottom: 12px;">在下方编写 HTML 挂件或原生 JS 脚本。保存后系统会自动动态挂载并在后台静默运行。</p>
              <div class="form-group"><textarea v-model="customScript" rows="12" class="script-code-editor" placeholder="<script>console.log('Loaded');</script>" spellcheck="false"></textarea></div>
            </div>
          </div>
        </div>
       
        <div class="modal-footer">
          <button class="btn secondary" @click="emit('update:visible', false)">取消</button>
          <button class="btn primary" @click="handleSaveSettings">保存生效</button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.modal-header-tabs { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); margin-bottom: 20px; padding-bottom: 4px; }
.tabs-nav { display: flex; gap: 8px; }
.tab-btn { padding: 10px 20px; background: transparent; border: none; font-size: 1.05rem; font-weight: 600; color: var(--muted); cursor: pointer; position: relative; transition: color 0.2s; }
.tab-btn:hover { color: var(--text); }
.tab-btn.active { color: var(--primary); }
.tab-btn.active::after { content: ''; position: absolute; bottom: -5px; left: 0; width: 100%; height: 3px; background: var(--primary); border-radius: 2px; }
.close-tab-btn { font-size: 1.4rem; padding: 4px 8px; }
.quick-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; }
.css-code-editor, .script-code-editor { width: 100%; font-family: 'SF Mono', 'Consolas', 'Menlo', monospace !important; background-color: #0f172a !important; color: #38bdf8 !important; padding: 16px !important; border-radius: var(--radius-sm) !important; border: 2px solid #1e293b !important; line-height: 1.6 !important; font-size: 0.9rem !important; resize: vertical; }
.css-code-editor:focus, .script-code-editor:focus { border-color: var(--primary) !important; box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2) !important; }
.animate-fade { animation: fadeIn 0.25s ease-in-out; }
@keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
</style>