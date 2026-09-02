// src/lib/proto-detect.ts
/**
 * Agent 通信协议版本探测与记忆。
 *
 * agent 0.4.8 收紧了通信协议：
 *   - HTTP 签名消息由 2 段 (nonce+timestamp) 变为 5 段 (method\npath\nsha256(body)\nnonce\ntimestamp)
 *   - 超级终端 WS 明文降级模式 token 由 agent 公钥变为 HMAC(session_key)
 * 面板默认走 0.4.8 新协议 (v2)；连接旧版 agent 遇 401/白名单静默失败时自动降级 v1 并按节点记忆。
 *
 * 记忆存放在**模块级内存**中（不用 localStorage/sessionStorage）：
 *   - 不随「导出/云同步」等配置备份被带出；
 *   - 刷新页面即失效，下次加载重新按需探测（每个节点每次会话至多多两次探测请求）。
 *
 * ⚠️ 旧协议 (v1-legacy) 支持将于面板 0.6.0 彻底移除，本模块整体随之退役。
 */
import { isVersionAtLeast } from './version';

export const NEW_PROTO_AGENT_VERSION = '0.4.8';

/** ⚠️ LEGACY_AGENT_SUPPORT：旧协议支持的公开 EOL 版本号，UI 提示与代码标记共用（0.6.0 移除） */
export const LEGACY_AGENT_EOL = '0.6.0';

export type AgentProtoScheme = 'v2' | 'v1-legacy';

// 历史版本曾使用 localStorage（键前缀 kisama_agent_proto_），会被导出/云同步带出，
// 模块加载时顺手清理残留。
const LEGACY_STORAGE_KEY_PREFIX = 'kisama_agent_proto_';
const purgeLegacyStorageKeys = (): void => {
  try {
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(LEGACY_STORAGE_KEY_PREFIX)) doomed.push(k);
    }
    doomed.forEach((k) => localStorage.removeItem(k));
  } catch {
    // localStorage 不可用（隐私模式等）时静默跳过
  }
};
purgeLegacyStorageKeys();

const memoryStore = new Map<string, AgentProtoScheme>();

const storeKey = (domain: string): string =>
  String(domain || '')
    .replace(/^https?:\/\//i, '')
    .split('#')[0]
    .split('/')[0]
    .split('?')[0]
    .toLowerCase();

/** 读取节点已探测到的协议版本（未探测过返回 null，走默认 v2；页面刷新后清空） */
export function getProtoScheme(domain: string): AgentProtoScheme | null {
  return memoryStore.get(storeKey(domain)) ?? null;
}

/** 记忆节点探测到的协议版本（仅当前页面生命周期内有效） */
export function saveProtoScheme(domain: string, scheme: AgentProtoScheme): void {
  memoryStore.set(storeKey(domain), scheme);
}

/** 清除节点的协议探测记录（协议判定失准自愈时调用） */
export function clearProtoScheme(domain: string): void {
  memoryStore.delete(storeKey(domain));
}

/**
 * 判断 agent 版本是否运行旧协议（< 0.4.8）。
 * 版本未知（未连接过）返回 false，避免误报提示。
 * ⚠️ LEGACY_AGENT_SUPPORT（0.6.0 移除）
 */
export function isLegacyAgentVersion(version?: string | null): boolean {
  if (!version) return false;
  return !isVersionAtLeast(version, NEW_PROTO_AGENT_VERSION);
}
