# Kisama 更新记录(0.4.9)

## 2026-08-30

### 适配：agent 0.4.8 安全更新的通信协议（面板 0.5.0，同时保留旧版 agent 兼容）

agent 0.4.8 收紧了两处通信细节：① HTTP 签名消息由 2 段 `nonce+timestamp` 变为 5 段 `method\npath\nsha256(body)\nnonce\ntimestamp`；② 超级终端 WS 明文降级模式 token 由 agent 公钥改为 `Base64(HMAC-SHA256(base64decode(session_key), "kisama-ws-token-v1"))`，且 Noise 模式强制校验控制端静态公钥并要求预置对端公钥。面板本次升级默认走 0.4.8 新协议，同时**保留连接旧版 agent（≤0.4.7）的能力**——所有旧协议分支以 `@deprecated` / `LEGACY_AGENT_SUPPORT` 标记，**面板 0.6.0 将彻底移除旧协议支持**：

- **签名重构（lib/agent-client.ts）**：`generateAuthHeaders` 支持 v2（五段）/ v1-legacy（旧两段）双协议；`safeFetch` 调整为「先 AES 加密、后签名实际发送字节」；GET/DELETE 无体请求与 `/api/fileraw` 裸流按约定签空 body 哈希；签名 path 不含 query
- **401 协议自动探测**：认证请求遇 401 且协议未落定时，新旧两套签名各试一次，成功的一套按节点域名持久化到 localStorage（`kisama_agent_proto_<host>`），后续直连
- **旧版 agent 白名单"静默验签失败"探测（关键修复）**：≤0.4.7 agent 的 `/api/baseinfo`、`/api/status` 是验签失败匿名放行白名单——签名无效时不返回 401，而是返回 200 + 明文 + 剔除 `session_key` 的基础信息。旧信号会连锁误导面板：401 探测永不触发 + `x-encrypted: false` 被误判为明文节点导致永久停签 → 旧版节点全部 401。现改为：协议未落定时收到"带签名请求却拿到无 `session_key` 的 baseinfo"视同验签失败，自动 flip 协议重试；两套协议均拿不到 `session_key` 才判定为真明文节点；`x-encrypted: false` 的明文嗅探在协议落定前不再抢先生效
- **密钥轮换恢复**：0.4.8 在 tempkey 过期时轮换 `session_key`——协议落定后仍遇 401 时，作废缓存密钥、重拉 baseinfo 后自动重试一次
- **WS token 双轨（Terminal2.vue）**：按 `baseinfo.version` 与 0.4.8 比较（或已持久化的探测结果）选择 HMAC token / 旧版公钥 token；被 1008 拒绝时自动切换方案重连一次；Noise 握手完成前被 close 1000（密钥轮换特征）时重拉 baseinfo 重试一次
- **Noise 预置对端公钥（lib/noise.ts）**：`Noise.create` 将 `noise_key.agent.public` 作为发起方 rs 传入 `Initialize`（对齐 tools/control.py 参考实现；旧版 WASM 库不支持时自动降级并告警）
- **新增 lib/proto-detect.ts**：协议探测持久化（`getProtoScheme`/`saveProtoScheme`）、旧版判定 `isLegacyAgentVersion`、公开常量 `LEGACY_AGENT_EOL = '0.6.0'`
- **UI 旧版提示（NodeCard.vue / NodeTable.vue）**：节点运行 <0.4.8 agent 时显示「旧版」角标，悬停提示"面板 0.6.0 起将不再支持，请升级 agent"

## 2026-08-28

### 修复：火狐下点击「⚙️ 设置」无法弹出设置对话框（Setting.vue）
- 现象：Chrome 下正常，火狐点击设置按钮无反应、控制台报 `DOMException: String contains an invalid character`（源自 Vue `patchAttr` 的 `setAttribute` 抛错）
- 根因：`Setting.vue` 密钥设置选项卡两处 `<textarea>`（ECDSA / ECIES 私钥）标签上残留了无效静态属性 `globalErrors.ecdsa=''` 与 `globalErrors.ecies=''`，属性名含 `.` 且值取空字符串；Chrome 静默忽略该非法属性，火狐严格在 `setAttribute` 阶段抛出 `InvalidCharacterError`，导致整个 `Setting` 组件首次渲染中断、弹窗打不开
- 修复：移除这两处无效静态属性；密钥输入框内容展示/编辑仍由 `v-model="globalForm.xxxPrivateKey"` 控制，校验失败的错误提示仍由下方 `<p v-if="globalErrors.xxx">` 控制，功能不受影响

## 2026-08-25

### 新增：WebDAV 客户端库（lib/webdav.ts）
- 常见交互全覆盖：`testConnection` 连接测试、`stat`/`exists`/`list` 元信息查询（PROPFIND multistatus 解析，兼容各服务器命名空间差异）、`uploadText`/`uploadBinary` 上传（默认自动建父目录）、`downloadText`/`downloadBinary` 下载（404 返回 null）、`mkdir`/`mkdirp`、幂等 `delete`、`move`/`copy`
- Basic Auth（非 ASCII 账号密码安全编码）、单请求超时控制（AbortController，默认 15s）、`WebDavError` 携带状态码与方法路径
- 同步决策核心：`compareWithRemote` 判定四向结论（本地上传 / 远程下载 / 已一致 / 冲突），内容比对优先 SHA-256（非 https 环境自动降级 FNV-1a）；`syncFile` 一站式执行，支持冲突策略与 dryRun
- 时钟偏移校准：`measureClockOffset` 经响应 Date 头测量服务器与本机时钟差并缓存，跨设备比较"谁更新"前先校准时间基准，消除系统时间不一致误判
- 登录态存取助手：`loadWebDavConfig` / `saveWebDavConfig` / `clearWebDavConfig` / `createWebDavClient`（存储键 `kisama_webdav_config`）
- CORS 中转支持：`proxyDomain` 配置后所有请求包裹为 `https://<中转>/kisamaproxy/<原始URL>` 借中转站转发，未配置则直连

### 新增：登录入口与云同步账号管理弹窗（App.vue / WebDavLogin.vue）
- Header 二级组新增「🔑 登录」一级入口；登录后变「☁️ 已登录」绿色胶囊，点击可再次打开管理
- 弹窗字段：服务器地址 + 远端目录一行、账号 + 密码一行（双列布局，窄屏自动回落单列），密码内嵌 👁 显示切换
- 「🔌 测试连接」不落盘真实探测；「🔑 登录」强制校验通过才允许保存（失败阻断并报错）
- 测试结果复用：刚点过测试连接且参数未再改动时，登录跳过二次校验；任一参数被编辑立即失效缓存重新走真实校验
- 高级设置折叠区：CORS 中转域名输入框挂 datalist 联想「⚙️ 设置 → 全局网络中转配置」维护的域名池，也支持手动输入；实时预览转发格式；测试连接/登录校验与实际链路完全一致（含中转）
- 「✅ 已登录」横幅地址只在登录通过校验那一刻更新，不随输入框实时联动
- 退出登录清除本地配置，按钮即时回退

### 新增：配置云同步引擎——分域合并策略（lib/configsync.ts）
- 同步对象：远端 `kisama.json`（与本地 📤 导出完全同构的全量备份包），覆盖远端前自动留档 `kisama.backup.json`（仅保留最近一代）
- 三局面自动路由：
  - 远端无文件 → 推送本地全量（pushed）
  - 本地无节点 → 拉取云端应用（pulled）
  - 双方都有 → 内容一致直接结束（in-sync）；否则分域合并（merged）
- 分域合并规则（借鉴 RFC 7386 Merge Patch 设计理念）：
  - 节点名单域：按 node.id 取两侧并集，同 id 比较 updatedAt（回退 createdAt）新者胜
  - 设置域（中转/发布页/样式/脚本/extraStorage/全局密钥）：整域替换、永不拼接；归属判定不依赖时钟，靠本地同步账本记录的上次同步内容快照——本机改过听本机，没动过听云端，无账本本机优先
- 安全带：远端 JSON 损坏自动挪入 backup 后用本地自愈；dataType 不识别拒绝应用；single-flight 锁防止登录触发与定时触发撞车
- 收敛不变式：任何成功同步结束时满足 本地 == 远端 == 账本，定时重复调用幂等，杜绝循环推送
- 显式取舍：同步不传播删除（并集语义，永不因同步丢配置）；节点探针缓存字段（status/baseinfo/lastConnected/ipType/flag）不参与合并与哈希，避免后台刷新造成同步风暴
- WebDAV 连接参数隔离：`kisama_webdav_config` 在云同步打包与应用链路双向排除（连不上远端就谈不上同步，更不能被远端数据反向覆盖自断连接）；本地 📤 导出 / 📥 导入维持原行为照常包含还原

### 增强：全量备份包升级 v1.1.0——localStorage 无损收录（configsync.ts / App.vue）
- 打包范围由旧版仅 4 个具名键扩展为：除排除清单外的**全部** localStorage 键值（含全局密钥 agent_global_config、视图偏好、主题、看板配置等）收进 `globalSettings.extraStorage`
- 原始字符串逐字节收录与写回，不做 parse/stringify 往返，彻底消除类型变形导致的配置损坏
- 兼容矩阵：新版导出被旧版本面板导入→旧版只读 4 个具名键正常工作；旧备份包导入新版→无 extraStorage 自动跳过行为不变
- 导出、文件导入、云同步三方共用同一套打包/应用函数，单一数据结构零漂移

### 新增：定时配置云同步进程（task-daemon.ts）
- 第三个常驻后台任务：页面加载约 45 秒首轮（错峰避开节点初始化高峰），之后每 10 分钟一轮
- 静默运行：未登录引擎内部直接跳过零开销；仅在真实发生推送/拉取/合并或失败时输出日志/toast

### 新增：云端链路健康状态与按钮三态展示（lib/webdav-status.ts / configsync.ts / App.vue）
- 引擎每轮同步结束上报链路状态（全局响应式单例）：成功 → ok，失败（超时/拒连/格式异常）→ error 并携带错误信息，退出登录重置 unknown
- 首页按钮三态：未登录「🔑 登录」；已登录且可达「☁️ 已登录」（绿色）；已登录但最近一轮失败「⚠️ 已登录·失联」（黄色警示），悬停显示具体原因，恢复连通后下一轮自动转绿
- 定时任务兜底发现失联，最多 10 分钟内反映到首页

### 调整：「全部同步」按钮移至筛选栏（App.vue / NodeFilterSort.vue）
- 由 Header 第一组移除，改为筛选栏「保留IP信息」之后的 32×32 小图标按钮（🔃，与排序方向按钮同规格），点击向上派发事件，loading 期间禁用
- Header 同步入口精简后仅保留在线徽章

### 修复：重复导入/云同步反复刷新节点时间戳的抖动隐患（useNodes.ts）
- 根因：importConfig 对已存在 id 的节点一律整体覆盖并强刷 updatedAt，即使内容完全相同；定时云同步每次应用都会制造"新变化"，造成永远同步不完的死循环风险
- 修复：按稳定特征投影比对，内容一致的节点原样保留（不动 updatedAt、不丢本地探测缓存）；仅对实质变化的节点刷新时间戳并保留原有易变字段

### 新增：推送前自动确保远端根目录存在（webdav.ts / configsync.ts）
- 修复填了 basePath 但远端目录不存在时 PUT 被 409 拒绝的问题
- 先一次 Depth:0 PROPFIND 探测，缺失才逐级 MKCOL（已存在层 405 自动跳过）；会话级缓存确认结果，之后整页生命周期零额外请求

### 增强：同步账本平铺化且不随包漫游（configsync.ts）
- 旧版账本把整段内容快照嵌套存进一个 JSON 字符串（双重转义不可读且体积大），改为 `kisama_sync_state_hash` / `kisama_sync_state_at` 平铺双键，原文直存零转义
- 账本是"设备本地记忆"，加入打包排除清单不再随 extraStorage 漫游到他机，避免对方误判"本机没改动"而错误让渡设置域归属权；首次加载自动清理旧格式残留

### 重构：支撑模块拆分
- `lib/node-stable.ts`：节点稳定特征投影（剔除探针易变缓存字段），供内容哈希、节点 LWW 合并与导入去重共用
- `lib/runtime-inject.ts`：自定义样式/脚本运行时注入器从 App.vue 平移，设置保存、文件导入、云同步应用三处共用
- App.vue 中全量备份打包/应用逻辑平移至 configsync.ts 统一维护

# Kisama 更新记录(0.4.8)

## 2026-08-24

### 新增：FileViewer 多媒体预览组件（FileViewer.vue / FileManager.vue）
- 新增 `FileViewer.vue` 全屏暗色查看器：支持直接查看图片（`<img>` 自适应缩放）、播放视频（`<video controls>`）、播放音频（居中音频播放盒）
- 支持 Esc、点击空白、✕ 三种方式关闭；顶部工具栏按类型显示图标与文件名
- 文件管理器按扩展名自动分流预览：
  - 图片：png / jpg / jpeg / gif / webp / bmp / svg / ico / avif
  - 视频：mp4 / webm / mkv / mov / avi / m4v / ogv
  - 音频：mp3 / wav / ogg / flac / aac / m4a / opus
  - 其余扩展名仍走原文本内容预览
- 媒体文件复用 `client.downloadFile` 取回 Blob 后经 `URL.createObjectURL` 预览，上限 200MB；关闭查看器或切换文件时自动 `revokeObjectURL` 释放内存
- 表格行双击与 👁️ 按钮统一接入分流入口 `openPreview`

### 增强：文件内容预览器布局重构（FileManager.vue / DialogModal.vue）
- 弹窗标题动态化：移除「路径：」整行元素，文件名并入标题显示（如「agent.js 文件内容预览」），腾出的空间让给正文
- 移除「✏️ 可编辑文本文件」徽标行
- 根因修复文本框塌缩：`DialogModal` 的 `.large` 弹窗此前只有 `max-height: 85vh` 无确定高度，内部百分比/flex 高度链无法解析；现补上确定高度 `height: 85vh`
- 编辑文本框由固定 520px 改为弹性填充（`flex: 1; min-height: 0`），正常屏幕下显著加长，窗口变矮时自动收缩，任何视口高度都不会撑出父容器滚动条
- 只读 `<pre>` 预览同步弹性填充
- 顺带适配：新建文件弹窗文本框同样弹性填充；剪切/复制选目录弹窗的目录列表改为弹性填充，避免固定 350px 在全高弹窗下留大片空白

# Kisama 更新记录(0.4.7)

## 2026-08-23

### 增强：中转站点池空池限制与保存门禁优化（Setting.vue）
- 空池禁止开启中转：中转站点池为空时勾选「启动全局中转连接域名功能」可在保存时被拦截（toast 报错并自动跳转通用设置页），杜绝「开了中转却没有任何可用站点」的无效配置
- 勾选动作本身不做任何拦截：复选框始终可自由切换，仅在「已勾选且站点池为空」时显示非阻断提示文案；已开启状态下删光站点也能正常取消勾选关闭，不会死锁
- 打开设置弹窗时归一化历史脏数据：本地存储中「enabled=true 但站点池为空」的配置自动回退为关闭
- 测速探针不再阻挡其它页面保存：探针 `checking` 熔断门禁仅当用户停留在「通用设置」页时生效；停留在密钥/样式/脚本页点「保存生效」不受后台测速影响（此时健康池为空会平滑降级回全量池）

### 修复：同步按钮点击后 UI 反馈迟滞（useNodes.ts）
- 根因：单节点同步（`syncNodeBaseInfo`）与全部同步（`syncAllNodes`）都在 `await probeProxyPoolHealth()` 中转探测完成之后，才把节点状态改为 `syncing`
- 现象：中转探测耗时期间（NodeCard.vue / NodeTable.vue 的刷新按钮禁用与 SYNC 状态芯片均依赖 `node.status === 'syncing'`），点击后界面长时间无任何反馈，造成卡顿感
- 修复：把「标记 syncing」提前到中转探测之前
  - 单节点刷新：`loading` / `error` 置位与 `updateNode(id, { status: 'syncing' })` 移至探测 await 之前，点击立即变 SYNC
  - 全部同步：一次性把所有节点批量标记为 `syncing` 并落盘后再做中转探测，点击后所有卡片/表格立即进入 syncing 状态
- 中转探测逻辑本身不变（冷却期/single-flight 复用同一轮结果），仅不再阻塞 UI 首帧反馈

## 2026-08-22

### 新增：节点明文模式自动嗅探（agent-client.ts）
- 节点回应包携带 `x-encrypted: false` 时，视为该节点已关闭加密（连带关闭认证），客户端自动置位 `plaintextMode` 并对实例粘滞生效
- 明文模式下后续与该节点的全部通信彻底走明文：
  - 不再生成 ECDSA 签名认证头（跳过 `x-nonce` / `x-timestamp` / `x-auth-token` 包装）
  - 请求体不再 AES-GCM 加密，不携带 `x-aes-encrypted` 头
  - 响应不再尝试 ECIES 解密，Base64 密文特征盲嗅探同步禁用
- 首次请求 `/api/baseinfo` 的响应即可触发切换，覆盖全部 API 请求（safeFetch）与裸流分块上传（uploadFileRaw）两条链路
- 新增只读 getter `isPlaintextMode` 供外部查询当前节点是否处于明文模式

### 新增：节点域名支持 `#` 分隔的 x-target-host 反代语法（agent-client.ts）
- 域名支持 `xx.cc#aa.bb` 或 `https://xx.cc#aa.bb/prefix/path` 形式：请求发往 `xx.cc`，同时自动注入 `x-target-host` 头
- `#` 后内容按第一个 `/` 拆分：主机部分（如 `w.gbjs.de5.net`）写入 `x-target-host` 头；路径部分（如 `/agent_froxlor.php`）拼入 baseURL
- 示例：域名填 `https://fierce-lynx-flashing.cohesivity.app/#w.gbjs.de5.net/agent_froxlor.php` 时，
  实际请求为 `https://fierce-lynx-flashing.cohesivity.app/agent_froxlor.php/api/baseinfo`，并携带 `x-target-host: w.gbjs.de5.net`
  （等效于 `curl -H "X-Target-Host: w.gbjs.de5.net" https://.../agent_froxlor.php/api/baseinfo`，适配 php-froxlor 等 CDN/反代回源场景）
- 纯主机形式（`xx.cc#aa.bb`）与普通无 `#` 域名行为完全不变；所有基于 baseURL 拼接的接口（含分片上传、文件下载）自动生效
- 中转站自剔除比对使用归一化主机名，不受路径前缀影响

## 2026-08-21

### 增强：文件管理器支持 php-froxlor 探针的 POST 删除兼容（agent-client.ts / FileManager.vue）
- 新增 `deleteFilesPost(paths: string[])` 方法，使用 `POST /api/file/delete` 接口
- 请求体与响应体与 `DELETE /api/file` 完全一致（`{ paths: string[] }` → `{ status: string, results: any[] }`)
- 文件管理器自动检测版本包含 `php-froxlor`（如 `0.4.5-php-froxlor`）时，自动切换到 POST 删除方式
- 解决 php-froxlor 探针不支持 DELETE 方法的兼容性问题

### 增强：终端最小化悬浮窗位置与拖拽（Terminal2.vue）
- 最小化悬浮窗默认显示位置由屏幕右下角改为左下角（`right: 24px` → `left: 24px`）
- 新增鼠标拖拽：按住悬浮窗标题栏即可自由拖动位置，还原/关闭按钮不受影响
- 拖拽范围自动限制在视口内，不会拖出屏幕边缘
- 拖拽时光标显示为 grab/grabbing，并禁用文本选中与悬浮动画；组件卸载时清理监听

### 修复：终端滚动条在浅色主题下为黑色，与整体风格不协调（Terminal2.vue）
- 根因：xterm 的 `.xterm-viewport` 默认黑色滚动条/背景，且浏览器滚动条样式跟随系统深浅色偏好，与应用主题脱节
- 修复：全局覆盖滚动条配色（非 scoped 样式块）
  - 浅色主题：浅灰滑块 + 浅色轨道，并声明 `color-scheme: light` 强制亮色滚动条
  - 深色主题：显式声明 `#30363d` 滑块 + `#0d1117` 轨道，避免系统亮色模式下突兀
  - 同时覆盖 WebKit（`::-webkit-scrollbar`）与 Firefox（`scrollbar-color`）两种渲染

# Kisama 更新记录(0.4.6)

## 2026-08-20

### 修复：WebAssembly 加载失败（expected magic word，收到 HTML 而非 wasm）
- 现象：终端页面报 `WebAssembly.instantiate(): expected magic word 00 61 73 6d, found 3c 68 74 6d`（`3c 68 74 6d` = `<htm`，即请求返回的是 HTML 页面而非 wasm 二进制）
- 原因：`lib/noise.ts` 通过 `Module.locateFile` 把 wasm 路径硬编码为绝对地址 `/noise-c.wasm`，部署在子路径或服务器对 `.wasm` 请求返回 404/SPA 回退页时，Emscripten 胶水代码拿到 HTML 字节去 `WebAssembly.instantiate()` 即报错
- 修复：
  - `vite.config.ts` 新增 `inlineWasmPlugin`：构建 / dev 双环境都把 wasm 内联为 base64 data URL 打进模块，运行时完全不发请求
  - `lib/noise.ts` 把解码后的字节以 `createNoise({ wasmBinary })` 第一个参数形式传入（Emscripten 胶水代码读取的是工厂参数对象上的 `wasmBinary`，`window.Module` 在模块路径下不生效——此前误设 `window.Module` 导致仍走网络 fetch 拿到 HTML），故彻底不再发请求
  - 加载逻辑双保险：URL 为 `data:` 时直接 `atob` 解码（零网络请求），否则 `fetch` 后取字节，并校验响应状态
- `public/noise-c.wasm` 已删除（不再被引用）

## 2026-08-19

### 新增：暗色模式（全组件适配）
- App.vue 定义主题 CSS 变量体系（`--bg` / `--card` / `--text` / `--surface-*` / `--chip-*` / `--hover-tint-*` 等），`html[data-theme="dark"]` 切换暗色变量，默认跟随系统 `prefers-color-scheme`，偏好持久化于 localStorage（`kisama_theme`）
- 顶部导航新增 🌙/☀️ 一键切换按钮
- 暗色适配组件：NodeCard / NodeTable / NodeList / NodePreview / NodeForm / DialogModal / Setting / AiPrompt / ArgoTunnel / TaskManager / Terminal2 / FileManager / UpdateModal / AgentDownload（含大量内联样式变量化与 `:root[data-theme='dark']` 兜底规则）
- Terminal2 超级终端独立主题开关，初始值跟随应用主题（localStorage `kisama_terminal_theme`）

### 新增：主页搜索框
- NodeFilterSort.vue 增加按名称/IP 实时过滤，关键词持久化于 localStorage（`agent_search_query`），支持「仅在线」过滤与排序切换

### 新增：加载骨架屏与空状态引导
- NodeList.vue 数据加载中显示骨架屏（闪烁动画），空列表显示三步引导（下载探针 → 添加节点 → 全部同步），搜索无结果显示提示

### 增强：节点卡片质感
- 卡片悬停抬升 + 主题色描边，状态灯呼吸动画，状态芯片全面变量化

### 修复：命令代码块在浅色/暗色下文字不可见
- 根因：`style.css`（Vite 遗留模板全局样式）强制所有 `<code>` 元素 `color: var(--text-h)` + `background: var(--code-bg)`，新增的 `--code-bg` 变量与其冲突导致黑字黑底/白字白底
- 修复：移除全局 `code` 颜色/背景规则，新增 `--code-bg` 变量（浅色 `#1e293b`，暗色 `#0b1120` 与卡片拉开对比），`.command-text` 显式 `color: #f8fafc`

### 调整：布局与表格列宽
- 主页容器 `.app` 最大宽度 1280px → 1440px，所有组件整体加宽
- FileManager 表格列宽权重对齐 0.4.4：仅复选框列固定 30px；名称列扩为 45%，大小/权限各 70px，操作列保持自然宽度

## 2026-08-17

### 修复：分片上传过程中切换目录导致文件落错位置
- 文件管理器（FileManager.vue）上传大文件分片时，目标路径在每块分片发送时动态读取 `currentPath.value`
- 上传过程中 UI 仍可操作，若期间切换目录，后续分片会跟随新目录上传，最终文件落错位置
- 修复：上传开始时快照 `uploadTargetPath = currentPath.value`，小文件直传与分片循环全部改用快照路径，切换目录不再影响上传落点

## 2026-08-16

### 新增：无痕模式
- 节点表单（NodeForm.vue）高级设置中新增「无痕模式」开关，**默认开启**
- 开启时与原有行为一致：全能终端连接后自动注入预命令，防止历史命令写入磁盘
- 关闭后不再注入预命令（Linux 下不执行 `export HISTFILE=/dev/null`）
- `AgentNode` / `NodeFormData` / `addNode` 链路同步支持该字段，编辑旧节点时自动回退默认开启

### 增强：无痕预命令兼容 Windows
- 终端预命令根据节点系统自动分流（通过 `baseinfo.os` 判断）：
  - Unix：保持 `export HISTFILE=/dev/null` + ANSI 擦除注入行
  - Windows (PowerShell)：`Set-PSReadLineOption -HistorySaveStyle SaveNothing` 禁止历史落盘 + `Clear-Host` 清屏，避免 ANSI 擦除在命令行换行时失效

### 修复：文件管理器文件名过长撑爆列表
- 文件管理器（FileManager.vue）表格启用 `table-layout: fixed` 固定列宽布局
- 名称列超长文本自动截断显示省略号（`ellipsis`），悬停可查看完整文件名（`title` 提示）
- 大小 / 权限 / 操作列固定宽度，不再随文件名无限拉伸

### 修复：中转站与被访问节点同域名时走入死循环
- 自己不能中转自己：中转候选池中剔除与被访问节点自身域名相同的中转站（协议 / 路径归一化后比对主机名）
- 即使全局设置勾选了「中转全部站点（含 HTTPS）」：候选池剔完只剩自己时不再选中，**找不到其它中转站则降级直连**
- 覆盖三处中转选取点：
  - 普通 API 请求（`lib/agent-client.ts` safeFetch，抽出统一 `pickProxyTunnel()` 调度）
  - 裸流分块上传（`lib/agent-client.ts` uploadFileRaw）
  - 全能终端 WebSocket 连接（`App.vue` getTerminalWsUrl，且增加空代理守卫，避免拼出非法地址）