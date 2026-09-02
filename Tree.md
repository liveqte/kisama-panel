# Kisama src 目录结构说明

> 标记图例：🧩 组件 · 🏪 状态仓库 · 🔧 工具库 · 🚀 引擎/守护 · 📐 类型声明 · 🖼️ 静态资源

```
src/
├── main.ts                          # 🚀 应用入口：创建 Vue 实例，挂载 App 与全局样式
├── App.vue                          # 🧩 主页面壳：Header（在线徽章/主题切换/登录/设置/探针下载/导入导出）、
│                                    #    节点列表挂载、全部功能弹窗的调度中枢、自定义样式/脚本热应用、登录态按钮三态展示
├── style.css                        # 🧩 全局基础样式（Vite 模板遗留，code 强制配色规则已移除）
│
├── assets/
│   ├── hero.png                     # 🖼️ 页面主视觉图
│   ├── noise-c.wasm                 # 🖼️ Noise 协议 WASM 二进制（构建时被插件内联为 base64，运行时零网络请求）
│   ├── vite.svg / vue.svg           # 🖼️ 模板图标（遗留）
│
├── components/
│   ├── AgentDownload.vue            # 🧩 探针下载中心：按语言轨道生成含公钥的部署配置包
│   ├── AiPrompt.vue                 # 🧩 AI 助手弹窗：面向单个节点的智能命令生成与执行
│   ├── ArgoTunnel.vue               # 🧩 Argo 临时隧道管理：节点内网端口映射为 trycloudflare 公网域名
│   ├── DialogModal.vue              # 🧩 通用对话框：标题/内容插槽/确认取消按钮的标准弹窗外壳
│   ├── FileManager.vue              # 🧩 节点文件管理器：浏览/上传（分块）/下载/删除/剪切复制/新建目录
│   ├── FileViewer.vue               # 🧩 多媒体全屏预览：图片缩放、视频音频播放（按扩展名自动分流）
│   ├── NodeCard.vue                 # 🧩 节点卡片视图：单节点状态/操作入口（终端/文件/任务/AI/隧道/升级）
│   ├── NodeFilterSort.vue           # 🧩 筛选栏：搜索、在线筛选、卡片/表格切换、排序、保留IP信息、🔃全部同步小按钮
│   ├── NodeForm.vue                 # 🧩 添加/编辑节点表单：域名、双密钥、无痕模式等高级项
│   ├── NodeList.vue                 # 🧩 节点列表容器：卡片/表格分发、加载骨架屏、空状态三步引导
│   ├── NodePreview.vue              # 🧩 节点悬浮预览卡：悬停卡片时展示详细信息
│   ├── NodeTable.vue                # 🧩 节点表格视图：紧凑列布局的全量节点操作表
│   ├── Setting.vue                  # 🧩 全局设置弹窗四 Tab：🔐密钥 / ⚙️通用(中转池+看板发布) / 🎨样式美化 / ⚡脚本注入
│   ├── TaskManager.vue              # 🧩 节点任务管理：启动(onetime)与定时(cron)任务的查看/编辑/日志
│   ├── Terminal.vue                 # 🧩 基础终端：轻量命令行会话窗口
│   ├── Terminal2.vue                # 🧩 全能终端：WebSocket 直连，支持最小化悬浮窗拖拽、主题独立切换
│   ├── UpdateModal.vue              # 🧩 代理端热升级确认弹窗：选择轨道与目标文件后触发执行器
│   └── WebDavLogin.vue              # 🧩 WebDAV 登录/云同步账号弹窗：连接参数、测试连接(结果复用)、
│                                    #    高级设置(CORS 中转域名联动设置页中转池)、退出登录
│
├── composables/
│   ├── useNodes.ts                  # 🏪 节点核心仓库：增删改查、localStorage 持久化、单/全部同步、
│   │                                #    导入导出(id 去重防抖)、全局密钥、筛选排序视图状态、看板资产自动推送
│   ├── usePreview.ts                # 🏪 悬浮预览开关状态：「显示预览/预览常驻」偏好持久化
│   └── useToast.ts                  # 🏪 全局胶囊通知中心：success/error/info 三型 toast 队列
│
├── lib/
│   ├── agent-client.ts              # 🔧 Agent 客户端 SDK：ECDSA P-256 签名认证 + AES-GCM 请求加密 + ECIES 响应解密、
│   │                                #    明文模式自动嗅探、`#` 反代语法(x-target-host)、智能中转调度(反自中转)、
│   │                                #    裸流分块上传、临时密钥授权、Argo 隧道接口、看板静态上报
│   ├── check_iptype.ts              # 🔧 IP 情报一体化探测：国旗码 + 归属类型(hosting/isp/business)共用单次请求
│   ├── configsync.ts                # 🚀 配置云同步引擎：三局面自动路由(推送/拉取/分域合并)、
│   │                                #    RFC7386 式分域合并策略(节点id并集LWW + 设置域整域择主)、
│   │                                #    同步账本、backup 留档与损坏自愈、全量备份包 v1.1 打包/应用（详见文件头注解）
│   ├── country.ts                   # 🔧 国家名 → ISO 两位码映射表（配合国旗渲染）
│   ├── generate_key.ts              # 🔧 密钥工厂：ECDSA(P-256)/ECIES(secp256k1) 密钥对生成与公钥反向衍生
│   ├── key-normalize.ts             # 🔧 密钥粘贴净化：剔除多余空行/行尾空格/\r\n，展示层干净复制
│   ├── node-stable.ts               # 🔧 节点稳定特征投影：仅保留用户配置字段（剔除探针缓存），
│   │                                #    供云同步哈希/LWW 合并与导入去重共用
│   ├── noise.ts                     # 🔧 Noise 协议加密封装：WASM 内联字节加载（data: 直解 / fetch 双保险）
│   ├── proxy-health.ts              # 🔧 中转站点池健康嗅探：single-flight + 冷却期，多调用方并发只探一轮
│   ├── runtime-inject.ts            # 🔧 运行时注入器：自定义 CSS / HTML+JS 挂件注入与重挂载清理
│   ├── task-daemon.ts               # 🚀 后台守护进程三任务：
│   │                                #    ① 节点脚本任务维护(5min, 失败指数退却)
│   │                                #    ② 节点基础信息同步(10min)
│   │                                #    ③ 配置云同步(10min, 错峰启动, 静默幂等)
│   ├── update.ts                    # 🚀 代理端热升级引擎：GitHub Release 版本审计、多语言轨道源码拉取与特征织入、
│   │                                #    双通道(Base64/裸流)自适应分块上传
│   ├── validatePemKey.ts            # 🔧 私钥格式校验：ECDSA(PEM) / ECIES(Hex)
│   ├── version.ts                   # 🔧 语义版本比较工具：兼容 "0.4.3-js" 等带后缀格式，GO 版识别
│   ├── webdav-status.ts             # 🏪 云端链路健康状态：unknown/ok/error 全局响应式，
│   │                                #    由 configsync 每轮上报，驱动首页「已登录」按钮三态
│   └── webdav.ts                    # 🔧 WebDAV 客户端库：PROPFIND/GET/PUT/MKCOL/DELETE/MOVE/COPY 全套交互、
│                                    #    新旧对比决策(compareWithRemote/syncFile)、时钟偏移校准、
│                                    #    登录配置存取(kisama_webdav_config)、CORS 中转包裹(/kisamaproxy/)
│
└── types/
    ├── index.ts                     # 📐 业务类型：AgentNode、NodeFormData、任务日志(Onetime/Cron) 等
    ├── noise-c.wasm.d.ts            # 📐 noise-c.wasm 模块类型声明
    └── wasm-inline.d.ts             # 📐 `?inline-b64` 内联导入声明（vite 自定义插件配套）
```

## 关键 localStorage 键速查

| 键 | 归属 | 说明 |
|---|---|---|
| `agent_nodes_config` | useNodes | 节点名单（含探针缓存字段） |
| `agent_global_config` | useNodes | 全局默认密钥对 |
| `agent_filter_status` / `agent_sort_*` / `agent_view_mode` / `agent_search_query` | useNodes | 列表筛选/排序/视图/搜索偏好 |
| `agent_keep_ip_info` / `agent_keep_ip_type` | useNodes | IP 归属信息保留开关 |
| `kisama_theme` / `kisama_terminal_theme` | App / Terminal2 | 应用主题 / 终端主题 |
| `kisama_proxy_config` | Setting | 中转站点池（domains / healthyDomains / enabled / allSites） |
| `kisama_status_page_config` | Setting | 看板发布地址与令牌 |
| `kisama_custom_style` / `kisama_custom_script` | Setting | 注入的美化样式与脚本 |
| `kisama_webdav_config` | WebDavLogin | WebDAV 连接参数（不随云同步上云） |
| `kisama_sync_state_hash` / `_at` | configsync | 本地同步账本（设备私有，不入备份包） |
| `node_preview_visible` / `node_preview_persistent` | usePreview | 悬浮预览偏好 |
