// src/lib/upload-chunk.ts
// 上传分块大小统一决策器 + 裸流分块重试执行器
// （FileManager.vue 文件管理器与 update.ts agent 自更新两条上传链路共用，勿在调用方各自硬编码）

/**
 * 串行逐块上传的主要开销是每块一次完整 HTTP 往返（中转链路还要过 PHP 反代两跳），
 * 吞吐上限 ≈ 块大小 ÷ 单块往返耗时，因此块越大吞吐越高。上限取值的两条约束：
 * - 中转：1MB 请求在中转机上秒级完成，数据仍常驻中转机内存（规避磁盘 I/O 与 504 挂起超时）；
 *   且 /api/fileraw 分块在 agent 端为幂等落盘，失败块可安全重试，单块失败半径可控。
 * - 直连：2MB 已长期验证稳定，维持不动。
 */
const UPLOAD_CHUNK_PROXY = 1 * 1024 * 1024;
const UPLOAD_CHUNK_DIRECT = 2 * 1024 * 1024;

/**
 * 按全局中转开关返回当前应使用的上传分块大小（字节）。
 * 开启中转返回 1MB，直连返回 2MB。
 */
export function getUploadChunkSize(): number {
  try {
    if (typeof window !== 'undefined') {
      const proxyRaw = localStorage.getItem('kisama_proxy_config');
      if (proxyRaw && JSON.parse(proxyRaw).enabled) {
        return UPLOAD_CHUNK_PROXY;
      }
    }
  } catch (e) {
    console.error('[Upload Chunk] 嗅探全局中转配置状态受限:', e);
  }
  return UPLOAD_CHUNK_DIRECT;
}

/** 裸流分块最大重试次数（不含首次尝试） */
const RAW_CHUNK_MAX_RETRIES = 2;
/** 每次重试前的等待间隔（毫秒），给中转线路喘息时间 */
const RAW_CHUNK_RETRY_DELAY_MS = 1000;

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * /api/fileraw 裸流分块重试执行器：失败自动重试至多 RAW_CHUNK_MAX_RETRIES 次，仍失败则原样抛出。
 * 🔥 安全前提（已核实 Kisama_agent 四条轨道 go/py/js/java）：agent 将每块写入
 * .upload_chunks 暂存文件 chunk_N（重复块覆盖写），收齐后按索引顺序合并 ——
 * 重复/乱序投递不会重复追加，超时中止的块重试不会损坏文件。
 * 每次重试会重新经过 pickProxyTunnel 随机盲选，天然更换中转线路。
 * ⚠️ 仅限 /api/fileraw；过期接口 /api/file 未按此核实，不得套用。
 */
export async function withRawChunkRetry<T>(attempt: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i <= RAW_CHUNK_MAX_RETRIES; i++) {
    try {
      return await attempt();
    } catch (e) {
      lastErr = e;
      if (i < RAW_CHUNK_MAX_RETRIES) await sleep(RAW_CHUNK_RETRY_DELAY_MS);
    }
  }
  throw lastErr;
}
