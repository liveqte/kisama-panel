// src/lib/agent-client.ts
/**
 * Agent Client SDK (Crypto + Auth Enabled)
 * 支持：AES-256-GCM 请求加密、ECIES 响应解密、ECDSA 请求签名认证
 */
import { decrypt } from 'eciesjs';
import { Buffer } from 'buffer';
import { p256 } from '@noble/curves/nist.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { hmac } from '@noble/hashes/hmac.js';
import { gcm } from '@noble/ciphers/aes';
import type { AgentProtoScheme } from './proto-detect';
import { getProtoScheme, saveProtoScheme, clearProtoScheme } from './proto-detect';

// ==================== 类型定义 ====================

// ==================== 临时密钥模块（临时授权） ====================

export interface TempEcdsaKey {
  private_key: string;
  public_key: string;
}
export interface TempEciesKey {
  private_key: string;
  public_key: string;
}
export interface TempKeyResponse {
  status: string;
  key_id: string;
  ttl_seconds: number;
  created_at: string;
  expires_at: string;
  ecdsa: TempEcdsaKey;
  ecies: TempEciesKey;
}

export interface BaseInfo {
  arch: string;
  cpu_cores: number;
  cpu_name: string;
  disk_total: number;
  gpu_name: string;
  ipv4: string | null;
  ipv6: string | null;
  mem_total: number;
  os: string;
  kernel_version: string;
  swap_total: number;
  version: string;
  virtualization: string;
  session_key: string; 
  noise_key?: {
    controller: { private: string; };
    agent: { public: string; };
  };
}

export interface SystemStatus {
  cpu: { usage: number };
  ram: { total: number; used: number };
  swap: { total: number; used: number };
  load: { load1: number; load5: number; load15: number };
  disk: { total: number; used: number };
  network: { up: number; down: number; totalUp: number; totalDown: number };
  connections: { tcp: number; udp: number };
  uptime: number;
  process: number;
  message: string;
}

// ... 保持其余原装接口契约完全不变 (ExecRequest, ExecResponse 等等均不变) ...
export interface ExecRequest { cmd: string; cwd?: string; env?: Record<string, string>; }
export interface ExecResponse { result: string; exitcode: number; timeout: boolean; cmd: string; }
export interface FileListResponse { status: string; count: number; files: any[]; }
export interface FileAuthQueryResponse { status: string; files: any[]; }
export interface FileAuthSetResponse { status: string; total: number; success: number; results: any[]; }
export interface FileCatResponse { status: string; path: string; content: string; encoding: string; is_binary: boolean; size: number; }
export interface FileUploadRequest { path: string; filename: string; content: string; chunk_id?: number; total_chunks?: number; }
export interface FileUploadResponse { status: string; path: string; message?: string; }
export interface FileDownloadResponse { headers: Record<string, string>; body: string; }
export interface FileDeleteResponse { status: string; results: any[]; }
export interface FileMoveResponse { status: string; total: number; success: number; results: any[]; }
export interface FileNewDirResponse { status: string; path: string; }
export interface TaskListResponse { status: string; count: number; tasks: string[]; }
export interface TaskSetResponse { status: string; count: number; tasks: string[]; executed: any[]; }
export type CronTask = Record<string, string>;
export interface CronListResponse { status: string; count: number; tasks: CronTask; }
export interface CronSetResponse { status: string; count: number; tasks: CronTask; }
export interface TaskStatus { onetime: { pending: boolean; count: number }; cron: { active: boolean; count: number; check_interval: number }; }
export interface TaskLog { ts: string; cmd: string; output: string; exitcode: number; type: "onetime" | "cron"; formatted: string; cron?: string; }
export interface TaskLogResponse { status: string; count: number; logs: TaskLog[]; }
export interface TaskLogClearResponse { status: string; cleared: string; }
export interface TaskLogSummary { onetime: { total_logged: number; max_capacity: number; recent_success: number; recent_failed: number }; cron: { total_logged: number; max_capacity: number; recent_success: number; recent_failed: number }; }
export interface TaskTriggerResponse { status: string; executed: number; results: any[]; }
export interface FileUploadRawRequest {
  path: string;               // 服务器保存目录路径，例如 "/tmp/uploads"
  filename: string;           // 真实文件名，例如 "data.tar.gz"
  content: Uint8Array | Blob; // 100% 纯净的原始文件或分片二进制字节流
  chunk_id?: number;          // 当前分片索引 (从 0 开始)
  total_chunks?: number;      // 总分片数
}

export interface FileUploadRawResponse {
  status: string;
  path?: string;
  chunk_id?: number;
  completed: boolean;         // 指示文件是否在后端全部接收并合并完成
  message: string;
}

// ==================== Argo 临时隧道模块（内网映射） ====================

export interface ArgoTunnel {
  tunnel_domain: string;      // 临时隧道公网域名（含 https:// 前缀）
  port: number;               // 隧道转发的本地端口
  created_at: string;         // 创建时间（ISO8601 UTC）
}
export interface ArgoTunnelListResponse {
  status: string;
  count: number;
  tunnels: ArgoTunnel[];
}
export interface ArgoCreateRequest {
  port?: number;              // 缺省时使用 agent 自身监听端口
  duplicate?: boolean;        // true 时允许同一端口重复创建
}
export interface ArgoCreateResponse {
  status: string;
  created: boolean;
  tunnel_domain?: string;
  port: number;
  created_at?: string;
  message?: string;
}
export interface ArgoDeleteRequest {
  port: number;               // 必填：要删除的隧道转发端口
  tunnel_domain?: string;     // 同一端口多条隧道时用于精确定位
}
export interface ArgoDeleteResponse {
  status: string;
  deleted: number;
  port: number;
  tunnels?: ArgoTunnel[];
  message?: string;
}

export class AgentAPIError extends Error {
  public readonly statusCode: number;
  public readonly data: unknown;
  constructor(message: string, statusCode: number, data?: unknown) {
    super(message);
    this.name = "AgentAPIError";
    this.statusCode = statusCode;
    this.data = data;
  }
}

// ==================== 核心助手函数保持不变 (getBytes, b64ToBytes, bytesToB64, generateAuthHeaders, aesGcmEncrypt, eciesDecryptResponse) ====================
const b64ToBytes = (b64: string): Uint8Array => {
  const cleaned = b64.replace(/\s/g, '');
  if (!/^[A-Za-z0-9+/=]+$/.test(cleaned)) {
    throw new Error(`私钥包含非法字符。前20字符: ${cleaned.slice(0, 20)}`);
  }
  return new Uint8Array(atob(cleaned).split('').map(c => c.charCodeAt(0)));
};
function bytesToB64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return window.btoa(binary);
}
const generateNonce = (): string => bytesToB64(crypto.getRandomValues(new Uint8Array(16)));
const getTimestamp = (): string => String(Math.floor(Date.now() / 1000));

/** sha256 小写 hex（v2 签名的 body 摘要段） */
const sha256Hex = (bytes: Uint8Array): string =>
  Array.from(sha256(bytes)).map((b) => b.toString(16).padStart(2, '0')).join('');

/** 空请求体的 SHA256（GET/DELETE 等无体请求，以及 /api/fileraw 裸流上传固定使用） */
export const EMPTY_BODY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

/**
 * 提取签名用的请求路径：不含 query string（含 /kisamaproxy 中转时也按原始 agent 路径签名，
 * 中转站按原始路径转发，agent 收到的即此 path）。
 * PHP 入口脚本转发形态（如 http://xx.xx/agent_froxlor.php/api/baseinfo）：
 * 入口脚本名不参与 agent 端路由，agent 实际收到的是去掉脚本名后的路径，
 * 因此签名前必须剔除该段，否则与 agent 端拼出的验签消息不一致。
 * 入口脚本按 "首段 *.php" 通用匹配（agent_froxlor.php / agent_froxlor_ai_v2.php /
 * agent_ai_v2.php 等任意入口名），不再硬编码单一文件名。
 * 兜底：与 agent 端路径规范化一致 —— 剥离后仍不以 /api/ 开头时，取最后一个 "/api/"
 * 锚点之后的路径（agent 全部路由为 /api/* 精确匹配，验签路径即此）。
 */
function getSignPath(url: string): string {
  const stripPhpEntry = (p: string): string =>
    p.replace(/^\/[^/?#]+\.php(?=\/|$)/i, '') || '/';
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    path = url.split('?')[0];
  }
  path = stripPhpEntry(path);
  if (!/^\/api(\/|$)/.test(path)) {
    const anchor = path.lastIndexOf('/api/');
    if (anchor >= 0) path = path.slice(anchor);
  }
  return path || '/';
}

/**
 * 从签名私钥 PEM/DER 中提取 P-256 原始私钥字节（兼容 PKCS#8 PEM、裸 Base64、Hex 等历史格式）
 */
function extractP256PrivBytes(ecdsaSkPem: string): Uint8Array {
  const pemHeader = "-----BEGIN PRIVATE KEY-----";
  const pemFooter = "-----END PRIVATE KEY-----";
  const pemContent = ecdsaSkPem.includes(pemHeader) ? ecdsaSkPem : `${pemHeader}\n${ecdsaSkPem}\n${pemFooter}`;
  const derBase64 = pemContent.replace(pemHeader, "").replace(pemFooter, "").replace(/\s/g, "");
  if (!derBase64) throw new Error("ECDSA 私钥为空");
  const derBytes = new Uint8Array(atob(derBase64).split("").map((c) => c.charCodeAt(0)));
  for (let i = 0; i < derBytes.length - 34; i++) {
    if (derBytes[i] === 0x04 && derBytes[i + 1] === 0x20 && i > 20 && derBytes[i - 2] === 0x04) {
      const privKeyBytes = derBytes.subarray(i + 2, i + 34);
      if (privKeyBytes.length === 32) return privKeyBytes;
    }
  }
  // 兜底：非标准 DER 包装，放宽前缀校验
  for (let i = 0; i < derBytes.length - 34; i++) {
    if (derBytes[i] === 0x04 && derBytes[i + 1] === 0x20) {
      return derBytes.subarray(i + 2, i + 34);
    }
  }
  throw new Error("无法从私钥中提取 P-256 原始私钥字节");
}

/**
 * 组装认证签名头。
 *
 * - v2（agent ≥ 0.4.8，默认）：五段消息
 *     message = METHOD + "\n" + PATH(不含 query) + "\n" + SHA256_HEX(bodyBytes) + "\n" + nonce + "\n" + timestamp
 *   bodyBytes 必须是**实际发送的网络字节**：AES 加密请求签加密后的密文（先加密、后签名），
 *   无体请求传空（签名固定为 sha256("")），/api/fileraw 裸流按约定签空 body。
 * - v1-legacy（agent ≤ 0.4.7）：旧两段消息 message = nonce + timestamp，bodyBytes 不参与签名。
 *
 * ⚠️ LEGACY_AGENT_SUPPORT：v1-legacy 分支为旧版 agent 兼容保留，面板 0.6.0 移除。
 */
async function generateAuthHeaders(
  ecdsaSkPem: string,
  method: string,
  path: string,
  bodyBytes: Uint8Array,
  scheme: AgentProtoScheme = 'v2'
): Promise<Record<string, string>> {
  try {
    const nonce = generateNonce();
    const timestamp = getTimestamp();
    let message: string;
    if (scheme === 'v1-legacy') {
      message = `${nonce}${timestamp}`;
    } else {
      const hasBody = bodyBytes && bodyBytes.length > 0;
      const bodyHash = hasBody ? sha256Hex(bodyBytes) : EMPTY_BODY_SHA256;
      message = [method.toUpperCase(), path, bodyHash, nonce, timestamp].join('\n');
    }
    const privKeyBytes = extractP256PrivBytes(ecdsaSkPem);
    const msgHash = sha256(new TextEncoder().encode(message));
    const sigObject = p256.sign(msgHash, privKeyBytes);
    const signatureBytes = sigObject.toBytes('der');
    return {
      "x-nonce": nonce,
      "x-timestamp": timestamp,
      "x-auth-token": bytesToB64(signatureBytes),
      Accept: "application/json",
      "User-agent": "ProxyControl/1.0",
    };
  } catch (err: any) {
    throw new Error(`ECDSA 签名生成失败: ${err.message}`);
  }
}

/**
 * 计算超级终端 WS 明文降级模式的认证 token（agent ≥ 0.4.8）。
 * 公式：Base64( HMAC-SHA256( key = Base64Decode(session_key), message = "kisama-ws-token-v1" ) )
 * 注意：必须先把 session_key Base64 解码成 32 字节原始值再作 HMAC key，直接拿字符串当 key 会与服务端不一致。
 */
export function computeWsDowngradeToken(sessionKeyB64: string): string {
  const raw = b64ToBytes(sessionKeyB64);
  // @noble/hashes v2 的 hmac 签名是 (hash, key, message)：key 是 session_key 解码后的 32 字节
  const mac = hmac(sha256, raw, new TextEncoder().encode('kisama-ws-token-v1'));
  return bytesToB64(mac);
}

async function aesGcmEncrypt(plaintext: string, keyBytes: Uint8Array): Promise<string> {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const cipher = gcm(keyBytes, nonce);
  const ciphertextWithTag = cipher.encrypt(new TextEncoder().encode(plaintext));
  const tag = ciphertextWithTag.slice(-16);
  const data = ciphertextWithTag.slice(0, -16);
  return btoa(JSON.stringify({ nonce: bytesToB64(nonce), tag: bytesToB64(tag), ciphertext: bytesToB64(data) }));
}

export async function eciesDecryptResponse(base64Payload: string, privateKeyHex: string, debug = false) {
  try {
    let rawB64 = base64Payload.trim().replace(/[\s\n\r]/g, '');
    if (rawB64.startsWith('{')) {
      const obj = JSON.parse(rawB64);
      rawB64 = (obj._encrypted || obj.encrypted || obj.data || rawB64).replace(/[\s\n\r]/g, '');
    }
    const decryptedBuffer = decrypt(privateKeyHex, Buffer.from(rawB64, 'base64'));
    let result = (decryptedBuffer as any).toString('utf8');
    if (/^[\d,]+$/.test(result)) {
      result = Buffer.from(result.split(',').map(Number)).toString('utf8');
    }
    return result;
  } catch (err: any) {
    const hint = `ECIES 解密失败 (${err?.message || err})：解密私钥与代理端加密所用公钥不匹配。请检查是否使用与签名来源配套的 ECIES 私钥 —— 静态签名 → 静态 ECIES 私钥；临时签名（getTempKey）→ 同一份响应中的临时 ECIES 私钥，且密钥未过期。`;
    throw new Error(hint);
  }
}

// ==================== 核心类 ====================

export interface AgentClientOptions {
  domain: string;
  eciesPrivateKey?: string;
  ecdsaPrivateKey?: string;
  headers?: Record<string, string>;
  timeout?: number;
  fetch?: typeof globalThis.fetch;
  Encryption?: boolean;
  /**
   * 强制使用旧版 agent 签名协议（≤ 0.4.7）。
   * ⚠️ LEGACY_AGENT_SUPPORT：面板 0.6.0 移除
   */
  forceLegacy?: boolean;
  /** 协议探测落定回调（401 降级探测成功后触发一次），调用方可持久化结果 */
  onProtocolResolved?: (scheme: AgentProtoScheme) => void;
}

export class AgentClient {
  private readonly baseURL: string;
  /** PHP 反代节点标记：域名形如 https://front.host/#target.host/k.php（带 #），已完成一次反代，不再接受第二层中转 */
  private readonly isPhpProxyNode: boolean;
  private ecdsaSkPem?: string;
  private eciesSkPem?: string;
  private readonly defaultHeaders: Record<string, string>;
  private readonly timeout: number;
  readonly Encryption: boolean;
  private sessionKey?: Uint8Array;
  /**
   * 当前签名协议版本：'v2' = 0.4.8 五段签名（默认）；'v1-legacy' = ≤0.4.7 两段签名。
   * ⚠️ LEGACY_AGENT_SUPPORT：v1-legacy 探测/回退逻辑整体于面板 0.6.0 移除。
   */
  private protoScheme: AgentProtoScheme;
  /** 协议是否已探测落定（落定后不再做 401 新旧互换探测） */
  private protoSchemeConfirmed: boolean = false;
  /** 密钥轮换恢复：本轮是否已重拉过 baseinfo（成功请求后复位），防循环 */
  private keyRefreshedInFlight: boolean = false;
  private readonly onProtocolResolved?: (scheme: AgentProtoScheme) => void;
  /**
   * 节点明文模式：当节点回应包携带 x-encrypted: false 时置位，
   * 表示该节点已关闭加密（同时也关闭了认证），
   * 后续与该节点的全部通信走明文，不再包装 ECDSA 签名头与 AES 加密体。
   */
  private plaintextMode: boolean = false;

  /** 查询当前节点是否处于明文模式（x-encrypted: false） */
  get isPlaintextMode(): boolean {
    return this.plaintextMode;
  }

  /** 当前生效的签名协议版本（探测过程中可能变化） */
  get protocolScheme(): AgentProtoScheme {
    return this.protoScheme;
  }

  constructor(options: AgentClientOptions) {
    // 支持 "xx.cc#aa.bb" 或 "https://xx.cc#aa.bb/prefix/path" 形式：
    // 请求发往 xx.cc（# 后的路径部分拼入 baseURL），主机部分注入 x-target-host 头
    const [cleanDomain, frag] = options.domain.split("#", 2);
    const rawDomain = cleanDomain.replace(/\/+$/, "").trim();
    let base = /^https?:\/\//i.test(rawDomain) ? rawDomain : `http://${rawDomain}`;
    let tHost = "";
    if (frag?.trim()) {
      const f = frag.trim().replace(/^\/+|\/+$/g, "");
      const slash = f.indexOf("/");
      tHost = slash === -1 ? f : f.slice(0, slash);
      const tPath = slash === -1 ? "" : f.slice(slash);
      if (tPath) base += tPath;
    }
    this.baseURL = base;
    this.isPhpProxyNode = options.domain.includes("#");
    this.eciesSkPem = options.eciesPrivateKey;
    this.ecdsaSkPem = options.ecdsaPrivateKey;
    this.timeout = options.timeout ?? 10_000;
    this.defaultHeaders = { "Content-Type": "application/json", ...options.headers };
    if (tHost) this.defaultHeaders["x-target-host"] = tHost;
    this.Encryption = options.Encryption ?? true;
    // ⚠️ LEGACY_AGENT_SUPPORT：优先取 forceLegacy，其次取按节点持久化的探测结果，缺省 v2
    this.protoScheme = options.forceLegacy
      ? 'v1-legacy'
      : (getProtoScheme(options.domain) ?? 'v2');
    if (options.forceLegacy) this.protoSchemeConfirmed = true;
    this.onProtocolResolved = options.onProtocolResolved;
  }

  /**
   * 归一化域名为纯主机名（去协议、去路径、去查询、转小写），用于中转站与被访问节点自身的域名比对
   */
  private static normalizeProxyHost(domain: string): string {
    return String(domain || '')
      .replace(/^https?:\/\//i, '')
      .split('/')[0]
      .split('?')[0]
      .toLowerCase();
  }

  /**
   * 智能中传调度：选出中转站点（返回站点前缀，如 https://relay.example.com；不可用则返回 null 直连）
   * 🔥 核心反自吃策略：自己不能中转自己 —— 候选池中与被访问节点自身域名相同的中转站直接剔除；
   *    即使配置了「中转全部站点（含 HTTPS）」且候选池只剩自己，也绝不选中，找不到别的中转站就降级直连
   */
  private pickProxyTunnel(url: string): string | null {
    try {
      if (typeof window === 'undefined') return null;
      // 🔥 PHP 反代节点（域名带 #，请求已通过 x-target-host 完成一次反代）不再接受第二次中转，强制直连
      if (this.isPhpProxyNode) return null;
      const proxyRaw = localStorage.getItem('kisama_proxy_config');
      if (!proxyRaw) return null;
      const parsed = JSON.parse(proxyRaw);
      // 优先提取健康的绿灯站点池，如果全灭则降级回总池
      const targetPool = Array.isArray(parsed.healthyDomains) ? parsed.healthyDomains : parsed.domains;

      if (!parsed.enabled || !Array.isArray(targetPool) || targetPool.length === 0) return null;

      const isTargetHttps = url.toLowerCase().startsWith('https://');
      const shouldTunnel = parsed.allSites || !isTargetHttps;
      if (!shouldTunnel) return null;

      // 🔥 剔除与被访问节点自身域名相同的中转站（自己不能中转自己）
      const nodeHost = AgentClient.normalizeProxyHost(this.baseURL);
      const usablePool = targetPool.filter(
        (d: string) => AgentClient.normalizeProxyHost(d) !== nodeHost
      );
      // 找不到其它中转站 → 直连回退
      if (usablePool.length === 0) return null;

      // 从可用的站点池中随机盲调，彻底杜绝抽中离线死节点或“自中转”
      return usablePool[Math.floor(Math.random() * usablePool.length)];
    } catch (e) {
      console.error('[Proxy Tunnel] Error:', e);
      return null;
    }
  }

  // src/lib/agent-client.ts (只修改静态 uploadStatusPage 方法)

  static async uploadStatusPage(
    phpUrl: string, 
    token: string, 
    nodesSummary: { id: string; name: string; domain: string }[]
  ): Promise<any> {
    const targetUrl = new URL(phpUrl);
    targetUrl.searchParams.set('token', token);

    const response = await fetch(targetUrl.toString(), {
      method: 'POST',
      // 💡 ✨【核心破局点】：将 json 换成 text/plain 纯文本简单请求
      // 这样可以彻底消灭浏览器的 OPTIONS 预检，无视并绕过 ByetHost 空间的网关拦截网
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body: JSON.stringify(nodesSummary)
    });

    if (!response.ok) {
      throw new Error(`上报失败 (HTTP ${response.status}): ${response.statusText}`);
    }
    
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      return { status: 'success', raw: text };
    }
  }

  /** 协议探测落定：记忆并通知调用方持久化 */
  private confirmScheme(scheme: AgentProtoScheme): void {
    this.protoScheme = scheme;
    this.protoSchemeConfirmed = true;
    try { saveProtoScheme(this.baseURL, scheme); } catch { /* 忽略 */ }
    this.onProtocolResolved?.(scheme);
  }

  /** 按指定签名协议执行一次请求（组装字节顺序：先 AES 加密、后签名实际发送的字节） */
  private async doFetch(
    url: string,
    options: RequestInit & { responseType?: 'text' | 'blob' },
    scheme: AgentProtoScheme
  ): Promise<{ res: Response; data: any }> {
    const headers: Record<string, string> = { ...this.defaultHeaders, ...(options.headers as Record<string, string>) };
    let body = options.body;
    // 1. 先加密：AES 体加密必须在签名之前完成，签名针对实际发送的密文字节
    if (body && this.sessionKey && this.Encryption && !this.plaintextMode) {
      body = await aesGcmEncrypt(body as string, this.sessionKey);
      headers["x-aes-encrypted"] = "true";
    }
    // 2. 后签名：签实际发送的字节（密文字符串 / 明文 JSON 体 / 无体 = sha256("")）
    if (!this.plaintextMode && this.ecdsaSkPem) {
      const bodyBytes = typeof body === 'string' ? new TextEncoder().encode(body) : new Uint8Array(0);
      Object.assign(headers, await generateAuthHeaders(
        this.ecdsaSkPem, (options.method ?? 'GET').toUpperCase(), getSignPath(url), bodyBytes, scheme
      ));
    }

    let finalUrl = url;
    const proxyBase = this.pickProxyTunnel(url);
    if (proxyBase) {
      finalUrl = `${proxyBase}/kisamaproxy/${url}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const res = await fetch(finalUrl, { ...options, headers, body, signal: controller.signal });
      if (options.responseType === 'blob') return { res, data: await res.blob() };

      let rawText = await res.text();

      // 0. 节点加密开关嗅探：x-encrypted: false 表示节点关闭了加密（连带认证），永久切换为明文直连模式
      // ⚠️ LEGACY_AGENT_SUPPORT（0.6.0 移除该条件）：旧版 agent（≤0.4.7）在 baseinfo 白名单上验签失败
      // 会匿名放行，同样返回 200 + x-encrypted: false —— 协议未落定前该信号不可信，
      // 交由 safeFetch 的静默验签失败探测处理，此处不得抢先置位明文模式。
      const rawEncryptedHeader = res.headers.get("x-encrypted") || res.headers.get("X-Encrypted");
      if (rawEncryptedHeader === "false" && this.protoSchemeConfirmed) {
        this.plaintextMode = true;
        console.info(`[AgentClient] 节点 ${this.baseURL} 已关闭加密 (x-encrypted: false)，后续通信切换为明文模式（不再签名/加密）`);
      }

      // 1. 标准判定：从 Header 读取
      const isEncryptedHeader = rawEncryptedHeader === "true";

      // 2. 防御自愈特征嗅探：如果明文不是以 { 开头，且长度很长，符合标准的 Base64 格式，判定为被 CORS 隐藏的密文
      const looksLikeBase64Cipher = !this.plaintextMode && /^[A-Za-z0-9+/=]{100,}$/.test(rawText.trim()) && !rawText.trim().startsWith('{');

      // 只要满足任意一条，且配置了解密私钥，就强行启动 ECIES 解密内核（明文模式下彻底跳过）
      if (!this.plaintextMode && (isEncryptedHeader || looksLikeBase64Cipher) && this.eciesSkPem) {
        try {
          rawText = await eciesDecryptResponse(rawText, this.eciesSkPem);
        } catch (decryptErr) {
          // 仅当 Header 明确声明加密却解密失败时才抛出异常；如果是盲测误判，则保持原样输出
          if (isEncryptedHeader) throw decryptErr;
        }
      }

      return { res, data: rawText };
    } catch (err: any) {
      if (err.name === 'AbortError') throw new Error(`请求超时 (${this.timeout}ms): ${url}`);
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async safeFetch(
    url: string,
    options: RequestInit & { responseType?: 'text' | 'blob' } = {}
  ): Promise<{ res: Response; data: any }> {
    // baseinfo 自身请求不触发密钥轮换恢复（避免嵌套刷新循环），但保留签名协议探测
    const isBaseInfoCall = (() => { try { return new URL(url).pathname.endsWith('/api/baseinfo'); } catch { return false; } })();
    const canProbe = !this.plaintextMode && !!this.ecdsaSkPem;

    let { res, data } = await this.doFetch(url, options, this.protoScheme);
    if (res.ok) this.keyRefreshedInFlight = false;

    const tryParseJson = (t: any): any => {
      try { return typeof t === 'string' ? JSON.parse(t) : null; } catch { return null; }
    };

    // ── 签名协议探测（⚠️ LEGACY_AGENT_SUPPORT，0.6.0 移除）──
    if (res.status === 401 && canProbe && !this.protoSchemeConfirmed) {
      // 首次请求 401 且协议未落定时，新旧两套签名各试一次，成功的一套记忆持久化。
      const flipped: AgentProtoScheme = this.protoScheme === 'v2' ? 'v1-legacy' : 'v2';
      const retry = await this.doFetch(url, options, flipped);
      if (retry.res.ok) {
        this.confirmScheme(flipped);
        console.info(`[AgentClient] 节点 ${this.baseURL} 协议探测落定: ${flipped === 'v1-legacy' ? '旧版两段签名 (≤0.4.7，0.6.0 起面板不再支持)' : 'v2 五段签名 (≥0.4.8)'}`);
        return retry;
      }
      // 两套签名都被拒：以最后一次响应为准（多为密钥不匹配的真实错误）
      res = retry.res; data = retry.data;
    } else if (res.ok && canProbe && !this.protoSchemeConfirmed) {
      // ── 旧版 agent baseinfo 白名单"静默验签失败"探测 ──
      // ≤0.4.7 agent 的 /api/baseinfo 是验签失败匿名放行白名单：签名无效时也返回 HTTP 200，
      // 但响应是明文且剔除了 session_key 等动态密钥（非 401！401 探测分支捕获不到）。
      // 特征：请求带签名 + 200 + baseinfo 形状 + 缺 session_key → 视同验签失败，flip 协议重试。
      const parsed = tryParseJson(data);
      const isBaseInfoShape = !!parsed && typeof parsed === 'object' && ('arch' in parsed || 'os' in parsed);
      if (isBaseInfoCall && isBaseInfoShape && !parsed.session_key) {
        const flipped: AgentProtoScheme = this.protoScheme === 'v2' ? 'v1-legacy' : 'v2';
        const retry = await this.doFetch(url, options, flipped);
        const retryParsed = tryParseJson(retry.data);
        if (retry.res.ok && !!retryParsed && typeof retryParsed === 'object' && !!retryParsed.session_key) {
          this.confirmScheme(flipped);
          console.info(`[AgentClient] 节点 ${this.baseURL} 检测到旧版 agent 白名单静默验签失败，协议探测落定: ${flipped === 'v1-legacy' ? '旧版两段签名 (≤0.4.7，0.6.0 起面板不再支持)' : 'v2 五段签名 (≥0.4.8)'}`);
          return retry;
        }
        // 两套签名都拿不到 session_key → 该节点认证已关闭（真明文节点），置位明文模式
        this.plaintextMode = true;
        console.info(`[AgentClient] 节点 ${this.baseURL} 两套协议均未通过认证（baseinfo 无 session_key），判定为明文模式节点，后续通信不再签名/加密`);
        // 保持原响应返回（匿名 baseinfo 数据仍可供 UI 展示基础信息）
      } else if (!isBaseInfoCall || (isBaseInfoShape && !!parsed.session_key)) {
        // 落定当前协议：
        // - 非白名单请求首发即成功 → 当前协议必然正确；
        // - baseinfo 拿到含 session_key 的完整响应 → 验签确定通过（白名单匿名响应无 session_key）。
        // （baseinfo/status 是旧版 agent 的验签失败匿名放行白名单，无密钥的 200 不能证明验签通过）
        this.confirmScheme(this.protoScheme);
      }
    }

    // ── 密钥轮换恢复（agent 0.4.8：tempkey 过期会轮换 session_key）──
    // 协议已落定仍遇 401 且此前启用过 AES 体加密时，作废缓存 session_key、
    // 重拉 baseinfo 取新密钥后重试一次（每轮仅一次，防循环）。
    if (
      res.status === 401 && canProbe && !isBaseInfoCall &&
      !this.keyRefreshedInFlight && this.protoSchemeConfirmed && this.sessionKey
    ) {
      this.keyRefreshedInFlight = true;
      this.sessionKey = undefined;
      try { await this.getBaseInfo(); } catch { /* 刷新失败则按原错误返回 */ }
      const retry = await this.doFetch(url, options, this.protoScheme);
      if (retry.res.ok) this.keyRefreshedInFlight = false;
      return retry;
    }

    return { res, data };
  }

  // 💡 【彻底修复 vue-tsc 编译隐患】：移除了可选问号，转为标准的确定性公共方法
  destroy(): void {          
    this.sessionKey = undefined;
  }

  // private async request<T>(method: string, path: string, body?: unknown, queryParams?: Record<string, string | number | boolean>): Promise<T> {
  //   const url = new URL(`${this.baseURL}${path}`);
  //   if (queryParams) Object.entries(queryParams).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  //   const { data } = await this.safeFetch(url.toString(), { method, body: body ? JSON.stringify(body) : undefined });
  //   try { return JSON.parse(data) as T; } catch { return data as unknown as T; }
  // }
  // src/lib/agent-client.ts 内部对应的 request 方法
  private async request<T>(method: string, path: string, body?: unknown, queryParams?: Record<string, string | number | boolean>): Promise<T> {
    const url = new URL(`${this.baseURL}${path}`);
    if (queryParams) Object.entries(queryParams).forEach(([k, v]) => url.searchParams.set(k, String(v)));
    const { data } = await this.safeFetch(url.toString(), { method, body: body ? JSON.stringify(body) : undefined });
    
    try { 
      return JSON.parse(data) as T; 
    } catch (parseErr: any) { 
      // 💡 ✨【核心新增：解密成果动态嗅探器】：如果能走到这里，说明 safeFetch 没有报错，密文已经成功解开了！
      console.group('%c🔍 [ECIES 响应体解密成果嗅探]', 'color: #ec4899; font-weight: bold; font-size: 12px;');
      console.log('%c1. 解密出来的文本原文 (Raw Text):', 'color: #2563eb; font-weight: bold;', data);
      console.log('%c2. 文本长度 (Length):', 'color: #7c3aed;', data?.length);
      console.error('❌ 3. JSON 格式化崩溃原因:', parseErr?.message);
      console.groupEnd();

      return data as unknown as T; 
    }
  }
  async getBaseInfo(): Promise<BaseInfo> {
    const res = await this.request<BaseInfo>("GET", "/api/baseinfo");
    if (res.session_key) this.sessionKey = b64ToBytes(res.session_key);
    return res;
  }
  async getStatus(): Promise<SystemStatus> { return this.request<SystemStatus>("GET", "/api/status"); }
  async exec(cmd: string | ExecRequest): Promise<ExecResponse> { return this.request<ExecResponse>("POST", "/api/exec", typeof cmd === "string" ? { cmd } : cmd); }
  async listFiles(path: string, recursive = false): Promise<FileListResponse> { return this.request<FileListResponse>("POST", "/api/file/list", { path, recursive }); }
  async queryFileAuthority(paths: string[]): Promise<FileAuthQueryResponse> { return this.request<FileAuthQueryResponse>("POST", "/api/file/authority", { paths }); }
  async setFileAuthority(permissions: Record<string, string>, recursive = false): Promise<FileAuthSetResponse> { return this.request<FileAuthSetResponse>("PUT", "/api/file/authority", { permissions, recursive }); }
  async catFile(path: string): Promise<FileCatResponse> { return this.request<FileCatResponse>("POST", "/api/file/cat", { path }); }
  async uploadFile(data: FileUploadRequest): Promise<FileUploadResponse> { return this.request<FileUploadResponse>("POST", "/api/file", data); }
  /**
   * 🚀 新增：裸二进制流分块上传接口 (完美兼容 /api/fileraw)
   * 元数据全部提取至 Header，Body 100% 直传原始二进制，零体积膨胀，支持中转加速隧道机制
   */
  async uploadFileRaw(data: FileUploadRawRequest): Promise<FileUploadRawResponse> {
    const url = `${this.baseURL}/api/fileraw`;
    
    // 1. 严格组装接口规范所要求的自定义元数据请求头
    const headers: Record<string, string> = {
      "Content-Type": "application/octet-stream",
      "X-File-Path": encodeURIComponent(data.path),
      "X-File-Name": encodeURIComponent(data.filename),
      "X-Chunk-Id": String(data.chunk_id ?? 0),
      "X-Total-Chunks": String(data.total_chunks ?? 1),
    };
    if (this.defaultHeaders["x-target-host"]) {
      headers["x-target-host"] = this.defaultHeaders["x-target-host"];
    }

    // 2. 自动注入 ECDSA 签名认证头：/api/fileraw 裸流按两端约定固定签空 body（sha256("")），
    //    节点明文模式下跳过。⚠️ LEGACY_AGENT_SUPPORT：v1-legacy 探测/回退逻辑 0.6.0 移除
    const canSign = !this.plaintextMode && !!this.ecdsaSkPem;
    const signHeaders = async (scheme: AgentProtoScheme): Promise<Record<string, string>> => {
      if (!this.ecdsaSkPem) return {};
      return generateAuthHeaders(this.ecdsaSkPem, "POST", "/api/fileraw", new Uint8Array(0), scheme);
    };
    if (canSign) {
      Object.assign(headers, await signHeaders(this.protoScheme));
    }

    // 3. 完美兼容原有的智能中转加速隧道 (Proxy Tunnel) 调度机制
    let finalUrl = url;
    const proxyBase = this.pickProxyTunnel(url);
    if (proxyBase) {
      finalUrl = `${proxyBase}/kisamaproxy/${url}`;
    }

    // 4. 超时与控制器管理
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      // 5. 发起原生 Fetch 请求，Body 直接倾倒原始二进制流
      let res = await fetch(finalUrl, {
        method: "POST",
        headers,
        body: data.content as any,
        signal: controller.signal
      });
      // ⚠️ LEGACY_AGENT_SUPPORT：协议未落定时 401 触发新旧签名互换探测（0.6.0 移除）
      if (res.status === 401 && canSign && !this.protoSchemeConfirmed) {
        const flipped: AgentProtoScheme = this.protoScheme === 'v2' ? 'v1-legacy' : 'v2';
        const retryHeaders: Record<string, string> = {
          "Content-Type": "application/octet-stream",
          "X-File-Path": encodeURIComponent(data.path),
          "X-File-Name": encodeURIComponent(data.filename),
          "X-Chunk-Id": String(data.chunk_id ?? 0),
          "X-Total-Chunks": String(data.total_chunks ?? 1),
          ...(this.defaultHeaders["x-target-host"] ? { "x-target-host": this.defaultHeaders["x-target-host"] } : {}),
          ...(await signHeaders(flipped)),
        };
        res = await fetch(finalUrl, {
          method: "POST",
          headers: retryHeaders,
          body: data.content as any,
          signal: controller.signal
        });
        if (res.ok) {
          this.confirmScheme(flipped);
        }
      }
      if (res.status !== 200) {
        throw new Error(`分块传输被网关拦截 (HTTP ${res.status}): ${res.statusText || '服务暂不可用或文件过大'}`);
      }
      let rawText = await res.text();
      
      // 6. 顺畅接入现有的 ECIES 密文响应流安全解密管道（同时嗅探节点明文开关）
      const rawEncryptedHeader = res.headers.get("x-encrypted") || res.headers.get("X-Encrypted");
      if (rawEncryptedHeader === "false") {
        this.plaintextMode = true;
        console.info(`[AgentClient] 节点 ${this.baseURL} 已关闭加密 (x-encrypted: false)，后续通信切换为明文模式（不再签名/加密）`);
      }
      const isEncryptedHeader = rawEncryptedHeader === "true";
      const looksLikeBase64Cipher = !this.plaintextMode && /^[A-Za-z0-9+/=]{100,}$/.test(rawText.trim()) && !rawText.trim().startsWith('{');
      if (!this.plaintextMode && (isEncryptedHeader || looksLikeBase64Cipher) && this.eciesSkPem) {
        try {
          rawText = await eciesDecryptResponse(rawText, this.eciesSkPem);
        } catch (decryptErr) {
          if (isEncryptedHeader) throw decryptErr;
        }
      }

      return JSON.parse(rawText) as FileUploadRawResponse;
    } catch (err: any) {
      if (err.name === 'AbortError') throw new Error(`二进制直传超时 (${this.timeout}ms): ${data.filename}`);
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }
  async downloadFile(path: string): Promise<{ headers: Record<string, string>, blob: Blob }> {
    const { res, data } = await this.safeFetch(`${this.baseURL}/api/file/download`, { method: "POST", body: JSON.stringify({ path }), responseType: 'blob' });
    if (!res.ok) throw new AgentAPIError(`Download failed`, res.status, data);
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => (headers[k] = v));
    return { headers, blob: data }; 
  }
  async deleteFiles(paths: string[]): Promise<FileDeleteResponse> { return this.request<FileDeleteResponse>("DELETE", "/api/file", { paths }); }
  async deleteFilesPost(paths: string[]): Promise<FileDeleteResponse> { return this.request<FileDeleteResponse>("POST", "/api/file/delete", { paths }); }
  async moveFiles(mappings: Record<string, string>): Promise<FileMoveResponse> { return this.request<FileMoveResponse>("PUT", "/api/file", mappings); }
  async copyFiles(mappings: Record<string, string>): Promise<FileMoveResponse> { return this.request<FileMoveResponse>("POST", "/api/file/cp", mappings); }
  async createDirectory(path: string): Promise<FileNewDirResponse> { return this.request<FileNewDirResponse>("POST", "/api/file/new", { path }); }
  async getOneTimeTasks(): Promise<TaskListResponse> { return this.request<TaskListResponse>("GET", "/api/task/onetime"); }
  async setOneTimeTasks(tasks: string[]): Promise<TaskSetResponse> { return this.request<TaskSetResponse>("POST", "/api/task/onetime", tasks); }
  async getCronTasks(): Promise<CronListResponse> { return this.request<CronListResponse>("GET", "/api/task/cron"); }
  async setCronTasks(tasks: CronTask): Promise<CronSetResponse> { return this.request<CronSetResponse>("POST", "/api/task/cron", tasks); }
  async getTaskStatus(): Promise<TaskStatus> { return this.request<TaskStatus>("GET", "/api/task/status"); }
  async getOneTimeLogs(limit = 50): Promise<TaskLogResponse> { return this.request<TaskLogResponse>("GET", "/api/task/log/onetime", undefined, { limit }); }
  async getCronLogs(limit = 50): Promise<TaskLogResponse> { return this.request<TaskLogResponse>("GET", "/api/task/log/cron", undefined, { limit }); }
  async clearOneTimeLogs(): Promise<TaskLogClearResponse> { return this.request<TaskLogClearResponse>("DELETE", "/api/task/log/onetime"); }
  async clearCronLogs(): Promise<TaskLogClearResponse> { return this.request<TaskLogClearResponse>("DELETE", "/api/task/log/cron"); }
  async getLogSummary(): Promise<TaskLogSummary> { return this.request<TaskLogSummary>("GET", "/api/task/log/summary"); }
  async triggerOneTimeTasks(): Promise<TaskTriggerResponse> { return this.request<TaskTriggerResponse>("POST", "/api/task/onetime/execute"); }
  /**
   * 🎫 获取临时密钥对（临时授权第三方，如 AI Agent）
   * GET /api/tempkey?ttl=24
   * - 有效期内重复请求返回同一份密钥（幂等），过期后自动生成新密钥
   * - ttl 单位为小时，范围 1~168，超出范围抛出 422 错误
   */
  async getTempKey(ttl = 24): Promise<TempKeyResponse> {
    if (!Number.isInteger(ttl) || ttl < 1 || ttl > 168) {
      throw new AgentAPIError(`ttl 超出范围 (1~168)，收到: ${ttl}`, 422);
    }
    return this.request<TempKeyResponse>("GET", "/api/tempkey", undefined, { ttl });
  }

  /**
   * 🎫 切换为临时授权密钥对（必须与 /api/tempkey 返回的 ECDSA + ECIES 配套使用）
   * 原因：代理端响应会按签名来源选择 ECIES 公钥加密 —— 静态签名 → 静态公钥加密，
   * 临时签名 → 临时公钥加密。因此切换临时签名后，必须同步切换临时 ECIES 私钥解密，
   * 否则解密会报 "aes/gcm: invalid ghash tag"。
   * 注意：临时密钥过期后需重新 getTempKey 并再次调用本方法。
   */
  useTempKey(tempKey: TempKeyResponse): void {
    this.ecdsaSkPem = tempKey.ecdsa.private_key;
    this.eciesSkPem = tempKey.ecies.private_key;
  }

  /**
   * 🌐 查询临时隧道列表（内网映射）
   * GET /api/argo —— 返回当前全部存活中的 Cloudflare 快速隧道
   */
  async listArgoTunnels(): Promise<ArgoTunnelListResponse> {
    return this.request<ArgoTunnelListResponse>("GET", "/api/argo");
  }

  /**
   * 🌐 创建临时隧道（内网映射）
   * POST /api/argo —— 将指定端口转发为临时公网域名 https://<随机>.trycloudflare.com
   * @param port 隧道转发端口（1~65535），缺省时使用 agent 自身监听端口
   * @param duplicate 是否允许同一端口重复创建，默认 false
   */
  async createArgoTunnel(data: ArgoCreateRequest): Promise<ArgoCreateResponse> {
    return this.request<ArgoCreateResponse>("POST", "/api/argo", data);
  }

  /**
   * 🌐 删除临时隧道（内网映射）
   * DELETE /api/argo —— 停止隧道守护线程，公网域名立即失效
   * @param port 必填，要删除的隧道转发端口
   * @param tunnel_domain 同一端口存在多条隧道（duplicate 创建）时用于精确定位
   */
  async deleteArgoTunnel(data: ArgoDeleteRequest): Promise<ArgoDeleteResponse> {
    return this.request<ArgoDeleteResponse>("DELETE", "/api/argo", data);
  }
}