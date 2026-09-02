<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { zipSync, strToU8 } from 'fflate';
import { inject } from 'vue';

//版本号获取
async function getLatestTag(repo: string): Promise<string> {
    try {
        const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`);
        const data = await response.json();
        // 如果没有正式 Release，可以请求 /tags 获取最新的一个
        return data.tag_name || 'main'; 
    } catch (e) {
        return 'main'; // 兜底策略
    }
}
// ============ 配置区域 ============
const GITHUB_CONFIG = ref({
  repo: 'liveqte/Kisama_agent',
  branch: 'refs/tags/0.0.7', // 默认版本
});

// 文件路径映射
const REMOTE_PATHS = ref({
  pyScript: '',
  requirements: '',
  jsScript: '',
  packageJson: '',
  goBinary: '', // Go 二进制路径
  javaJar: '' // Java jar包路径
});
// 2. 将异步逻辑包装在函数中
async function initVersion() {
  try {
    const latestTag = await getLatestTag(GITHUB_CONFIG.value.repo);
    
    // 更新响应式数据
    GITHUB_CONFIG.value.branch = `refs/tags/${latestTag}`;
    const rawBase = `https://raw.githubusercontent.com/${GITHUB_CONFIG.value.repo}/${GITHUB_CONFIG.value.branch}`;
    const rawPy = `${rawBase}/py`;
    const rawJs = `${rawBase}/js`;
    const rawGo = `${rawBase}/go`;
    const rawJava = `${rawBase}/java/target`;
    REMOTE_PATHS.value = {
      pyScript: `${rawPy}/agent_obs.py`,
      requirements: `${rawPy}/requirements.txt`,
      jsScript: `${rawJs}/agent_obs.js`,
      packageJson: `${rawJs}/package.json`,
      goBinary: `${rawGo}/agent`, // 动态拼接 Go 二进制地址
      javaJar: `${rawJava}/kisama-agent-java-0.1.0-obfuscated.jar` // Java 混淆包相对路径
    };
    console.log("[DEBUG] 版本初始化成功:", latestTag);
  } catch (e) {
    console.error("初始化版本失败", e);
  }
}

// 3. 在挂载后执行，这样 setup 函数本身是同步的
onMounted(() => {
  initVersion();
});

// ============ 占位符正则定义 ============
// Python 端的 Unicode 替换正则
const PY_PLACEHOLDER_REGEX = {
  ECDSA: /or codecs\.decode\('\\\\u0045\\\\u0043\\\\u0044\\\\u0053\\\\u0041\\\\u516c\\\\u94a5\\\\u5185\\\\u5bb9', 'unicode_escape'\)/g,
  ECIES: /or codecs\.decode\('\\\\u0045\\\\u0043\\\\u0049\\\\u0045\\\\u0053\\\\u516c\\\\u94a5\\\\u5185\\\\u5bb9', 'unicode_escape'\)/g,
} as const;

// Node.js 端的纯文本替换正则
const JS_PLACEHOLDER_REGEX = {
  ECDSA: /["']ECDSA公钥内容["']/g,
  ECIES: /["']ECIES公钥内容["']/g,
} as const;

// Python 用 Unicode 编码函数
function toPythonUnicodeEscape(str: string): string {
  return str.split('').map(char => {
    const code = char.charCodeAt(0);
    return '\\\\u' + code.toString(16).padStart(4, '0');
  }).join('');
}

// 默认激活 Node.js 标签页
const activeTab = ref('nodejs'); 

const props = defineProps<{
  globalConfig: {
    ecdsaPublicKey?: string;
    eciesPublicKey?: string;
  }
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const showNotification = inject<(message: string, type?: 'success' | 'error' | 'info') => void>('showNotification')!;

// 计算 Go 和 Java 部署通用的 33字节 压缩版 Base64 格式 ECDSA 公钥
const compressedEcdsaB64 = computed(() => {
  if (!props.globalConfig.ecdsaPublicKey) return '';
  try {
    const cleanedB64 = props.globalConfig.ecdsaPublicKey
      .replace(/-----\s*BEGIN[^-]*-----,?/g, '')
      .replace(/-----\s*END[^-]*-----,?/g, '')
      .replace(/\s+/g, '');
    
    const binaryStr = atob(cleanedB64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    
    if (bytes.length >= 65 && bytes[bytes.length - 65] === 0x04) {
      const xBytes = bytes.slice(bytes.length - 64, bytes.length - 32);
      const lastByteOfY = bytes[bytes.length - 1]; 
      
      const prefix = (lastByteOfY % 2 === 0) ? 0x02 : 0x03;
      
      const compressed = new Uint8Array(33);
      compressed[0] = prefix;
      compressed.set(xBytes, 1);
      
      let binary = '';
      for (let i = 0; i < compressed.length; i++) {
        binary += String.fromCharCode(compressed[i]);
      }
      return btoa(binary);
    }
    return cleanedB64;
  } catch (e) {
    console.error('ECDSA公钥转公钥特征压缩Base64失败:', e);
    return '';
  }
});

// ============ 🚀 部署命令计算属性配置区 ============

// 🟢 Node.js 方式二：npx 动态执行
const nodeNpxCmd = computed(() => {
  const ecdsa = compressedEcdsaB64.value || '/* 请先在设置中配置 ECDSA 公钥 */';
  const ecies = props.globalConfig.eciesPublicKey || '/* 请先在设置中配置 ECIES 公钥 */';
  return `export ECDSA_PUBKEY="${ecdsa}"\nexport ECIES_PUBKEY="${ecies}"\nexport KPORT=8000\nnpx kisama-js`;
});
const nodeNpxCopyCmd = computed(() => {
  return `export ECDSA_PUBKEY="${compressedEcdsaB64.value || ''}"\nexport ECIES_PUBKEY="${props.globalConfig.eciesPublicKey || ''}"\nexport KPORT=8000\nnpx kisama-js`;
});

// 🟢 Node.js 方式三：独立模块嵌入代码
const nodeEmbedCode = computed(() => {
  const ecdsa = compressedEcdsaB64.value || '/* 请在设置中配置 ECDSA 公钥 */';
  const ecies = props.globalConfig.eciesPublicKey || '/* 请先在设置中配置 ECIES 公钥 */';
  return `const { main } = require('kisama-js'); \nconst Options = { \n  PORT: 8000, \n  ECDSA_PUBLIC_KEY_PEM: '${ecdsa}', \n  ECIES_PUBLIC_KEY_PEM: '${ecies}' \n}; \nmain(Options).catch(err => console.error("kisama exit by:", err));`;
});

// 🟢 Node.js 方式四：原一键命令与源码离线下载
const nodeDeployCmd = computed(() => {
  const ecdsa = compressedEcdsaB64.value || '/* 请先在设置中配置 ECDSA 公钥 */';
  const ecies = props.globalConfig.eciesPublicKey || '/* 请先在设置中配置 ECIES 公钥 */';
  return `curl -Lo index.js ${REMOTE_PATHS.value.jsScript}\ncurl -Lo package.json ${REMOTE_PATHS.value.packageJson}\nexport ECDSA_PUBKEY="${ecdsa}"\nexport ECIES_PUBKEY="${ecies}"\nexport KPORT=8000\nnpm install && node index.js`;
});
const nodeCopyCmd = computed(() => {
  return `curl -Lo index.js ${REMOTE_PATHS.value.jsScript}\ncurl -Lo package.json ${REMOTE_PATHS.value.packageJson}\nexport ECDSA_PUBKEY="${compressedEcdsaB64.value || ''}"\nexport ECIES_PUBKEY="${props.globalConfig.eciesPublicKey || ''}"\nexport KPORT=8000\nnpm install && node index.js`;
});

// 🐍 Python 方式二：环境变量与 pip 包部署
const pyPipCmd = computed(() => {
  const ecdsa = compressedEcdsaB64.value || '# 请先在设置中配置 ECDSA 公钥';
  const ecies = props.globalConfig.eciesPublicKey || '# 请先在设置中配置 ECIES 公钥';
  return `export ECDSA_PUBKEY="${ecdsa}"\nexport ECIES_PUBKEY="${ecies}"\nexport KPORT=8000\npip install kisama\nkisama`;
});
const pyPipCopyCmd = computed(() => {
  return `export ECDSA_PUBKEY="${compressedEcdsaB64.value || ''}"\nexport ECIES_PUBKEY="${props.globalConfig.eciesPublicKey || ''}"\nexport KPORT=8000\npip install kisama\nkisama`;
});

// 🐍 Python 方式三：作为依赖模块嵌入 (对应Node.js逻辑)
const pyEmbedCode = computed(() => {
  const ecdsa = compressedEcdsaB64.value || '# 请在设置中配置 ECDSA 公钥';
  const ecies = props.globalConfig.eciesPublicKey || '# 请先在设置中配置 ECIES 公钥';
  return `import os
import time
import kisama.agent
os.environ["KPORT"] = "8000"
os.environ["ECDSA_PUBKEY"] = "${ecdsa}"
os.environ["ECIES_PUBKEY"] = "${ecies}"
kisama.agent.O0_fn_34()
`;
});

// 🐍 Python 方式四：原一键命令与源码离线下载
const pyDeployCmd = computed(() => {
  const ecdsa = compressedEcdsaB64.value || '/* 请先在设置中配置 ECDSA 公钥 */';
  const ecies = props.globalConfig.eciesPublicKey || '/* 请先在设置中配置 ECIES 公钥 */';
  return `curl -Lo main.py ${REMOTE_PATHS.value.pyScript}\ncurl -Lo requirements.txt ${REMOTE_PATHS.value.requirements}\nexport ECDSA_PUBKEY="${ecdsa}"\nexport ECIES_PUBKEY="${ecies}"\nexport KPORT=8000\npip install -r requirements.txt && python main.py`;
});
const pyCopyCmd = computed(() => {
  return `curl -Lo main.py ${REMOTE_PATHS.value.pyScript}\ncurl -Lo requirements.txt ${REMOTE_PATHS.value.requirements}\nexport ECDSA_PUBKEY="${compressedEcdsaB64.value || ''}"\nexport ECIES_PUBKEY="${props.globalConfig.eciesPublicKey || ''}"\nexport KPORT=8000\npip install -r requirements.txt && python main.py`;
});

// 🐹 Go 方式二：加入 KPORT 变量
const goDeployCmd = computed(() => {
  const ecdsa = compressedEcdsaB64.value || '/* 请先在设置中配置 ECDSA 公钥 */';
  const ecies = props.globalConfig.eciesPublicKey || '/* 请先在设置中配置 ECIES 公钥 */';
  return `curl -Lo agent ${REMOTE_PATHS.value.goBinary}\nexport ECDSA_PUBKEY="${ecdsa}"\nexport ECIES_PUBKEY="${ecies}"\nexport KPORT=8000\nchmod +x agent && ./agent`;
});
const goCopyCmd = computed(() => {
  return `curl -Lo agent ${REMOTE_PATHS.value.goBinary}\nexport ECDSA_PUBKEY="${compressedEcdsaB64.value || ''}"\nexport ECIES_PUBKEY="${props.globalConfig.eciesPublicKey || ''}"\nexport KPORT=8000\nchmod +x agent && ./agent`;
});

// ☕ Java 方式二：加入 KPORT 变量
const javaDeployCmd = computed(() => {
  const ecdsa = compressedEcdsaB64.value || '/* 请先在设置中配置 ECDSA 公钥 */';
  const ecies = props.globalConfig.eciesPublicKey || '/* 请先在设置中配置 ECIES 公钥 */';
  return `curl -Lo server.jar ${REMOTE_PATHS.value.javaJar}\nexport ECDSA_PUBKEY="${ecdsa}"\nexport ECIES_PUBKEY="${ecies}"\nexport KPORT=8000\njava -jar server.jar`;
});
const javaCopyCmd = computed(() => {
  return `curl -Lo server.jar ${REMOTE_PATHS.value.javaJar}\nexport ECDSA_PUBKEY="${compressedEcdsaB64.value || ''}"\nexport ECIES_PUBKEY="${props.globalConfig.eciesPublicKey || ''}"\nexport KPORT=8000\njava -jar server.jar`;
});

// 🐳 Docker 方式一：一键命令模板
const dockerDeployCmd = computed(() => {
  const ecdsa = compressedEcdsaB64.value || '/* 请先在设置中配置 ECDSA 公钥 */';
  const ecies = props.globalConfig.eciesPublicKey || '/* 请先在设置中配置 ECIES 公钥 */';
  return `docker run -itd \\\n-e ECDSA_PUBKEY="${ecdsa}" \\\n-e ECIES_PUBKEY="${ecies}" \\\n-e KPORT=8000 \\\n-p 8000:8000 \\\nghcr.io/liveqte/kisama_agent:latest`;
});
const dockerCopyCmd = computed(() => {
  return `docker run -itd \\\n-e ECDSA_PUBKEY="${compressedEcdsaB64.value || ''}" \\\n-e ECIES_PUBKEY="${props.globalConfig.eciesPublicKey || ''}" \\\n-e KPORT=8000 \\\n-p 8000:8000 \\\nghcr.io/liveqte/kisama_agent:latest`;
});

// ============ Node.js 版下载逻辑 (ZIP 打包) ============
const handleDownloadNodejs = async () => {
  const { ecdsaPublicKey, eciesPublicKey } = props.globalConfig;
  if (!ecdsaPublicKey || !eciesPublicKey) {
    showNotification('❌ 请先在"设置"中配置完整的 ECDSA 和 ECIES 公钥', 'error');
    return;
  }
  showNotification('🔄 正在生成定制版 Node.js 代理包...', 'info');
  try {
    const [jsRes, pkgRes] = await Promise.all([
      fetch(REMOTE_PATHS.value.jsScript),
      fetch(REMOTE_PATHS.value.packageJson)
    ]);
    if (!jsRes.ok) throw new Error(`脚本获取失败: ${jsRes.status}`);
    if (!pkgRes.ok) throw new Error(`package.json获取失败: ${pkgRes.status}`);

    let scriptContent = await jsRes.text();
    const pkgContent = await pkgRes.text();

    scriptContent = scriptContent.replace(JS_PLACEHOLDER_REGEX.ECDSA, JSON.stringify(ecdsaPublicKey));
    scriptContent = scriptContent.replace(JS_PLACEHOLDER_REGEX.ECIES, JSON.stringify(eciesPublicKey));

    const zipData = {
      'index.js': strToU8(scriptContent), 
      'package.json': strToU8(pkgContent)
    };

    const zipped = zipSync(zipData);
    const blob = new Blob([zipped as any], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = 'kisama_agent_nodejs.zip';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    showNotification('✅ Node.js 定制包下载成功！', 'success');
  } catch (err) {
    console.error('Node.js 下载失败:', err);
    showNotification('❌ 获取远程文件失败', 'error');
  }
};

// ============ Python 版下载逻辑 (ZIP 打包) ============
const handleDownloadPython = async () => {
  const { ecdsaPublicKey, eciesPublicKey } = props.globalConfig;
  if (!ecdsaPublicKey || !eciesPublicKey) {
    showNotification('❌ 请先在"设置"中配置完整的 ECDSA 和 ECIES 公钥', 'error');
    return;
  }
  showNotification('🔄 正在生成定制版 Python 代理包...', 'info');
  try {
    const [pyRes, reqRes] = await Promise.all([
      fetch(REMOTE_PATHS.value.pyScript),
      fetch(REMOTE_PATHS.value.requirements)
    ]);
    if (!pyRes.ok) throw new Error(`脚本获取失败: ${pyRes.status}`);
    if (!reqRes.ok) throw new Error(`requirements获取失败: ${reqRes.status}`);

    let scriptContent = await pyRes.text();
    const reqContent = await reqRes.text();

    if (ecdsaPublicKey) {
      const unicodeEscaped = toPythonUnicodeEscape(ecdsaPublicKey);
      const replacement = `or codecs.decode('${unicodeEscaped}', 'unicode_escape')`;
      scriptContent = scriptContent.replace(PY_PLACEHOLDER_REGEX.ECDSA, replacement);
    }
    if (eciesPublicKey) {
      const unicodeEscaped = toPythonUnicodeEscape(eciesPublicKey);
      const replacement = `or codecs.decode('${unicodeEscaped}', 'unicode_escape')`;
      scriptContent = scriptContent.replace(PY_PLACEHOLDER_REGEX.ECIES, replacement);
    }

    const zipData = {
      'main.py': strToU8(scriptContent), 
      'requirements.txt': strToU8(reqContent)
    };

    const zipped = zipSync(zipData);
    const blob = new Blob([zipped as any], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = 'kisama_agent_python.zip';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    showNotification('✅ Python 定制包下载成功！', 'success');
  } catch (err) {
    console.error('Python 下载失败:', err);
    showNotification('❌ 获取远程文件失败', 'error');
  }
};

// ============ Go 版下载逻辑 ============
const handleDownloadGo = async () => {
  const { ecdsaPublicKey, eciesPublicKey } = props.globalConfig;
  if (!ecdsaPublicKey || !eciesPublicKey) {
    showNotification('❌ 请先在"设置"中配置完整的 ECDSA 和 ECIES 公钥', 'error');
    return;
  }
  showNotification('🔄 正在生成定制版 Go 代理包...', 'info');
  try {
    const goRes = await fetch(REMOTE_PATHS.value.goBinary);
    if (!goRes.ok) throw new Error(`Go 二进制程序获取失败: ${goRes.status}`);

    const goBuffer = await goRes.arrayBuffer();
    const goBinaryUint8 = new Uint8Array(goBuffer);

    const zipData = {
      'agent': goBinaryUint8, 
      'keys/agent_ecdsa_pub.pem': strToU8(ecdsaPublicKey),
      'keys/agent_ecies_pub.b64': strToU8(eciesPublicKey)
    };

    const zipped = zipSync(zipData);
    const blob = new Blob([zipped as any], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = 'kisama_agent_go.zip';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    showNotification('✅ Go 定制版配置压缩包下载成功！', 'success');
  } catch (err) {
    console.error('Go 下载打包失败:', err);
    showNotification('❌ 获取远程二进制文件或打包失败', 'error');
  }
};

// ============ Java 版下载逻辑 ============
const handleDownloadJava = async () => {
  const { ecdsaPublicKey, eciesPublicKey } = props.globalConfig;
  if (!ecdsaPublicKey || !eciesPublicKey) {
    showNotification('❌ 请先在"设置"中配置完整的 ECDSA 和 ECIES 公钥', 'error');
    return;
  }
  showNotification('🔄 正在生成定制版 Java 代理包...', 'info');
  try {
    const javaRes = await fetch(REMOTE_PATHS.value.javaJar);
    if (!javaRes.ok) throw new Error(`Java 程序包获取失败: ${javaRes.status}`);

    const javaBuffer = await javaRes.arrayBuffer();
    const javaJarUint8 = new Uint8Array(javaBuffer);

    const zipData = {
      'server.jar': javaJarUint8, 
      'keys/agent_ecdsa_pub.pem': strToU8(ecdsaPublicKey),
      'keys/agent_ecies_pub.b64': strToU8(eciesPublicKey)
    };

    const zipped = zipSync(zipData);
    const blob = new Blob([zipped as any], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = 'kisama_agent_java.zip';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    showNotification('✅ Java 定制版配置压缩包下载成功！', 'success');
  } catch (err) {
    console.error('Java 下载打包失败:', err);
    showNotification('❌ 获取远程 Jar 文件或打包失败', 'error');
  }
};

const copyCommand = (cmd: string) => {
  navigator.clipboard.writeText(cmd);
  showNotification('📋 下载命令已复制，可直接粘贴到服务器运行', 'success');
};
</script>

<template>
  <Transition name="modal">
    <div class="modal-overlay" @click.self="emit('close')">
      <div class="modal-content" style="max-width: 650px;">
        <div class="modal-header">
          <div>
            <h3>⬇️ Agent探针下载</h3>
            <p class="hint">
              当前版本: <code>{{ GITHUB_CONFIG.branch.replace('refs/tags/', '') }}</code> 
              | <a :href="`https://github.com/${GITHUB_CONFIG.repo}/releases`" target="_blank" class="link">查看更新</a>
            </p>
          </div>
          <button class="btn icon" @click="emit('close')">×</button>
        </div>

        <div class="tabs-nav">
          <button 
            class="tab-btn" 
            :class="{ active: activeTab === 'nodejs' }" 
            @click="activeTab === 'nodejs' ? null : activeTab = 'nodejs'"
          >
            📦 Node.js 版
          </button>
          <button 
            class="tab-btn" 
            :class="{ active: activeTab === 'python' }" 
            @click="activeTab = 'python'"
          >
            🐍 Python 版
          </button>
          <button 
            class="tab-btn" 
            :class="{ active: activeTab === 'go' }" 
            @click="activeTab = 'go'"
          >
            🐹 Go 版
          </button>
          <button 
            class="tab-btn" 
            :class="{ active: activeTab === 'java' }" 
            @click="activeTab = 'java'"
          >
            ☕ Java 版
          </button>
          <button 
            class="tab-btn" 
            :class="{ active: activeTab === 'docker' }" 
            @click="activeTab = 'docker'"
          >
            🐳 Docker 版
          </button>
        </div>

        <div class="modal-body">
          
          <div v-if="activeTab === 'nodejs'" class="tab-pane">
            <div class="download-section">
              <div class="section-header">
                <h4>📄 运行说明</h4>
                <p class="desc">根据下方选择的部署方式，在终端或者项目工程中完成配置和执行。</p>
              </div>
            </div>

            <hr class="divider" />

            <div class="download-section">
              <div class="section-header">
                <h4>📦 方式一：下载定制版压缩包 (推荐)</h4>
                <p class="desc">自动注入全局公钥，并将 index.js 与 package.json 打包，开箱即用。</p>
              </div>
              <div class="key-status">
                <div class="status-item">
                  <span>ECDSA / ECIES 公钥:</span>
                  <span :class="(props.globalConfig.ecdsaPublicKey && props.globalConfig.eciesPublicKey) ? 'text-success' : 'text-error'">
                    {{ (props.globalConfig.ecdsaPublicKey && props.globalConfig.eciesPublicKey) ? '✅ 已就绪' : '❌ 未在“设置”中配置' }}
                  </span>
                </div>
              </div>
              <button 
                class="btn primary full-width" 
                @click="handleDownloadNodejs"
                :disabled="!props.globalConfig.ecdsaPublicKey || !props.globalConfig.eciesPublicKey"
              >
                📥 生成并下载 Node.js 定制包 (.zip)
              </button>
            </div>

            <hr class="divider" />

            <div class="download-section">
              <div class="section-header">
                <h4>⚡ 方式二：使用 npx 极其轻量部署 (无需下载脚本)</h4>
                <p class="desc">利用 npm 全局免安装缓存特征，通过环境变量动态转义注入参数并拉起最新探针。</p>
              </div>
              <div class="code-block">
                <code class="command-text">{{ nodeNpxCmd }}</code>
                <button class="btn secondary btn-sm copy-btn" @click="copyCommand(nodeNpxCopyCmd)">复制全部</button>
              </div>
            </div>

            <hr class="divider" />

            <div class="download-section">
              <div class="section-header">
                <h4>🔌 方式三：作为依赖嵌入现有微服务项目</h4>
                <p class="desc">
                  ⚠️ 提示：请先确保在您既有项目的 <code>package.json</code> 依赖中手动添加并执行 <code>"kisama-js": "latest"</code> 安装。
                </p>
              </div>
              <div class="code-block">
                <code class="command-text">{{ nodeEmbedCode }}</code>
                <button class="btn secondary btn-sm copy-btn" @click="copyCommand(nodeEmbedCode)">复制脚本</button>
              </div>
            </div>

            <hr class="divider" />

            <div class="download-section">
              <div class="section-header">
                <h4>🐧 方式四：一键命令与环境变量离线部署 (源码模式)</h4>
                <p class="desc">一键下载原始核心脚本，并通过 Linux 环境变量无感注入公钥特征与服务端口。</p>
              </div>
              <div class="code-block">
                <code class="command-text">{{ nodeDeployCmd }}</code>
                <button class="btn secondary btn-sm copy-btn" @click="copyCommand(nodeCopyCmd)">复制全部</button>
              </div>
            </div>
          </div>

          <div v-if="activeTab === 'python'" class="tab-pane">
            <div class="download-section">
              <div class="section-header">
                <h4>📄 运行说明</h4>
                <p class="desc">根据下方选择的部署方式，在终端或者项目工程中完成配置和执行。</p>
              </div>
            </div>

            <hr class="divider" />

            <div class="download-section">
              <div class="section-header">
                <h4>📦 方式一：下载定制版压缩包 (推荐)</h4>
                <p class="desc">自动注入全局公钥，并将 main.py 与 requirements.txt 打包，开箱即用。</p>
              </div>
              
              <div class="key-status">
                <div class="status-item">
                  <span>ECDSA / ECIES 公钥:</span>
                  <span :class="(props.globalConfig.ecdsaPublicKey && props.globalConfig.eciesPublicKey) ? 'text-success' : 'text-error'">
                    {{ (props.globalConfig.ecdsaPublicKey && props.globalConfig.eciesPublicKey) ? '✅ 已就绪' : '❌ 未在“设置”中配置' }}
                  </span>
                </div>
              </div>

              <button 
                class="btn primary full-width" 
                @click="handleDownloadPython"
                :disabled="!props.globalConfig.ecdsaPublicKey || !props.globalConfig.eciesPublicKey"
              >
                📥 生成并下载 Python 定制包 (.zip)
              </button>
            </div>

            <hr class="divider" />

            <div class="download-section">
              <div class="section-header">
                <h4>🚀 方式二：使用 pip 安装并一键启动</h4>
                <p class="desc">基于官方 PyPI 托管分发，通过标准全局指令与系统环境变量无感映射注册。</p>
              </div>
              <div class="code-block">
                <code class="command-text">{{ pyPipCmd }}</code>
                <button class="btn secondary btn-sm copy-btn" @click="copyCommand(pyPipCopyCmd)">复制全部</button>
              </div>
            </div>

            <hr class="divider" />

            <div class="download-section">
              <div class="section-header">
                <h4>🔌 方式三：作为依赖模块嵌入现有 Python 项目</h4>
                <p class="desc">在既有 Python 项目中通过模块方式引用，利用内部作用域注入上下文并调用入口主函数。</p>
              </div>
              <div class="code-block">
                <code class="command-text">{{ pyEmbedCode }}</code>
                <button class="btn secondary btn-sm copy-btn" @click="copyCommand(pyEmbedCode)">复制脚本</button>
              </div>
            </div>

            <hr class="divider" />

            <div class="download-section">
              <div class="section-header">
                <h4>🐧 方式四：一键命令与环境变量离线部署 (源码模式)</h4>
                <p class="desc">从仓库拉取环境和原始主脚本，直接通过标准 Linux 环境变量在运行时动态转义注入公钥与端口。</p>
              </div>
              <div class="code-block">
                <code class="command-text">{{ pyDeployCmd }}</code>
                <button class="btn secondary btn-sm copy-btn" @click="copyCommand(pyCopyCmd)">复制全部</button>
              </div>
            </div>
          </div>

          <div v-if="activeTab === 'go'" class="tab-pane">
            <div class="download-section">
              <div class="section-header">
                <h4>📄 运行说明</h4>
                <p class="desc">下载解压或给二进制赋予可执行权限后，直接运行启动服务即可。</p>
              </div>
              <div class="flex-actions">
                <div class="code-inline" style="text-align: center;">
                  <code>chmod +x agent && ./agent</code>
                </div>
              </div>
            </div>

            <hr class="divider" />

            <div class="download-section">
              <div class="section-header">
                <h4>📦 方式一：下载定制版压缩包 (推荐)</h4>
                <p class="desc">自动打包远程编译核心，并建立 <code>keys/</code> 专属公钥目录结构，直接运行无感绑定。</p>
              </div>
              
              <div class="key-status">
                <div class="status-item">
                  <span>ECDSA / ECIES 公钥:</span>
                  <span :class="(props.globalConfig.ecdsaPublicKey && props.globalConfig.eciesPublicKey) ? 'text-success' : 'text-error'">
                    {{ (props.globalConfig.ecdsaPublicKey && props.globalConfig.eciesPublicKey) ? '✅ 已就绪' : '❌ 未在“设置”中配置' }}
                  </span>
                </div>
              </div>

              <button 
                class="btn primary full-width" 
                @click="handleDownloadGo"
                :disabled="!props.globalConfig.ecdsaPublicKey || !props.globalConfig.eciesPublicKey"
              >
                📥 生成并下载 Go 定制包 (.zip)
              </button>
            </div>

            <hr class="divider" />

            <div class="download-section">
              <div class="section-header">
                <h4>🐧 方式二：一键命令与环境变量部署</h4>
                <p class="desc">从仓库拉取最新核心程序，并直接通过环境变量注入公钥（🚀 Go 版本已全面同步变更为标准 33字节 压缩 Base64 格式）。</p>
              </div>
              <div class="code-block">
                <code class="command-text">{{ goDeployCmd }}</code>
                <button class="btn secondary btn-sm copy-btn" @click="copyCommand(goCopyCmd)">复制全部</button>
              </div>
            </div>
          </div>

          <div v-if="activeTab === 'java'" class="tab-pane">
            <div class="download-section">
              <div class="section-header">
                <h4>📄 运行说明</h4>
                <p class="desc">确保系统已安装 Java 8 或更高版本，使用 Jar 命令启动服务。</p>
              </div>
              <div class="flex-actions">
                <div class="code-inline" style="text-align: center;">
                  <code>java -jar server.jar</code>
                </div>
              </div>
            </div>

            <hr class="divider" />

            <div class="download-section">
              <div class="section-header">
                <h4>📦 方式一：下载部署压缩包 (推荐)</h4>
                <p class="desc">自动打包混淆版 <code>server.jar</code> 核心实体，并建立 <code>keys/</code> 专属公钥目录结构，开箱即用。</p>
              </div>
              
              <div class="key-status">
                <div class="status-item">
                  <span>ECDSA / ECIES 公钥:</span>
                  <span :class="(props.globalConfig.ecdsaPublicKey && props.globalConfig.eciesPublicKey) ? 'text-success' : 'text-error'">
                    {{ (props.globalConfig.ecdsaPublicKey && props.globalConfig.eciesPublicKey) ? '✅ 已就绪' : '❌ 未在“设置”中配置' }}
                  </span>
                </div>
              </div>

              <button 
                class="btn primary full-width" 
                @click="handleDownloadJava"
                :disabled="!props.globalConfig.ecdsaPublicKey || !props.globalConfig.eciesPublicKey"
              >
                📥 生成并下载 Java 定制包 (.zip)
              </button>
            </div>

            <hr class="divider" />

            <div class="download-section">
              <div class="section-header">
                <h4>🐧 方式二：一键命令与环境变量部署</h4>
                <p class="desc">直接拉取原始核心包，并在 Linux 环境中通过一键组合命令和环境变量注入公钥。</p>
              </div>
              
              <div class="code-block">
                <code class="command-text">{{ javaDeployCmd }}</code>
                <button class="btn secondary btn-sm copy-btn" @click="copyCommand(javaCopyCmd)">复制全部</button>
              </div>
            </div>
          </div>

          <div v-if="activeTab === 'docker'" class="tab-pane">
            <div class="download-section">
              <div class="section-header">
                <h4>📄 运行说明</h4>
                <p class="desc">确保系统已成功安装并启动 Docker 引擎，执行下方一键启动命令即可。</p>
              </div>
            </div>

            <hr class="divider" />

            <div class="download-section">
              <div class="section-header">
                <h4>🐋 一键命令与容器化部署</h4>
                <p class="desc">基于官方 GitHub Container Registry (GHCR) 镜像，通过环境变量在运行时动态转义注入公钥与探针端口。</p>
              </div>
              <div class="code-block">
                <code class="command-text">{{ dockerDeployCmd }}</code>
                <button class="btn secondary btn-sm copy-btn" @click="copyCommand(dockerCopyCmd)">复制全部</button>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.download-section { margin-bottom: 24px; }
.section-header h4 { margin: 0 0 4px 0; color: var(--text); }
.desc { font-size: 0.85rem; color: var(--muted); margin-bottom: 12px; }
.key-status {
  background: var(--chip-online-bg);
  padding: 10px 14px;
  border-radius: 6px;
  margin-bottom: 12px;
  border: 1px solid var(--chip-online-border);
}
.status-item {
  display: flex;
  justify-content: space-between;
  font-size: 0.9rem;
  margin-bottom: 4px;
}
.text-success { color: #16a34a; font-weight: 600; }
.text-error { color: #dc2626; font-weight: 600; }
.full-width { width: 100%; justify-content: center; padding: 12px; font-weight: 600; }
.code-block {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  background: var(--code-bg);
  color: #e2e8f0;
  padding: 12px;
  border-radius: 6px;
  gap: 12px;
  border: 1px solid var(--border);
}
.code-block code { user-select: text; }
.code-block code.command-text { color: #f8fafc; } /* 🚀 核心修复：移除 user-select: all，支持正常拖拽选取，不再一触全选 */
.btn-sm { padding: 4px 10px; font-size: 0.8rem; }
.divider { border: 0; border-top: 1px dashed var(--border); margin: 20px 0; }
.command-text {
  flex: 1;
  word-break: break-all;
  white-space: pre-wrap; /* 🚀 保留 \n 换行格式 */
  font-size: 0.85rem;
  line-height: 1.6;
}
.copy-btn {
  flex-shrink: 0; 
  padding: 4px 10px;
  font-size: 0.8rem;
  white-space: nowrap; 
  margin-top: 2px;
}
@media (max-width: 480px) {
  .code-block {
    flex-direction: column; 
    align-items: stretch;
  }
  .copy-btn {
    align-self: flex-end; 
    margin-top: 8px;
  }
}
.tabs-nav {
  display: flex;
  gap: 0;              /* 移除间隙，确保无缝平分 */
  padding: 0;          /* 移除左右内边距，占据所有横向空间 */
  border-bottom: 1px solid var(--border);
  background: var(--surface-2);
  width: 100%;         /* 确保容器宽度 100% */
}

.tab-btn {
  flex: 1;             /* 核心：5个按钮平分空间 */
  min-width: 0;        /* 防止文字过长挤压其他 Tab */
  text-align: center;  
  white-space: nowrap; 
  padding: 14px 4px;   /* 增加上下高度，减少左右内边距 */
  border: none;
  background: none;
  cursor: pointer;
  font-size: 0.9rem;   /* 稍微调小一点字号，确保在小屏幕不换行 */
  color: var(--muted);
  border-bottom: 2px solid transparent;
  transition: all 0.2s;
  
  /* 可选：添加按钮间的分割线 */
  border-left: 1px solid transparent; 
}

/* 第一个按钮不需要左边框 */
.tab-btn:not(:first-child) {
  border-left: 1px solid var(--border); 
}

.tab-btn:hover:not(.disabled) { 
  color: var(--primary); 
  background: var(--surface-3); 
}

.tab-btn.active { 
  color: var(--primary); 
  font-weight: 600; 
  border-bottom-color: var(--primary);
  background: var(--btn-bg); /* 激活时背景高亮，增加区分度 */
}

/* --- 其他原有样式 --- */
.download-section { margin-bottom: 24px; }
.section-header h4 { margin: 0 0 4px 0; color: var(--text); }
.desc { font-size: 0.85rem; color: var(--muted); margin-bottom: 12px; }
.key-status {
  background: var(--chip-online-bg);
  padding: 10px 14px;
  border-radius: 6px;
  margin-bottom: 12px;
  border: 1px solid var(--chip-online-border);
}
.status-item {
  display: flex;
  justify-content: space-between;
  font-size: 0.9rem;
  margin-bottom: 4px;
}
.text-success { color: #16a34a; font-weight: 600; }
.text-error { color: #dc2626; font-weight: 600; }
.full-width { width: 100%; justify-content: center; padding: 12px; font-weight: 600; }
.code-block {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  background: var(--code-bg);
  color: #e2e8f0;
  padding: 12px;
  border-radius: 6px;
  gap: 12px;
  border: 1px solid var(--border);
}
.code-block code { user-select: text; }
.code-block code.command-text { color: #f8fafc; }
.btn-sm { padding: 4px 10px; font-size: 0.8rem; }
.divider { border: 0; border-top: 1px dashed var(--border); margin: 20px 0; }
.command-text {
  flex: 1;
  word-break: break-all;
  white-space: pre-wrap;
  font-size: 0.85rem;
  line-height: 1.6;
}
.copy-btn {
  flex-shrink: 0; 
  padding: 4px 10px;
  font-size: 0.8rem;
  white-space: nowrap; 
  margin-top: 2px;
}
@media (max-width: 480px) {
  .code-block {
    flex-direction: column; 
    align-items: stretch;
  }
  .copy-btn {
    align-self: flex-end; 
    margin-top: 8px;
  }
  /* 移动端如果太挤，可以微调字号 */
  .tab-btn { font-size: 0.8rem; padding: 12px 2px; }
}
.flex-actions { display: flex; align-items: center; gap: 12px; margin-top: 8px; }
 .code-inline {
  background: var(--surface-3);
  color: var(--text-soft);
  padding: 8px 12px;
  border-radius: 6px;
  border: 1px solid var(--border);
  flex: 1;
  font-family: monospace;
  font-size: 0.85rem;
  text-align: left !important;
}
</style>