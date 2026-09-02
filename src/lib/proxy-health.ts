// src/lib/proxy-health.ts
// 中传代理站点池健康嗅探（共享模块）
// 判据与 task-daemon/Setting 一致：{domain}/kisamaproxy/https://api.cdnjs.com/libraries?limit=1 返回 2xx 即视为可用
// 特性：single-flight + 冷却期 —— 多个调用方（单节点刷新 / 全部同步 / 后台守护）并发触发时只真正执行一轮探测

const PROXY_CONFIG_KEY = 'kisama_proxy_config';
const PROBE_PATH = '/kisamaproxy/https://api.cdnjs.com/libraries?limit=1';
const PROBE_TIMEOUT_MS = 3000;
const COOLDOWN_MS = 10_000;

export interface ProxyPoolConfig {
  enabled: boolean;
  allSites?: boolean;
  domains: string[];
  healthyDomains?: string[];
}

let inflight: Promise<ProxyPoolConfig | null> | null = null;
let lastProbedAt = 0;

function readProxyConfig(): ProxyPoolConfig | null {
  try {
    const raw = localStorage.getItem(PROXY_CONFIG_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeProxyConfig(config: ProxyPoolConfig) {
  try {
    localStorage.setItem(PROXY_CONFIG_KEY, JSON.stringify(config));
  } catch (e) {
    console.error('[Proxy Health] 中转池回写失败:', e);
  }
}

/** 全局中转连接域名功能是否开启（开启且池中有站才允许探测） */
export function isProxyTunnelEnabled(): boolean {
  const parsed = readProxyConfig();
  return !!parsed?.enabled && Array.isArray(parsed.domains) && parsed.domains.length > 0;
}

async function doProbe(): Promise<ProxyPoolConfig | null> {
  const parsed = readProxyConfig();
  if (!parsed || !parsed.enabled || !Array.isArray(parsed.domains) || parsed.domains.length === 0) {
    lastProbedAt = Date.now();
    return parsed;
  }

  // 并发探测所有中传域名的存活状态（3 秒超时封顶，防止拖慢调用方）
  const results = await Promise.all(
    parsed.domains.map(async (domain: string) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
      try {
        const res = await fetch(`${domain}${PROBE_PATH}`, { method: 'GET', signal: controller.signal });
        return { domain, alive: res.ok && res.status >= 200 && res.status < 300 };
      } catch {
        return { domain, alive: false };
      } finally {
        clearTimeout(timeoutId);
      }
    })
  );

  const activeHealthyDomains = results.filter(r => r.alive).map(r => r.domain);
  const updated: ProxyPoolConfig = {
    ...parsed,
    // 全灭时平滑降级回全量池，与 Setting/task-daemon 原有策略保持一致
    healthyDomains: activeHealthyDomains.length > 0 ? activeHealthyDomains : parsed.domains
  };
  writeProxyConfig(updated);
  lastProbedAt = Date.now();
  console.log(`📡 [Proxy Health] 中传站点动态嗅探完成。可用: ${activeHealthyDomains.length}/${parsed.domains.length}`);
  return updated;
}

/**
 * 探测中转池健康状态（幂等）：
 * - 功能未开启（enabled=false 或池子为空）时零开销直接返回，绝不发起任何探测请求
 * - 冷却期内直接复用上次结果，不发起新请求
 * - 多个并发调用共享同一轮探测（single-flight）
 */
export function probeProxyPoolHealth(): Promise<ProxyPoolConfig | null> {
  const parsed = readProxyConfig();
  // 🚫 硬门禁：全局中转连接域名功能没开 → 不管自动探测还是手动探测一律不探测
  if (!isProxyTunnelEnabled()) return Promise.resolve(parsed);
  if (Date.now() - lastProbedAt < COOLDOWN_MS) return Promise.resolve(parsed);
  if (inflight) return inflight;
  inflight = doProbe().finally(() => {
    inflight = null;
  });
  return inflight;
}
