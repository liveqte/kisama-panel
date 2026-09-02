// src/lib/webdav.ts
/**
 * WebDAV 客户端库 —— 为配置文件云端同步（备份 / 恢复）提供底层支持
 * 能力：连接测试、目录管理、上传下载、移动复制删除、远端元信息查询，
 * 以及本地与远端配置的新旧对比（决定同步方向：本地上传覆盖远端，还是远程下载覆盖本地）
 */

// ==================== 类型定义 ====================

export interface WebDavOptions {
  /** 服务器地址，例如 https://dav.example.com/dav */
  serverUrl: string;
  username?: string;
  password?: string;
  /** 远端根目录（配置文件存放目录），例如 /kisama/configs */
  basePath?: string;
  /**
   * 中转域名（可选）：设置后所有请求改走
   * https://<中转域名>/kisamaproxy/<原始URL> 转发，
   * 用于解除浏览器对 WebDAV 服务器的 CORS 限制。
   * 与「⚙️ 设置 → 全局网络中转配置」使用同一套中转站资源。
   */
  proxyDomain?: string;
  /** 单请求超时毫秒数，默认 15000 */
  timeout?: number;
}

export interface WebDavResourceInfo {
  path: string;
  filename: string;
  isDirectory: boolean;
  /** 字节数；目录为 0 */
  size: number;
  /** 最后修改时间（epoch ms），服务器未提供时为 0 */
  lastModified: number;
  etag?: string;
  contentType?: string;
}

/** 本地文件快照：参与新旧对比的本地侧信息；传 null 表示本地不存在该文件 */
export interface LocalFileSnapshot {
  content: string | Uint8Array;
  /** 本地最后修改时间（epoch ms） */
  modifiedAt: number;
}

export type SyncDirection =
  | 'upload-local'    // 本地较新：应把本地配置上传覆盖远端
  | 'download-remote' // 远端较新：应把远程配置下载下来覆盖本地
  | 'in-sync'         // 内容一致，无需任何操作
  | 'conflict';       // 双方内容不同且时间接近（疑似两端都被改过），需人工裁决

export interface SyncComparison {
  direction: SyncDirection;
  /** 判定原因（中文，可直接展示到 UI） */
  reason: string;
  localExists: boolean;
  remoteExists: boolean;
  contentIdentical: boolean;
  localMtime?: number;
  remoteMtime?: number;
  remoteEtag?: string;
  localHash?: string;
  remoteHash?: string;
}

export type ConflictStrategy = 'manual' | 'prefer-local' | 'prefer-remote';

export interface SyncRunOptions {
  /** 冲突处理策略，默认 manual（不执行动作，交由上层裁决） */
  conflictStrategy?: ConflictStrategy;
  /** 仅做决策不实际传输，默认 false */
  dryRun?: boolean;
  /** 双方修改时间差小于该值（毫秒）且内容不同时视为冲突，默认 2000 */
  timeSkewToleranceMs?: number;
}

export interface SyncRunResult {
  comparison: SyncComparison;
  action: 'uploaded' | 'downloaded' | 'skipped' | 'conflict';
  /** action 为 downloaded 时返回远端内容；本地快照是字符串则返回解码后的文本，否则返回原始字节 */
  content?: string | Uint8Array;
}

export class WebDavError extends Error {
  readonly statusCode: number;
  readonly method: string;
  readonly path: string;
  constructor(message: string, statusCode: number, method: string, path: string) {
    super(message);
    this.name = 'WebDavError';
    this.statusCode = statusCode;
    this.method = method;
    this.path = path;
  }
}

// ==================== 内部助手 ====================

const PROPFIND_BODY = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:">
  <d:prop><d:displayname/><d:resourcetype/><d:getcontentlength/><d:getlastmodified/><d:getetag/><d:getcontenttype/></d:prop>
</d:propfind>`;

function toBytes(content: string | Uint8Array): Uint8Array {
  return typeof content === 'string' ? new TextEncoder().encode(content) : content;
}

/**
 * 内容哈希：优先 SHA-256（需安全上下文 https/localhost），
 * 非安全上下文自动退化为 FNV-1a 32 位（仅用于相等性比对，配置文本场景足够）
 */
async function hashContent(content: string | Uint8Array): Promise<string> {
  const bytes = toBytes(content);
  if (globalThis.crypto?.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource);
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return `fnv1a-${(h >>> 0).toString(16).padStart(8, '0')}`;
}

function findByLocalName(root: Element | Document, name: string): Element[] {
  return Array.from(root.getElementsByTagName('*')).filter(el => el.localName === name);
}

function textOf(el: Element | undefined): string | undefined {
  return el?.textContent ?? undefined;
}

/** 解析 PROPFIND 的 multistatus 响应（兼容各服务器的命名空间前缀差异） */
function parseMultistatus(xmlText: string): WebDavResourceInfo[] {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new WebDavError('PROPFIND 响应 XML 解析失败', 500, 'PROPFIND', '');
  }
  return findByLocalName(doc, 'response').map(node => {
    const href = decodeURIComponent(textOf(findByLocalName(node, 'href')[0]) || '');
    const isDir = findByLocalName(node, 'collection').length > 0;
    const size = parseInt(textOf(findByLocalName(node, 'getcontentlength')[0]) || '0', 10) || 0;
    const modifiedRaw = textOf(findByLocalName(node, 'getlastmodified')[0]);
    const modified = modifiedRaw ? new Date(modifiedRaw).getTime() : NaN;
    const cleanPath = href.replace(/\/+$/, '') || '/';
    return {
      path: cleanPath,
      filename: cleanPath.substring(cleanPath.lastIndexOf('/') + 1),
      isDirectory: isDir,
      size,
      lastModified: Number.isNaN(modified) ? 0 : modified,
      etag: textOf(findByLocalName(node, 'getetag')[0]) || undefined,
      contentType: textOf(findByLocalName(node, 'getcontenttype')[0]) || undefined,
    };
  });
}

// ==================== 客户端主体 ====================

export class WebDavClient {
  private readonly serverRoot: string;
  private readonly basePath: string;
  private readonly proxyDomain: string;
  private readonly headers: Record<string, string>;
  private readonly timeout: number;
  /** 服务器与本机的时钟偏移（server - local，毫秒），懒测量并缓存，用于消除跨机器时钟不一致的误判 */
  private clockOffsetMs: number | null = null;

  constructor(options: WebDavOptions) {
    const rawUrl = options.serverUrl.trim();
    if (!/^https?:\/\//i.test(rawUrl)) {
      throw new Error(`serverUrl 必须以 http(s):// 开头: ${rawUrl}`);
    }
    this.serverRoot = rawUrl.replace(/\/+$/, '');
    this.basePath = (options.basePath || '').replace(/^\/+|\/+$/g, '');
    this.proxyDomain = (options.proxyDomain || '').trim();
    this.timeout = options.timeout ?? 15_000;
    this.headers = { Accept: '*/*' };
    if (options.username || options.password) {
      const credBytes = new TextEncoder().encode(`${options.username ?? ''}:${options.password ?? ''}`);
      let binary = '';
      credBytes.forEach(b => (binary += String.fromCharCode(b)));
      this.headers['Authorization'] = `Basic ${btoa(binary)}`;
    }
  }

  /** 拼接完整 URL：basePath + remotePath，逐段编码，容忍两端多余的斜杠 */
  private buildUrl(remotePath: string): string {
    const segs = [...this.basePath.split('/'), ...remotePath.split('/')]
      .map(s => s.trim())
      .filter(Boolean)
      .map(encodeURIComponent);
    return segs.length ? `${this.serverRoot}/${segs.join('/')}` : this.serverRoot;
  }

  /**
   * 可选中转包裹：把直连 URL 包裹为 https://<中转>/kisamaproxy/<直连URL>，
   * 借中转站服务端转发以解除浏览器 CORS 限制；未配置中转时原样返回
   */
  private wrapProxy(directUrl: string): string {
    const raw = this.proxyDomain;
    if (!raw) return directUrl;
    const base = (/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).replace(/\/+$/, '');
    return `${base}/kisamaproxy/${directUrl}`;
  }

  private async request(
    method: string,
    remotePath: string,
    init: { headers?: Record<string, string>; body?: BodyInit; responseType?: 'text' | 'arraybuffer' } = {}
  ): Promise<{ status: number; headers: Record<string, string>; data: string | ArrayBuffer }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    try {
      const res = await fetch(this.wrapProxy(this.buildUrl(remotePath)), {
        method,
        headers: { ...this.headers, ...init.headers },
        body: init.body,
        signal: controller.signal,
      });
      const resHeaders: Record<string, string> = {};
      res.headers.forEach((v, k) => (resHeaders[k.toLowerCase()] = v));
      const data = init.responseType === 'arraybuffer' ? await res.arrayBuffer() : await res.text();
      return { status: res.status, headers: resHeaders, data };
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        throw new WebDavError(`请求超时 (${this.timeout}ms): ${method} ${remotePath}`, 0, method, remotePath);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  private assertOk(
    res: { status: number },
    method: string,
    remotePath: string,
    allowed: number[] = [200, 201, 204]
  ): void {
    if (!allowed.includes(res.status)) {
      throw new WebDavError(`${method} 失败 (HTTP ${res.status}): ${remotePath}`, res.status, method, remotePath);
    }
  }

  // -------------------- 连接与元信息 --------------------

  /**
   * 测试连通性与认证：对根目录发起 Depth:0 PROPFIND
   * 通过则静默返回；401 抛出带友好提示的 WebDavError，其余错误原样抛出
   */
  async testConnection(): Promise<void> {
    try {
      await this.stat('');
    } catch (err) {
      if (err instanceof WebDavError && err.statusCode === 401) {
        throw new WebDavError('WebDAV 认证失败：请检查用户名与密码', 401, 'PROPFIND', '/');
      }
      throw err;
    }
  }

  /**
   * 确保远程根目录（basePath）存在：
   * 先用一次 Depth:0 PROPFIND 探测，已存在则到此为止；
   * 缺失时才逐级 MKCOL 创建（已存在的层自动跳过）
   */
  async ensureBaseDir(): Promise<void> {
    if (!this.basePath) return;
    const self = await this.stat('');
    if (self) return;
    await this.mkdirp(this.basePath);
  }

  /** 查询单个资源信息；404 返回 null */
  async stat(remotePath: string): Promise<WebDavResourceInfo | null> {
    const res = await this.request('PROPFIND', remotePath, {
      headers: { Depth: '0', 'Content-Type': 'application/xml;charset=utf-8' },
      body: PROPFIND_BODY,
    });
    if (res.status === 404) return null;
    this.assertOk(res, 'PROPFIND', remotePath, [207]);
    return parseMultistatus(String(res.data))[0] ?? null;
  }

  async exists(remotePath: string): Promise<boolean> {
    return (await this.stat(remotePath)) !== null;
  }

  /** 列出目录下的一级子项；目录不存在返回 []（自动剔除目录自身的自引用条目） */
  async list(remotePath = ''): Promise<WebDavResourceInfo[]> {
    const target = remotePath.replace(/\/+$/g, '');
    const res = await this.request('PROPFIND', target, {
      headers: { Depth: '1', 'Content-Type': 'application/xml;charset=utf-8' },
      body: PROPFIND_BODY,
    });
    if (res.status === 404) return [];
    this.assertOk(res, 'PROPFIND', target, [207]);
    const all = parseMultistatus(String(res.data));
    const selfPath = all[0]?.path;
    return all.filter(item => item.path !== selfPath);
  }

  // -------------------- 目录管理 --------------------

  /** 创建单级目录；已存在（HTTP 405）视为成功 */
  async mkdir(remotePath: string): Promise<void> {
    const res = await this.request('MKCOL', remotePath);
    this.assertOk(res, 'MKCOL', remotePath, [201, 405]);
  }

  /** 递归创建多级目录（逐级 MKCOL，已存在自动跳过） */
  async mkdirp(remotePath: string): Promise<void> {
    let cur = '';
    for (const part of remotePath.split('/').filter(Boolean)) {
      cur = `${cur}/${part}`;
      await this.mkdir(cur);
    }
  }

  // -------------------- 上传下载 --------------------

  /** 下载文本内容（UTF-8）；404 返回 null */
  async downloadText(remotePath: string): Promise<string | null> {
    const res = await this.request('GET', remotePath);
    if (res.status === 404) return null;
    this.assertOk(res, 'GET', remotePath);
    return String(res.data);
  }

  /** 下载二进制内容；404 返回 null */
  async downloadBinary(remotePath: string): Promise<Uint8Array | null> {
    const res = await this.request('GET', remotePath, { responseType: 'arraybuffer' });
    if (res.status === 404) return null;
    this.assertOk(res, 'GET', remotePath);
    return new Uint8Array(res.data as ArrayBuffer);
  }

  /** 上传文本内容，默认自动创建父级目录 */
  async uploadText(remotePath: string, content: string, options: { ensureParents?: boolean } = {}): Promise<void> {
    await this.uploadBinary(remotePath, new TextEncoder().encode(content), options);
  }

  /** 上传二进制内容，默认自动创建父级目录 */
  async uploadBinary(remotePath: string, content: Uint8Array, options: { ensureParents?: boolean } = {}): Promise<void> {
    if (options.ensureParents !== false) {
      const idx = remotePath.lastIndexOf('/');
      if (idx > 0) await this.mkdirp(remotePath.slice(0, idx));
    }
    const res = await this.request('PUT', remotePath, {
      headers: { 'Content-Type': 'application/octet-stream' },
      body: content as unknown as BodyInit,
    });
    this.assertOk(res, 'PUT', remotePath);
  }

  // -------------------- 删除与移动 --------------------

  /** 删除资源；目标不存在视为成功（幂等） */
  async delete(remotePath: string): Promise<void> {
    const res = await this.request('DELETE', remotePath);
    this.assertOk(res, 'DELETE', remotePath, [200, 204, 404]);
  }

  /** 移动 / 重命名（Overwrite: T，目标存在时直接覆盖） */
  async move(fromPath: string, toPath: string): Promise<void> {
    const res = await this.request('MOVE', fromPath, {
      headers: { Destination: this.buildUrl(toPath), Overwrite: 'T' },
    });
    this.assertOk(res, 'MOVE', fromPath, [200, 201, 204]);
  }

  /** 复制（Overwrite: T，目标存在时直接覆盖） */
  async copy(fromPath: string, toPath: string): Promise<void> {
    const res = await this.request('COPY', fromPath, {
      headers: { Destination: this.buildUrl(toPath), Overwrite: 'T' },
    });
    this.assertOk(res, 'COPY', fromPath, [200, 201, 204]);
  }

  // -------------------- 同步决策核心 --------------------

  /**
   * 测量服务器与本机的时钟偏移（毫秒），结果缓存复用。
   * 跨机器比较"谁更新"之前先校准时间基准，避免双方系统时间不一致导致误判。
   */
  async measureClockOffset(): Promise<number> {
    const res = await this.request('OPTIONS', '');
    const serverNow = new Date(res.headers['date'] || '').getTime();
    this.clockOffsetMs = Number.isNaN(serverNow) ? 0 : serverNow - Date.now();
    return this.clockOffsetMs;
  }

  private async getClockOffset(): Promise<number> {
    return this.clockOffsetMs !== null ? this.clockOffsetMs : await this.measureClockOffset();
  }

  /**
   * 新旧对比核心：判定同步方向
   * 规则：
   *  1. 一侧缺失 → 存在的一侧为源（upload-local / download-remote）
   *  2. 内容哈希一致 → in-sync
   *  3. 内容不同 → 校准时钟后比较修改时间：相差在容差内视为 conflict，
   *     否则新的一方获胜；无法获取远端修改时间时保守判为 conflict
   */
  async compareWithRemote(
    local: LocalFileSnapshot | null,
    remotePath: string,
    options: { timeSkewToleranceMs?: number } = {}
  ): Promise<SyncComparison> {
    const tolerance = options.timeSkewToleranceMs ?? 2_000;
    const remoteInfo = await this.stat(remotePath);

    if (!local || !remoteInfo) {
      if (!local && !remoteInfo) {
        return { direction: 'in-sync', reason: '本地与远端均不存在该文件', localExists: false, remoteExists: false, contentIdentical: true };
      }
      if (local) {
        return {
          direction: 'upload-local',
          reason: '远端不存在该配置，将上传本地版本',
          localExists: true, remoteExists: false, contentIdentical: false,
          localMtime: local.modifiedAt, localHash: await hashContent(local.content),
        };
      }
      return {
        direction: 'download-remote',
        reason: '本地不存在该配置，将从远端下载',
        localExists: false, remoteExists: true, contentIdentical: false,
        remoteMtime: remoteInfo!.lastModified, remoteEtag: remoteInfo!.etag,
      };
    }

    const localHash = await hashContent(local!.content);
    const remoteData = await this.downloadBinary(remotePath);
    const base: SyncComparison = {
      direction: 'in-sync',
      reason: '',
      localExists: true,
      remoteExists: true,
      contentIdentical: false,
      localMtime: local!.modifiedAt,
      remoteMtime: remoteInfo.lastModified,
      remoteEtag: remoteInfo.etag,
      localHash,
    };

    if (!remoteData) {
      return { ...base, direction: 'conflict', reason: '远端内容读取失败（可能已被并发删除），请重试或人工处理' };
    }
    const remoteHash = await hashContent(remoteData);
    base.remoteHash = remoteHash;

    if (localHash === remoteHash) {
      return { ...base, direction: 'in-sync', contentIdentical: true, reason: '本地与远端内容完全一致，无需同步' };
    }

    const offset = await this.getClockOffset();
    const localEffective = local!.modifiedAt + offset;
    const remoteMtime = remoteInfo.lastModified;

    if (remoteMtime <= 0) {
      return { ...base, direction: 'conflict', reason: '双方内容不同且远端未提供修改时间，无法自动裁决' };
    }
    if (Math.abs(remoteMtime - localEffective) <= tolerance) {
      return { ...base, direction: 'conflict', reason: '双方内容均被修改且时间几乎相同，需要人工选择保留哪一方' };
    }
    if (localEffective > remoteMtime) {
      return { ...base, direction: 'upload-local', reason: `本地版本较新（本地 ${new Date(localEffective).toLocaleString()} > 远端 ${new Date(remoteMtime).toLocaleString()}），将上传覆盖远端` };
    }
    return { ...base, direction: 'download-remote', reason: `远端版本较新（远端 ${new Date(remoteMtime).toLocaleString()} > 本地 ${new Date(localEffective).toLocaleString()}），将下载覆盖本地` };
  }

  /**
   * 一站式同步：对比 → 按方向执行传输
   * - upload-local：把本地内容 PUT 到远端
   * - download-remote：下载远端内容返回给调用方（由调用方写回本地文件）
   * - in-sync：不动作
   * - conflict：按 conflictStrategy 处理，manual 时仅返回对比结果不动数据
   */
  async syncFile(local: LocalFileSnapshot | null, remotePath: string, options: SyncRunOptions = {}): Promise<SyncRunResult> {
    const comparison = await this.compareWithRemote(local, remotePath, options);
    let direction = comparison.direction;

    const strategy = options.conflictStrategy ?? 'manual';
    if (direction === 'conflict') {
      if (strategy === 'prefer-local') direction = 'upload-local';
      else if (strategy === 'prefer-remote') direction = 'download-remote';
    }

    if (direction === 'upload-local' && !options.dryRun) {
      await this.uploadBinary(remotePath, toBytes(local!.content));
      return { comparison, action: 'uploaded' };
    }
    if (direction === 'download-remote') {
      const bytes = await this.downloadBinary(remotePath);
      const content = bytes === null
        ? undefined
        : typeof local?.content === 'string' ? new TextDecoder().decode(bytes) : bytes;
      return { comparison, action: options.dryRun ? 'skipped' : 'downloaded', content };
    }

    return {
      comparison,
      action: comparison.direction === 'conflict' && strategy === 'manual' ? 'conflict' : 'skipped',
    };
  }
}

// ==================== 本地配置存取（登录态） ====================

/** WebDAV 登录配置在 localStorage 中的存储键 */
export const WEBDAV_CONFIG_KEY = 'kisama_webdav_config';

/** 从 localStorage 读取已保存的 WebDAV 配置；未登录或数据损坏返回 null */
export function loadWebDavConfig(): WebDavOptions | null {
  try {
    const raw = localStorage.getItem(WEBDAV_CONFIG_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.serverUrl !== 'string' || !parsed.serverUrl.trim()) return null;
    return parsed as WebDavOptions;
  } catch {
    return null;
  }
}

/** 保存 WebDAV 配置到 localStorage（即"登录"） */
export function saveWebDavConfig(config: WebDavOptions): void {
  localStorage.setItem(WEBDAV_CONFIG_KEY, JSON.stringify(config));
}

/** 清除已保存的 WebDAV 配置（即"退出登录"） */
export function clearWebDavConfig(): void {
  localStorage.removeItem(WEBDAV_CONFIG_KEY);
}

/** 用已保存（或显式传入）的配置构建客户端；未登录返回 null */
export function createWebDavClient(config?: WebDavOptions | null): WebDavClient | null {
  const cfg = config ?? loadWebDavConfig();
  return cfg ? new WebDavClient(cfg) : null;
}
