// src/lib/update.ts
import { AgentClient } from './agent-client';
import { getUploadChunkSize, withRawChunkRetry } from './upload-chunk';

// ==================== 配置与常量定义 ====================
const REPO = 'liveqte/Kisama_agent';

// 像素级对齐 AgentDownload.vue 正确的 Python 端 Unicode 替换正则特征
const PY_PLACEHOLDER_REGEX = {
  ECDSA: /or codecs\.decode\('\\\\u0045\\\\u0043\\\\u0044\\\\u0053\\\\u0041\\\\u516c\\\\u94a5\\\\u5185\\\\u5bb9', 'unicode_escape'\)/g,
  ECIES: /or codecs\.decode\('\\\\u0045\\\\u0043\\\\u0049\\\\u0045\\\\u0053\\\\u516c\\\\u94a5\\\\u5185\\\\u5bb9', 'unicode_escape'\)/g,
} as const;

const JS_PLACEHOLDER_REGEX = {
  ECDSA: /["']ECDSA公钥内容["']/g,
  ECIES: /["']ECIES公钥内容["']/g,
} as const; //

export type AgentType = 'nodejs' | 'python' | 'go' | 'java' | 'unknown';

export interface VersionCheckResult {
  needUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
}

export interface UpdateProgressPayload {
  filename: string;
  currentChunk: number;
  totalChunks: number;
  progress: number;
}
/**
 * 安全的 SemVer 版本号校验助手
 * 能够精准剪切和识别形如 "0.3.0-python"、"v0.3.1-js" 或 "0.2.4" 的版本特征
 */
function isVersionGte30(versionStr: string): boolean {
  if (!versionStr) return false;
  // 提取前面的纯数字位
  const match = versionStr.replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return false;
  
  const major = parseInt(match[1], 10);
  const minor = parseInt(match[2], 10);
  
  if (major > 0) return true;
  if (major === 0 && minor >= 3) return true;
  return false;
}
// ==================== 🛠️ 核心内部助手工具集 ====================

/**
 * 智能相对路径解构提取算法
 * 将形如 "./dist/core/index.js" 精准切分为 { path: "./dist/core/", filename: "index.js" }
 */
function parsePathAndFilename(fullPath: string): { path: string; filename: string } {
  let normalized = fullPath.replace(/\\/g, '/');
  const lastSlash = normalized.lastIndexOf('/');
  if (lastSlash === -1) {
    return { path: './', filename: fullPath };
  }
  let path = normalized.substring(0, lastSlash + 1);
  let filename = normalized.substring(lastSlash + 1);
  if (!path.startsWith('./') && !path.startsWith('/')) {
    path = './' + path;
  }
  return { path, filename };
}

async function getLatestReleaseTag(): Promise<string> {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`);
    if (!res.ok) throw new Error(`GitHub API Error: ${res.status}`);
    const data = await res.json();
    return data.tag_name || 'main';
  } catch (e) {
    console.error('[Update Engine] 无法拉取远程最新版本号:', e);
    throw new Error('获取远程最新版本号失败，请检查网络连接');
  }
}

function toPythonUnicodeEscape(str: string): string {
  return str.split('').map(char => {
    const code = char.charCodeAt(0);
    return '\\\\u' + code.toString(16).padStart(4, '0');
  }).join('');
}

/**
 * 原生安全级 Blob 转义 Base64 助手
 * 利用 FileReader 的 C++ 级底层多线程加速，100% 免疫 TypedArray 带来的共享内存指针偏移 Bug
 */
function readBlobAsBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.substring(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(new Error('资产分块读取 Base64 编码失败'));
    reader.readAsDataURL(blob);
  });
}

/**
 * 🚀 升级版：高可用自适应高性能双通道分块流式上传引擎
 * 内部自适应分流：useRaw 为 true 时流式投递纯净裸二进制字节，为 false 时平滑回落 Base64 文本编码
 */
async function uploadFileInChunks(
  client: AgentClient,
  targetFullPath: string, 
  fileBlob: Blob,         
  useRaw: boolean,         // 🚀 新增：裸字节流直传控制标签
  onProgress?: (payload: UpdateProgressPayload) => void
): Promise<void> {
  const totalSize = fileBlob.size;
  const { path, filename } = parsePathAndFilename(targetFullPath);
  const currentChunkSize = getUploadChunkSize();

  if (totalSize <= currentChunkSize) {
    // 【小文件闪传模式】
    if (useRaw) {
      // 🚀 裸字节一次性直传
      await client.uploadFileRaw({ path, filename, content: fileBlob });
    } else {
      // 兼容老版本：Base64 传统单包发送
      const base64Content = await readBlobAsBase64(fileBlob);
      await client.uploadFile({ path, filename, content: base64Content });
    }
    onProgress?.({ filename, currentChunk: 1, totalChunks: 1, progress: 100 });
  } else {
    // 【大文件分块级联模式】
    const totalChunks = Math.ceil(totalSize / currentChunkSize);
    let uploadedBytes = 0;

    for (let i = 0; i < totalChunks; i++) {
      const start = i * currentChunkSize;
      const end = Math.min(start + currentChunkSize, totalSize);
      
      const chunkBlob = fileBlob.slice(start, end); // 毫秒级内核快速切片
      const segmentSize = end - start;
      
      if (useRaw) {
        // 🚀 裸字节切片直接倾倒至 /api/fileraw（agent 端幂等落盘，失败可安全重试）
        await withRawChunkRetry(() =>
          client.uploadFileRaw({
            path,
            filename,
            content: chunkBlob, // 1:1 纯净投递原始 Blob
            chunk_id: i,
            total_chunks: totalChunks
          })
        );
      } else {
        // 兼容老版本：切片转化为 Base64 字符串发送
        const base64Content = await readBlobAsBase64(chunkBlob);
        await client.uploadFile({
          path,
          filename,
          content: base64Content,
          chunk_id: i,
          total_chunks: totalChunks
        });
      }

      uploadedBytes += segmentSize; 
      if (onProgress) {
        const progress = Math.round((uploadedBytes / totalSize) * 100); 
        onProgress({ filename, currentChunk: i + 1, totalChunks, progress });
      }
    }
  }
}

// ==================== 🚀 外部可直接调用公共业务核心接口 ====================

/**
 * 检查指定代理端节点是否需要版本升级
 */
export async function checkAgentVersion(client: AgentClient): Promise<VersionCheckResult> {
  const latestVersion = await getLatestReleaseTag();
  const baseInfo = await client.getBaseInfo();
  const currentVersion = baseInfo.version || '0.0.0';

  const cleanCurrent = currentVersion.replace(/^v/i, '').split('-')[0];
  const cleanLatest = latestVersion.replace(/^v/i, '').split('-')[0];

  return { needUpdate: cleanCurrent !== cleanLatest, currentVersion, latestVersion };
}

/**
 * 分布式自适应参数注入型核心热升级执行器 (双通道智能分流版)
 */
export async function executeAgentUpdate(
  client: AgentClient,
  globalConfig: { ecdsaPublicKey?: string; eciesPublicKey?: string; ecdsaPrivateKey?: string; eciesPrivateKey?: string },
  options: { agentType: string; primaryFile: string; secondaryFile?: string }, 
  onStatusChange?: (status: string, payload?: UpdateProgressPayload) => void
): Promise<boolean> {
  
  const ecdsaPublicKey = globalConfig.ecdsaPublicKey || globalConfig.ecdsaPrivateKey || '';
  const eciesPublicKey = globalConfig.eciesPublicKey || globalConfig.eciesPrivateKey || '';

  if (!ecdsaPublicKey || !eciesPublicKey) {
    throw new Error('更新中止：控制端全局公钥上下文为空，无法完成特征动态编译织入');
  }

  // 🚀 阶段 0：全自动远端探针版本特征在线审计与通道决断
  onStatusChange?.('正在动态审计远端代理端版本特征...');
  let useRaw = false;
  try {
    const baseInfo = await client.getBaseInfo();
    const currentVersion = baseInfo.version || '0.0.0';
    useRaw = isVersionGte30(currentVersion);
    if (useRaw) {
      onStatusChange?.(`查核通过：当前探针版本为 ${currentVersion}，全自动激活 /api/fileraw 高性能裸流直传通道 ⚡`);
    } else {
      onStatusChange?.(`查核提示：当前探针为老版本 ${currentVersion}，升级过程自动平滑降级至 Base64 编码分块通道 ⚠️`);
    }
  } catch (err) {
    console.warn('[Update Speedway] 远端版本在线审计受限，安全起见自动回落至 Base64 兼容导轨:', err);
  }

  onStatusChange?.('正在获取云端最新源码轨道...');
  const latestTag = await getLatestReleaseTag();
  
  const agentType = options.agentType;
  const rawBase = `https://raw.githubusercontent.com/${REPO}/${latestTag}`;

  switch (agentType) {
    case 'nodejs': {
      onStatusChange?.(`Node.js 轨道：正在编译打包并准备推送至远端目标位置...`);
      const jsRes = await fetch(`${rawBase}/js/agent_obs.js`);
      const pkgRes = await fetch(`${rawBase}/js/package.json`);
      if (!jsRes.ok || !pkgRes.ok) throw new Error('拉取远程 Node.js 源码失败');

      let jsContent = await jsRes.text();
      const pkgContent = await pkgRes.text();

      jsContent = jsContent.replace(JS_PLACEHOLDER_REGEX.ECDSA, JSON.stringify(ecdsaPublicKey));
      jsContent = jsContent.replace(JS_PLACEHOLDER_REGEX.ECIES, JSON.stringify(eciesPublicKey));

      const jsBlob = new Blob([jsContent], { type: 'text/javascript' });
      const pkgBlob = new Blob([pkgContent], { type: 'application/json' });

      onStatusChange?.(`正在热重写远端主实体：${options.primaryFile}`);
      // 💡 传入 useRaw 控制是否开启二进制直传
      await uploadFileInChunks(client, options.primaryFile, jsBlob, useRaw, (p) => onStatusChange?.('index.js 灌录中', p));
      
      if (options.secondaryFile) {
        const { path } = parsePathAndFilename(options.primaryFile);
        const targetPkgPath = `${path}${options.secondaryFile}`;
        onStatusChange?.(`正在热重写环境依赖配置：${targetPkgPath}`);
        await uploadFileInChunks(client, targetPkgPath, pkgBlob, useRaw, (p) => onStatusChange?.('package.json 灌录中', p));
      }
      break;
    }

    case 'python': {
      onStatusChange?.('Python 轨道：正在从云端调取并转译主环境特征...');
      const pyRes = await fetch(`${rawBase}/py/agent_obs.py`);
      const reqRes = await fetch(`${rawBase}/py/requirements.txt`);
      if (!pyRes.ok || !reqRes.ok) throw new Error('拉取远程 Python 源码失败');

      let pyContent = await pyRes.text();
      const reqContent = await reqRes.text();

      const unicodeEcdsa = toPythonUnicodeEscape(ecdsaPublicKey);
      const unicodeEcies = toPythonUnicodeEscape(eciesPublicKey);
      
      pyContent = pyContent.replace(PY_PLACEHOLDER_REGEX.ECDSA, `or codecs.decode('${unicodeEcdsa}', 'unicode_escape')`);
      pyContent = pyContent.replace(PY_PLACEHOLDER_REGEX.ECIES, `or codecs.decode('${unicodeEcies}', 'unicode_escape')`);

      const pyBlob = new Blob([pyContent], { type: 'text/x-python' });
      const reqBlob = new Blob([reqContent], { type: 'text/plain' });

      onStatusChange?.(`正在热重写远端主脚本：${options.primaryFile}`);
      // 💡 传入 useRaw 控制是否开启二进制直传
      await uploadFileInChunks(client, options.primaryFile, pyBlob, useRaw, (p) => onStatusChange?.('主脚本灌录中', p));
      
      if (options.secondaryFile) {
        const { path } = parsePathAndFilename(options.primaryFile);
        const targetReqPath = `${path}${options.secondaryFile}`;
        onStatusChange?.(`正在热重写依赖配置：${targetReqPath}`);
        await uploadFileInChunks(client, targetReqPath, reqBlob, useRaw, (p) => onStatusChange?.('requirements.txt 灌录中', p));
      }
      break;
    }

    case 'go': {
      onStatusChange?.('Go 静态编译轨道：正在拉取全新的预编译核心二进制流...');
      const goRes = await fetch(`${rawBase}/go/agent`);
      if (!goRes.ok) throw new Error('拉取远程 Go 核心可执行程序失败');

      const goBlob = await goRes.blob();
      onStatusChange?.(`正在向远端流式覆盖编译包：${options.primaryFile}`);
      // 💡 传入 useRaw 控制是否开启二进制直传
      await uploadFileInChunks(client, options.primaryFile, goBlob, useRaw, (p) => onStatusChange?.('Go二进制核心分块上传中', p));
      break;
    }

    case 'java': {
      onStatusChange?.('Java 字节码轨道：正在调取混淆重构版 server.jar...');
      const javaRes = await fetch(`${rawBase}/java/target/kisama-agent-java-0.1.0-obfuscated.jar`);
      if (!javaRes.ok) throw new Error('拉取远程 Java 核心 Jar 包失败');

      const javaBlob = await javaRes.blob();
      onStatusChange?.(`正在向远端流式覆盖组件包：${options.primaryFile}`);
      // 💡 传入 useRaw 控制是否开启二进制直传
      await uploadFileInChunks(client, options.primaryFile, javaBlob, useRaw, (p) => onStatusChange?.('Java核心Jar包分块上传中', p));
      break;
    }
  }

  onStatusChange?.('🎉 远端目标资产热更新对齐全线大捷！');
  return true;
}