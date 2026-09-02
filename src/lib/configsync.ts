// src/lib/configsync.ts
/**
 * ============================================================
 *  Kisama 配置云同步引擎（WebDAV · 分域合并策略）
 * ============================================================
 *
 * 【同步对象】
 *  远端文件 kisama.json —— 与「📤 导出」完全同构的全量备份包：
 *  {
 *    dataType: 'kisama_full_backup',
 *    version,
 *    nodes: { version, exportedAt, globalConfig, nodes: AgentNode[] },
 *    globalSettings: { proxy, statusPage, customStyle, customScript, extraStorage }
 *  }
 *
 * 【分域合并策略（借鉴 RFC 7386 JSON Merge Patch 设计理念）】
 *  RFC 7386 的核心原则：对象按键递归合并、标量域只整体替换、绝不拼接半新半旧状态。
 *  本引擎把备份包拆成两类域，分别套用不同规则：
 *
 *  ▌域 1：节点名单（有主键集合）
 *    - 按 node.id 取两侧并集；
 *    - 同 id 节点比较 updatedAt（缺省回退 createdAt），时间新者胜；
 *    - 等价于把数组建模为"以 id 为键的对象"后逐键 Last-Writer-Wins。
 *
 *  ▌域 2：其余全部设置（无主键标量域，含 proxy / statusPage / 样式 /
 *    脚本 / extraStorage / 全局密钥 globalConfig）
 *    - 作为一个整体，跟随「较新的一方」整域替换；
 *    - 「谁较新」不依赖系统时钟（跨设备时钟不可信），而是靠本地同步账本
 *      localStorage['kisama_sync_state'] 里记录的"上次成功同步时的内容快照"：
 *        · 本机内容 ≠ 账本快照 → 上次同步后本机改过 → 设置域听本机的；
 *        · 本机内容 =  账本快照 → 本机没动过 → 设置域听远端的；
 *        · 无账本（首次同步）   → 默认本机优先（操作者正坐在这台机器前）。
 *
 * 【三种局面自动路由】runConfigSync() 每次被调用（登录后 / 定时任务）时：
 *  1. 远端无文件 + 本地有节点   → 直接推送本地全量上去（pushed）
 *  2. 远端有文件 + 本地无节点   → 拉取远端并应用到本机（pulled）
 *  3. 双方都有                 → 快速通道：内容一致直接结束（in-sync）；
 *                                否则分域合并 → 先推远端 → 再应用本地（merged）
 *
 * 【安全带】
 *  - 覆盖远端前，旧 kisama.json 先另存 kisama.backup.json（仅保留最近一代）；
 *  - 远端 JSON 损坏 → 坏文件先挪进 backup 再按"远端无"自愈，绝不拿坏数据碰本地；
 *  - dataType 不识别的远端包拒绝应用并报错；
 *  - 模块级 single-flight 锁：登录触发与定时触发撞车时自动跳过后到者。
 *
 * 【收敛不变式（防循环推送的关键）】
 *  任何一次成功同步结束时，必然满足：本地 == 远端 == 账本快照。
 *  合并流程刻意采用「先应用本地 → 从落盘结果重建最终包 → 推送该最终包」的顺序，
 *  保证推上云端的字节与账本记录完全一致，因此定时任务每 10 分钟重复调用是幂等的。
 *
 * 【已知取舍（有意为之，保持简单）】
 *  - 同步不传播删除：A 机删除的节点会在 B 机复活（并集语义）。
 *    这是"永不因同步丢配置"的代价；批量删除请走导出/导入覆盖的老路。
 *  - 节点探测缓存字段（status/baseinfo/lastConnected/ipType/flag）不参与
 *    合并与比对，见 node-stable.ts。
 * ============================================================
 */

import { createWebDavClient, loadWebDavConfig, type WebDavClient } from './webdav';
import { useNodes } from '../composables/useNodes';
import { injectCustomStyle, injectCustomScript } from './runtime-inject';
import { nodeStableSignature } from './node-stable';
import { reportWebDavLink } from './webdav-status';

// ==================== 常量 ====================

/** 远端配置文件名（相对 basePath） */
export const REMOTE_CONFIG_FILE = 'kisama.json';
/** 覆盖远端前的最近一代留档 */
export const REMOTE_BACKUP_FILE = 'kisama.backup.json';

// ==================== 打包 / 应用（导出、导入、云同步三方共用） ====================

/**
 * 打包进 extraStorage 时需要排除的键：
 *  - agent_nodes_config：节点名单单独走顶层 nodes 字段
 *  - 四个旧版具名键：继续以 proxy/statusPage/customStyle/customScript 字段存在，
 *    保证「新版本导出的包」被「旧版本面板」导入时不丢这四项配置
 */
const BUNDLE_EXCLUDED_KEYS = [
  'agent_nodes_config',
  'kisama_proxy_config',
  'kisama_status_page_config',
  'kisama_custom_style',
  'kisama_custom_script',
  // ☁️ 同步账本是「设备本地」的记忆，绝不随备份包漫游：
  // 若被同步到他机，会使对方误判"本机自上次同步后没有改动"，进而错误让渡设置域归属权
  'kisama_sync_state_hash',
  'kisama_sync_state_at',
  'kisama_sync_state', // 旧版嵌套转义格式，仅作清理残留
];

/**
 * 构建全量备份包。
 * @param options.forCloudSync 云同步专用：额外排除 kisama_webdav_config。
 *        WebDAV 连接参数是"连上远端的前提"，被远端数据反向覆盖属于本末倒置
 *        （换设备时若包里带着旧地址，还会悄悄把本机刚填好的连接信息冲掉）；
 *        本地 📤 导出不传此参，维持原行为（含 WebDAV 配置）。
 */
export const buildFullBackupBundle = (options: { forCloudSync?: boolean } = {}) => {
  const { exportConfig } = useNodes();
  const excludedKeys = options.forCloudSync
    ? [...BUNDLE_EXCLUDED_KEYS, 'kisama_webdav_config']
    : BUNDLE_EXCLUDED_KEYS;

  // 除排除清单外，把 localStorage 其余全部键值以「原始字符串」形式无损收录，
  // 不做任何 parse/stringify 往返，确保恢复时逐字节还原、绝不变形
  const extraStorage: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || excludedKeys.includes(key)) continue;
    const raw = localStorage.getItem(key);
    if (raw === null) continue;
    extraStorage[key] = raw;
  }

  return {
    dataType: 'kisama_full_backup' as const,
    version: '1.1.0',
    nodes: JSON.parse(exportConfig()),
    globalSettings: {
      proxy: JSON.parse(localStorage.getItem('kisama_proxy_config') || 'null'),
      statusPage: JSON.parse(localStorage.getItem('kisama_status_page_config') || 'null'),
      customStyle: localStorage.getItem('kisama_custom_style') || '',
      customScript: localStorage.getItem('kisama_custom_script') || '',
      extraStorage,
    },
  };
};

/**
 * 应用全量备份包到本机。
 * @param options.fromCloudSync 云同步链路专用：即使包里带了 kisama_webdav_config
 *        （如旧版本推送的历史文件）也拒绝覆盖本机连接配置，防止自断连接。
 */
export const applyFullBackupBundle = (json: any, options: { fromCloudSync?: boolean } = {}) => {
  const { importConfig } = useNodes();
  // 1. 还原节点资产
  importConfig(JSON.stringify(json.nodes));

  const gs = json.globalSettings || {};

  // 2. 还原旧版四个具名键（同时兼容旧版备份包：老包只有这四个字段）
  if (gs.proxy) {
    localStorage.setItem('kisama_proxy_config', JSON.stringify(gs.proxy));
  }
  if (gs.statusPage) {
    localStorage.setItem('kisama_status_page_config', JSON.stringify(gs.statusPage));
  }
  if (gs.customStyle !== undefined) {
    localStorage.setItem('kisama_custom_style', gs.customStyle);
    injectCustomStyle(gs.customStyle);
  }
  if (gs.customScript !== undefined) {
    localStorage.setItem('kisama_custom_script', gs.customScript);
    injectCustomScript(gs.customScript);
  }

  // 3. 还原 v1.1 全量键值（原始字符串逐字节写回，保证与导出前完全一致）
  if (gs.extraStorage && typeof gs.extraStorage === 'object') {
    Object.entries(gs.extraStorage).forEach(([key, raw]) => {
      // ☁️ 云同步链路：WebDAV 连接参数只属于本机，绝不接受远端反向覆盖
      if (options.fromCloudSync && key === 'kisama_webdav_config') return;
      localStorage.setItem(key, String(raw));
    });
    // 主题是少数有运行时热态的键，还原后立即生效
    const theme = (gs.extraStorage as Record<string, string>)['kisama_theme'];
    if (theme === 'dark' || theme === 'light') {
      document.documentElement.setAttribute('data-theme', theme);
    }
  }
};

// ==================== 内容比对基建 ====================

/** 递归稳定化序列化：键排序，消除键序差异造成的假性变化 */
const stableStringify = (v: any): any => {
  if (Array.isArray(v)) return v.map(stableStringify);
  if (v && typeof v === 'object') {
    return Object.keys(v).sort().reduce((o: Record<string, any>, k) => {
      o[k] = stableStringify(v[k]);
      return o;
    }, {});
  }
  return v;
};

const nodesListOf = (bundle: any): any[] =>
  Array.isArray(bundle?.nodes?.nodes) ? bundle.nodes.nodes : [];

/** 内容指纹：节点稳定特征（按 id 排序）+ 设置域整体。与 exportedAt 等易变字段无关 */
const canonicalize = (bundle: any): string =>
  JSON.stringify(stableStringify({
    n: nodesListOf(bundle)
      .map(nodeStableSignature)
      .sort((a: any, b: any) => String(a.id).localeCompare(String(b.id))),
    g: { gc: bundle?.nodes?.globalConfig ?? null, gs: bundle?.globalSettings ?? null },
  }));

/** 域 1 合并：按 id 并集，同 id 取 updatedAt 新者（平局偏向 local） */
export function mergeNodesById(localNodes: any[], remoteNodes: any[]): any[] {
  const stampOf = (n: any) => n?.updatedAt ?? n?.createdAt ?? 0;
  const map = new Map<string, { node: any; ts: number; local: boolean }>();
  for (const n of localNodes) {
    if (!n?.id) continue;
    map.set(n.id, { node: n, ts: stampOf(n), local: true });
  }
  for (const n of remoteNodes) {
    if (!n?.id) continue;
    const cur = map.get(n.id);
    if (!cur) map.set(n.id, { node: n, ts: stampOf(n), local: false });
    else if (stampOf(n) > cur.ts) map.set(n.id, { node: n, ts: stampOf(n), local: false });
    // 平局或远端更旧 → 保留现有
  }
  return Array.from(map.values()).map(e => e.node);
}

// ==================== 本地同步账本 ====================
// 平铺双键存储：hash 原文直存，无 JSON 嵌套转义，肉眼可查、体积零浪费

interface SyncState { hash: string; at: number }

const SYNC_STATE_HASH_KEY = 'kisama_sync_state_hash';
const SYNC_STATE_AT_KEY = 'kisama_sync_state_at';

const loadSyncState = (): SyncState | null => {
  try {
    // 迁移清理：移除旧版嵌套转义格式的账本（其内容已不可信，清空后按"首次同步"重新建立）
    if (localStorage.getItem('kisama_sync_state') !== null) {
      localStorage.removeItem('kisama_sync_state');
    }
    const hash = localStorage.getItem(SYNC_STATE_HASH_KEY);
    if (!hash) return null;
    return { hash, at: Number(localStorage.getItem(SYNC_STATE_AT_KEY) || 0) };
  } catch {
    return null;
  }
};

const saveSyncState = (hash: string) => {
  try {
    localStorage.setItem(SYNC_STATE_HASH_KEY, hash);
    localStorage.setItem(SYNC_STATE_AT_KEY, String(Date.now()));
  } catch { /* 存储满等异常不阻塞同步主流程 */ }
};

// ==================== 同步主入口 ====================

export type ConfigSyncOutcome =
  | 'no-login'  // 未登录 WebDAV，静默跳过
  | 'busy'      // 上一轮尚未结束（single-flight）
  | 'in-sync'   // 双方内容一致，无事发生
  | 'pushed'    // 远端缺失/损坏，已用本地覆盖修复
  | 'pulled'    // 本地无节点，已拉取云端应用
  | 'merged'    // 双方都有，已分域合并
  | 'error';    // 失败（网络/格式等），数据未动

export interface ConfigSyncOptions {
  /** UI 通知回调（定时任务可不传，库内仅 console 记录） */
  notify?: (message: string, type?: 'success' | 'error' | 'info') => void;
}

let _running = false;

/** 会话级缓存：本页面生命周期内已确认存在的远端根目录，避免每轮定时同步重复探测 */
const ensuredBaseDirs = new Set<string>();

const ensureRemoteBaseDir = async (client: WebDavClient): Promise<void> => {
  const cfg = loadWebDavConfig();
  const key = `${cfg?.serverUrl ?? ''}|${cfg?.basePath ?? ''}`;
  if (ensuredBaseDirs.has(key)) return;
  await client.ensureBaseDir();
  ensuredBaseDirs.add(key);
};

/**
 * 配置云同步主入口 —— 自动识别三种局面并路由到对应策略。
 * 幂等：可被登录流程与定时任务随意重复调用，收敛后重复调用不再产生任何写入。
 * 每轮结束时向全局 webdav-status 上报链路健康，供首页「已登录」按钮展示现状。
 */
export async function runConfigSync(options: ConfigSyncOptions = {}): Promise<ConfigSyncOutcome> {
  const outcome = await runConfigSyncCore(options);

  if (outcome === 'pushed' || outcome === 'pulled' || outcome === 'merged' || outcome === 'in-sync') {
    reportWebDavLink('ok');
  } else if (outcome === 'no-login') {
    reportWebDavLink('unknown');
  }
  // 'busy' 不改变现有状态；'error' 已在 core 内部携带错误信息上报

  return outcome;
}

async function runConfigSyncCore(options: ConfigSyncOptions = {}): Promise<ConfigSyncOutcome> {
  const notify = options.notify;

  if (_running) {
    console.info('[ConfigSync] 上一轮同步尚未结束，本次触发跳过');
    return 'busy';
  }
  _running = true;

  try {
    const client = createWebDavClient();
    if (!client) {
      console.info('[ConfigSync] 未登录 WebDAV，跳过');
      return 'no-login';
    }

    const localBundle = buildFullBackupBundle({ forCloudSync: true });

    // 推送前懒确保远端根目录存在：首轮探测/建目录，之后命中会话缓存零额外请求
    let baseDirReady = false;
    const ensureBaseDirForPush = async () => {
      if (baseDirReady) return;
      await ensureRemoteBaseDir(client);
      baseDirReady = true;
    };
    const localHasNodes = nodesListOf(localBundle).length > 0;
    const localCanonical = canonicalize(localBundle);

    const remoteRaw = await client.downloadText(REMOTE_CONFIG_FILE);

    // ---------- 局面 1：远端无配置 ----------
    if (remoteRaw === null || remoteRaw.trim() === '') {
      if (!localHasNodes) {
        console.info('[ConfigSync] 本地与远端均无有效配置');
        return 'in-sync';
      }
      await ensureBaseDirForPush();
      await client.uploadText(REMOTE_CONFIG_FILE, JSON.stringify(localBundle, null, 2));
      saveSyncState(localCanonical);
      notify?.('☁️ 云端不存在 kisama.json，已推送本地全量配置', 'success');
      return 'pushed';
    }

    // ---------- 远端损坏自愈 ----------
    let remoteBundle: any;
    try {
      remoteBundle = JSON.parse(remoteRaw);
    } catch {
      if (!localHasNodes) {
        reportWebDavLink('error', '远端配置损坏且本地无节点，需人工处理');
        notify?.('❌ 远端 kisama.json 已损坏且本地无节点配置，需人工处理（坏文件可从 backup 找回）', 'error');
        return 'error';
      }
      // 安全带：坏文件挪入 backup 留档，再用本地配置自愈
      await ensureBaseDirForPush();
      try { await client.uploadText(REMOTE_BACKUP_FILE, remoteRaw); } catch { /* 留档失败不阻塞自愈 */ }
      await client.uploadText(REMOTE_CONFIG_FILE, JSON.stringify(localBundle, null, 2));
      saveSyncState(localCanonical);
      notify?.('⚠️ 远端配置已损坏（坏文件已存入 kisama.backup.json），已用本地配置修复', 'info');
      return 'pushed';
    }

    // ---------- 格式门禁 ----------
    if (remoteBundle?.dataType !== 'kisama_full_backup') {
      reportWebDavLink('error', '远端文件不是 Kisama 备份包格式');
      notify?.('❌ 远端 kisama.json 不是 Kisama 全量备份包格式，已中止同步以防误伤', 'error');
      return 'error';
    }

    // ---------- 局面 2：远端有 / 本地无节点 ----------
    if (!localHasNodes) {
      applyFullBackupBundle(remoteBundle, { fromCloudSync: true });
      // 应用后从真实落盘结果重建最终包（统一节点时间戳），归一化远端并记账
      const final = buildFullBackupBundle({ forCloudSync: true });
      await ensureBaseDirForPush();
      await client.uploadText(REMOTE_CONFIG_FILE, JSON.stringify(final, null, 2));
      saveSyncState(canonicalize(final));
      notify?.('☁️ 本地暂无节点配置，已从云端拉取并应用', 'success');
      return 'pulled';
    }

    // ---------- 局面 3：双方都有 ----------
    const remoteCanonical = canonicalize(remoteBundle);

    // 快速通道：内容一致，顺手校准账本即可收工
    if (localCanonical === remoteCanonical) {
      saveSyncState(localCanonical);
      return 'in-sync';
    }

    // 安全带：覆盖远端前先把当前远端内容留档一代
    await ensureBaseDirForPush();
    try {
      await client.uploadText(REMOTE_BACKUP_FILE, remoteRaw);
    } catch (e) {
      console.warn('[ConfigSync] 远端留档失败（继续合并，但将失去上一代备份）:', e);
    }

    // 域 2 择主：账本判定本机自上次同步后是否有改动
    const state = loadSyncState();
    const localChanged = state ? state.hash !== localCanonical : true;

    const winner = localChanged ? localBundle : remoteBundle;
    console.info(`[ConfigSync] 设置域归属：${localChanged ? '本机（上次同步后有改动）' : '云端（本机未动过）'}`);

    // 域 1 合并：节点并集
    const mergedNodes = mergeNodesById(nodesListOf(localBundle), nodesListOf(remoteBundle));

    // 先应用到本地（importConfig 会原样保留未变化的节点，仅对新增/变化节点刷新时间戳）
    applyFullBackupBundle({
      dataType: 'kisama_full_backup',
      version: winner.version ?? '1.1.0',
      nodes: { ...(winner.nodes || {}), nodes: mergedNodes },
      globalSettings: winner.globalSettings,
    }, { fromCloudSync: true });

    // 再从真实落盘结果重建最终包，推上云端并记账 —— 三方从此完全一致
    const final = buildFullBackupBundle({ forCloudSync: true });
    await client.uploadText(REMOTE_CONFIG_FILE, JSON.stringify(final, null, 2));
    saveSyncState(canonicalize(final));

    notify?.(`🔀 配置已分域合并：节点并集 ${mergedNodes.length} 个 · ${localChanged ? '设置以本机为准' : '设置以云端为准'}`, 'success');
    return 'merged';

  } catch (err: any) {
    console.error('[ConfigSync] 同步失败:', err);
    reportWebDavLink('error', err?.message || String(err));
    notify?.(`云同步失败: ${err.message || err}`, 'error');
    return 'error';
  } finally {
    _running = false;
  }
}
