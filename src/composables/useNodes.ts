// src/composables/useNodes.ts
import { ref, computed, watch, type Ref } from 'vue'; // ✨ 引入 watch 监听器
import { AgentClient, type BaseInfo } from '../lib/agent-client';
import { probeProxyPoolHealth } from '../lib/proxy-health';
import { fetchIpMeta, fetchFlag, type IpType } from '../lib/check_iptype';
import type { AgentNode } from '../types';
import { nodeStableSignature } from '../lib/node-stable';

/**
 * 单节点模式：传入 ipv4 与已持久化的 flag（node.flag），返回一个响应式 flag 状态
 * 💡 勾选「保留IP信息」且国家(flag) 与 ipType 均已持久化时，直接复用、不再请求；
 *    任一缺失（从未请求成功过）或未勾选 → 才发起探测
 */
export function useNodeFlagStatus(
  ip: Ref<string | undefined>,
  storedFlag?: Ref<string | undefined>,
  storedIpType?: Ref<string | undefined>
) {
  const flagStatus = ref<string>('UNKNOWN');

  const update = async () => {
    const stored = storedFlag?.value || '';
    if (keepIpInfo.value && stored && storedIpType?.value) {
      flagStatus.value = stored;
      return;
    }
    flagStatus.value = await fetchFlag(ip.value || '');
  };

  watch([ip, storedFlag as any, storedIpType as any], update, { immediate: true });

  return { flagStatus };
}

/**
 * 批量模式：传入节点列表的 ref，返回一个 Record<id, flag> 响应式映射
 * 💡 勾选「保留IP信息」且 flag 与 ipType 均已持久化时直接复用，刷新后不再重复请求
 */
export function useBatchFlagStatus(nodes: Ref<AgentNode[]>) {
  const flagStatuses = ref<Record<string, string>>({});

  const updateAll = () => {
    nodes.value.forEach(async (node) => {
      if (keepIpInfo.value && node.flag && node.ipType) {
        flagStatuses.value[node.id] = node.flag;
        return;
      }
      flagStatuses.value[node.id] = await fetchFlag(node.baseinfo?.ipv4 || '');
    });
  };

  watch(nodes, updateAll, { immediate: true, deep: true });

  return { flagStatuses };
}

// 本地存储的 Key 声明
const STORAGE_KEY = 'agent_nodes_config';
const GLOBAL_CONFIG_KEY = 'agent_global_config';

// 💡 新增：筛选和排序的持久化 Key
const FILTER_STATUS_KEY = 'agent_filter_status';
const SORT_KEY_KEY = 'agent_sort_key';
const SORT_ORDER_KEY = 'agent_sort_order';
// 💡 1. 新增：视图模式的持久化 Key
const VIEW_MODE_KEY = 'agent_view_mode';

// 💡 2. 初始化视图状态：优先读缓存，默认为 'card'（卡片）
const viewMode = ref<'card' | 'table'>((localStorage.getItem(VIEW_MODE_KEY) as any) || 'table');

// 💡 3. 监听并自动存入 localStorage
watch(viewMode, (newVal) => localStorage.setItem(VIEW_MODE_KEY, newVal));

const nodes = ref<AgentNode[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);

// ========================================================
// 1. ✨ 核心修改：初始化时从本地存储加载筛选排序状态
// ========================================================
const filterStatus = ref<'all' | 'online' | 'offline'>(
  (localStorage.getItem(FILTER_STATUS_KEY) as any) || 'all'
);
const sortKey = ref<'name' | 'ip' | 'createdAt'>(
  (localStorage.getItem(SORT_KEY_KEY) as any) || 'createdAt' // 默认建立时间
);

// 🏠 新增：刷新后是否保留各节点 ip 情报（ipType + 国旗 flag）的开关（默认保留）
const KEEP_IP_INFO_KEY = 'agent_keep_ip_info';
const keepIpInfo = ref<boolean>(
  localStorage.getItem(KEEP_IP_INFO_KEY) === null
    ? (localStorage.getItem('agent_keep_ip_type') === null ? true : localStorage.getItem('agent_keep_ip_type') === 'true')
    : localStorage.getItem(KEEP_IP_INFO_KEY) === 'true'
);
watch(keepIpInfo, (newVal) =>
  localStorage.setItem(KEEP_IP_INFO_KEY, newVal ? 'true' : 'false')
);
const sortOrder = ref<'asc' | 'desc'>(
  (localStorage.getItem(SORT_ORDER_KEY) as any) || 'desc'     // 默认倒序
);

// 🔍 新增：节点快捷搜索关键词（名称 / 域名 / IP）
const SEARCH_KEY = 'agent_search_query';
const searchQuery = ref(localStorage.getItem(SEARCH_KEY) || '');
watch(searchQuery, (newVal) => localStorage.setItem(SEARCH_KEY, newVal));

// ========================================================
// 2. ✨ 新增：使用全局 watch 自动将状态同步到 localStorage
// ========================================================
watch(filterStatus, (newVal) => localStorage.setItem(FILTER_STATUS_KEY, newVal));
watch(sortKey, (newVal) => localStorage.setItem(SORT_KEY_KEY, newVal));
watch(sortOrder, (newVal) => localStorage.setItem(SORT_ORDER_KEY, newVal));


interface GlobalConfig {
  ecdsaPrivateKey?: string;
  ecdsaPublicKey?: string;
  eciesPrivateKey?: string;
  eciesPublicKey?: string;
}

// 全局配置（模块级单例）
const globalConfig = ref<GlobalConfig>({});


function generateUUID(): string {
  const getByte = () => {
    if (typeof window !== 'undefined' && window.crypto && window.crypto.getRandomValues) {
      return window.crypto.getRandomValues(new Uint8Array(1))[0];
    }
    return Math.floor(Math.random() * 256);
  };

  return (([1e7] as any) + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (c: any) =>
    (c ^ (getByte() & (15 >> (c / 4)))).toString(16)
  );
}

function loadGlobalConfig() {
  try {
    const raw = localStorage.getItem(GLOBAL_CONFIG_KEY);
    globalConfig.value = raw ? JSON.parse(raw) : {};
  } catch {
    globalConfig.value = {};
  }
}

function saveGlobalConfig(config: GlobalConfig) {
  globalConfig.value = config;
  localStorage.setItem(GLOBAL_CONFIG_KEY, JSON.stringify(config));
}

export function useNodes() {

  // 加载节点配置
  const loadFromStorage = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const list: AgentNode[] = raw ? JSON.parse(raw) : [];
      // 🏠 未勾选「保留IP信息」时：刷新后清空所有节点的 ipType 与国旗 flag，
      // 下次同步/渲染时重新走一体化探测接口获取
      if (!keepIpInfo.value) {
        list.forEach((n) => {
          delete n.ipType;
          delete n.flag;
        });
      }
      nodes.value = list;
    } catch (e) {
      console.error('Load config failed:', e);
      nodes.value = [];
    }
  };
  // 上次推送到状态页的节点快照（序列化后的 id+name+domain，用于判断是否真正有变更）
  let _lastPushedSnapshot: string | null = null;

  const autoPushToStatusPage = async () => {
    try {
      // 1. 检查状态页面配置是否开启
      const statusRaw = localStorage.getItem('kisama_status_page_config');
      if (!statusRaw) return;
      
      const parsed = JSON.parse(statusRaw);
      if (!parsed.enabled || !parsed.url) return;

      // 2. 提取当前资产快照（仅非敏感字段），与上次推送的快照比对
      const currentClean = nodes.value.map(n => ({
        id: n.id,
        name: n.name,
        domain: n.domain
      }));
      const currentSnapshot = JSON.stringify(currentClean);
      // 名称/域名/ID 均无变化 → 无需重新发布
      if (currentSnapshot === _lastPushedSnapshot) return;

      // 3. 发送请求
      _lastPushedSnapshot = currentSnapshot;
      const targetUrl = new URL(parsed.url);
      targetUrl.searchParams.set('token', parsed.token || '');

      fetch(targetUrl.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        body: currentSnapshot
      }).then(res => {
        if (res.ok) console.log('[Status Page] 资产名单发生变更，已全自动无感同步至监控站。');
      }).catch(e => {
        console.error('[Status Page] 自动发布由于网络原因在后台失败:', e);
      });

    } catch (e) {
      console.error('[Status Page] 自动发布解析异常:', e);
    }
  };
  // 批量同步时抑制自动推送的标志
  let _suppressStatusPage = false;

  // 核心落盘保存函数
  const saveToStorage = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nodes.value));
    
    // 批量同步期间不触发，由 syncAllNodes 统一在结束后推送
    if (!_suppressStatusPage) {
      autoPushToStatusPage();
    }
  };

  // 统一的同步函数（使用全局回退）
  // src/composables/useNodes.ts
  const syncNodeBaseInfo = async (id: string) => {
    const nodeExists = nodes.value.some(n => n.id === id);
    if (!nodeExists) throw new Error('Node not found');

    // 💡 点击后第一时间把 UI 切换为 syncing，再去做中转探测，
    // 避免探测耗时导致按钮/状态灯迟迟无反馈的卡顿感
    loading.value = true;
    error.value = null;

    updateNode(id, { status: 'syncing' });

    // 💡 刷新前先做一轮中转探测，刷新 healthyDomains 绿灯池，避免抽中离线中转
    // 冷却期/single-flight 保证并发调用只真正探测一轮
    await probeProxyPoolHealth();

    try {
      const currentNode = nodes.value.find(n => n.id === id)!;
      const ecdsaKey = currentNode.ecdsaPrivateKey || globalConfig.value.ecdsaPrivateKey || '';
      const eciesKey = currentNode.eciesPrivateKey || globalConfig.value.eciesPrivateKey || '';

      const client = new AgentClient({
        domain: currentNode.domain,
        eciesPrivateKey: eciesKey,
        ecdsaPrivateKey: ecdsaKey,
        timeout: 15000
      });

      const baseinfo = await client.getBaseInfo();
      console.log(`[Debug] 节点 ${currentNode.name} 获取到的 BaseInfo:`, baseinfo);
      
      // 1. 第一道防线：如果返回的是原始字符串，判定为明文或解密未对上
      if (typeof baseinfo === 'string') {
          throw new Error('数据解密或反序列化 JSON 失败，请检查 ECIES/ECDSA 密钥配置');
      }
      
      // 2. 第二道防线：刚性检查结构体合法性
      const isValidBaseInfo = baseinfo && typeof baseinfo === 'object' && ('arch' in baseinfo);
      
      if (!isValidBaseInfo) {
          throw new Error('中转网关异常或隧道断开 (Cloudflare Tunnel Error / Missing arch)');
      }
      
      // 💡 ✨ 3.【核心新增第三道防线：Session Key 安全门禁】
      // 即使返回了合法 JSON，只要 session_key 为空、不存在或为 null，
      // 立刻阻断连接放行，判定为认证失败，自动分流进入 error (ERR) 状态
      if (!baseinfo || !baseinfo.session_key) {
          throw new Error('安全加密认证失败：服务端返回的 Session Key 缺失 (密钥配置/Crypto 异常)');
      }
      
      // 🎯 【优化：仅当 IP 首次出现或发生变化时才请求 ISP 情报，减少 API 调用】
      // 💡 初始值不再默认 'isp'：真实类型未知前一律保持 'unknown'，避免凭空乱标
      let fetchedIpType: IpType = (currentNode.ipType as IpType) || 'unknown';
      let fetchedFlag = currentNode.flag || 'UNKNOWN';
      const prevIpv4 = currentNode.baseinfo?.ipv4;
      // 🏠 💡 探测触发规则（满足任一即重新请求）：
      //   1. IP 首次出现或发生变化
      //   2. 未勾选「保留IP信息」
      //   3. flag 或 ipType 任一未持久化
      //   4. 已持久化的 ipType 仍为 'unknown'（刷新/同步时重新尝试获取真实归属）
      const needIpLookup = baseinfo.ipv4 && (
        !prevIpv4 || prevIpv4 !== baseinfo.ipv4 ||
        !keepIpInfo.value || !currentNode.flag ||
        !currentNode.ipType || currentNode.ipType === 'unknown'
      );
      if (needIpLookup) {
        try {
          // 🌐 一体化情报探测（api.iping.cc → 国家不足时 api.country.is 兜底）：国旗 + ipType 同请求获取
          // 全部失败保底 'unknown'，绝不默认为 isp
          const ipv4 = baseinfo.ipv4 as string;
          const meta = await fetchIpMeta(ipv4);
          fetchedIpType = meta?.ipType ?? 'unknown';
          if (meta?.country) fetchedFlag = meta.country.toUpperCase();
        } catch (e) {
          console.warn('[IP Meta Probe] 探针无法透传该节点的公网 IP 情报分类:', e);
        }
      }

      // 4. 唯有通过全部安全防线，才允许标记为 online (ON)
      updateNode(id, {
        baseinfo,
        lastConnected: Date.now(),
        status: 'online',
        flag: fetchedFlag,
        ipType: fetchedIpType
      });

      return baseinfo;
    } catch (err: any) {
      error.value = err.message || 'Sync failed';

      // 智能分流判定
      const isCryptoOrConfigError = 
        err.message?.includes('Decryption') || 
        err.message?.includes('密钥配置') || 
        err.message?.includes('Crypto') ||
        err.statusCode === 500; 

      if (isCryptoOrConfigError) {
        updateNode(id, { status: 'error' }); 
      } else {
        // 🌟 上方抛出的“隧道断开(Missing arch)”由于不带密匙敏感字，会稳稳地掉进这里，
        // 将节点状态完美、准确地回写更新为 'offline'。
        updateNode(id, { status: 'offline' }); 
      }
      throw err;
    } finally {
      loading.value = false;
    }
  };

  const addNode = async (
    name: string,
    domain: string,
    eciesPrivateKey?: string,
    ecdsaPrivateKey?: string,
    incognitoMode?: boolean
  ) => {
    const newNode: AgentNode = {
      id: generateUUID(),
      name,
      domain,
      eciesPrivateKey: eciesPrivateKey?.trim() || undefined,
      ecdsaPrivateKey: ecdsaPrivateKey?.trim() || undefined,
      incognitoMode: incognitoMode ?? true, // 无痕模式默认开启
      createdAt: Date.now(),
      status: 'syncing'
    };

    nodes.value.push(newNode);
    saveToStorage();

    await syncNodeBaseInfo(newNode.id).catch(() => {
      const idx = nodes.value.findIndex(n => n.id === newNode.id);
      if (idx >= 0) nodes.value[idx].status = 'error';
    });

    return newNode.id;
  };

  const updateNode = (id: string, updates: Partial<AgentNode>) => {
    const idx = nodes.value.findIndex(n => n.id === id);
    if (idx === -1) return false;
    nodes.value[idx] = { ...nodes.value[idx], ...updates, updatedAt: Date.now() };
    saveToStorage();
    return true;
  };

  const deleteNode = (id: string) => {
    nodes.value = nodes.value.filter(n => n.id !== id);
    saveToStorage();
  };

  // 计算属性 - 实时过滤和排序后的节点列表
  const filteredSortedNodes = computed(() => {
    let result = [...nodes.value]

    // 第一步：根据在线/离线状态进行筛选
    if (filterStatus.value !== 'all') {
      result = result.filter(n => n.status === filterStatus.value)
    }

    // 🔍 第二步：关键词搜索（名称 / 域名 / IPv4 / IPv6）
    const kw = searchQuery.value.trim().toLowerCase()
    if (kw) {
      result = result.filter(n => {
        const name = (n.name || '').toLowerCase()
        const domain = (n.domain || '').toLowerCase()
        const ipv4 = (n.baseinfo?.ipv4 || '').toLowerCase()
        const ipv6 = (n.baseinfo?.ipv6 || '').toLowerCase()
        return name.includes(kw) || domain.includes(kw) || ipv4.includes(kw) || ipv6.includes(kw)
      })
    }

    // 第三步：执行排序逻辑
    result.sort((a, b) => {
      let valA: any = ''
      let valB: any = ''

      if (sortKey.value === 'name') {
        valA = (a.name || '').toLowerCase()
        valB = (b.name || '').toLowerCase()
      } else if (sortKey.value === 'createdAt') {
        valA = a.createdAt || 0
        valB = b.createdAt || 0
      } else if (sortKey.value === 'ip') {
        valA = a.baseinfo?.ipv4 || '0.0.0.0'
        valB = b.baseinfo?.ipv4 || '0.0.0.0'
      }

      if (valA < valB) return sortOrder.value === 'asc' ? -1 : 1
      if (valA > valB) return sortOrder.value === 'asc' ? 1 : -1
      return 0
    })

    return result
  })

  const syncAllNodes = async () => {
    // 批量同步期间抑制 saveToStorage 中的自动推送，统一在最后推送一次
    _suppressStatusPage = true;

    // 💡 点击后第一时间把所有节点标记为 syncing（先反馈 UI，再等中转探测）
    const now = Date.now();
    nodes.value = nodes.value.map(n => ({ ...n, status: 'syncing', updatedAt: now }));
    saveToStorage();

    // 💡 全部同步前只做一轮中转探测，刷新绿灯池后再批量分发；
    // syncNodeBaseInfo 内部的探测因冷却期/single-flight 复用本轮结果，不会逐节点重复请求
    await probeProxyPoolHealth();

    const syncWithRetry = async (id: string) => {
      try {
        return await syncNodeBaseInfo(id);
      } catch (firstErr) {
        const node = nodes.value.find(n => n.id === id);
        console.warn(`[Sync Retry] 节点“${node?.name || id}”首次同步失败，正在尝试立刻重试...`);
        try {
          return await syncNodeBaseInfo(id);
        } catch (secondErr) {
          console.error(`[Sync Failed] 节点“${node?.name || id}”二次重试依旧失败，已彻底放弃。`);
          throw secondErr;
        }
      }
    };

    const results = await Promise.allSettled(
      nodes.value.map(n => syncWithRetry(n.id))
    );

    // 全部节点同步完成，恢复自动推送并推送一次最终状态
    _suppressStatusPage = false;
    autoPushToStatusPage();

    const success = results.filter(r => r.status === 'fulfilled').length;
    return { success, total: nodes.value.length };
  };

  const exportConfig = (): string => {
    const payload = {
      version: '1.0',
      exportedAt: Date.now(),
      globalConfig: globalConfig.value,
      nodes: nodes.value
    };
    return JSON.stringify(payload, null, 2);
  };

  const importConfig = (json: string): { success: number; skipped: number } => {
    try {
      const parsed = JSON.parse(json);

      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.nodes)) {
        throw new Error('无效的配置文件格式：缺少节点列表');
      }

      const importedNodes = parsed.nodes as AgentNode[];
      const importedGlobalConfig = parsed.globalConfig as GlobalConfig;

      if (importedGlobalConfig) {
        saveGlobalConfig(importedGlobalConfig);
      }

      const existingIds = new Set(nodes.value.map(n => n.id));
      let success = 0, skipped = 0;

      for (const node of importedNodes) {
        if (!node.id || !node.name || !node.domain) continue;

        if (existingIds.has(node.id)) {
          const idx = nodes.value.findIndex(n => n.id === node.id);
          const current = nodes.value[idx];
          // 💡 内容完全一致则原样保留（不动 updatedAt、不丢本地探测缓存），
          //    防止重复导入/定时云同步反复刷新时间戳，造成"永远有变化"的同步死循环
          if (JSON.stringify(nodeStableSignature(current)) === JSON.stringify(nodeStableSignature(node))) {
            skipped++;
            continue;
          }
          nodes.value[idx] = {
            ...current,
            ...node,
            createdAt: node.createdAt ?? current.createdAt,
            updatedAt: Date.now(),
          };
          skipped++;
        } else {
          nodes.value.push({ ...node, createdAt: node.createdAt || Date.now() });
          success++;
        }
      }

      saveToStorage();
      return { success, skipped };
    } catch (e: any) {
      throw new Error(e.message || '导入失败，文件内容格式错误');
    }
  };

  const onlineCount = computed(() =>
    nodes.value.filter(n => n.status === 'online').length
  );

  // 初始化
  loadFromStorage();
  loadGlobalConfig();

  return {
    nodes,
    
    filterStatus,
    sortKey,
    sortOrder,
    searchQuery,
    filteredSortedNodes,
    viewMode,
    keepIpInfo,

    loading,
    error,
    onlineCount,
    addNode,
    updateNode,
    deleteNode,
    syncNodeBaseInfo,
    syncAllNodes,
    exportConfig,
    importConfig,
    globalConfig,
    saveGlobalConfig,
    refresh: loadFromStorage
  };
}