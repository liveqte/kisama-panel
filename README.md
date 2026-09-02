# Kisama Panel

基于 Vue 3 + TypeScript + Vite 的代理管理面板，用于管理已部署的 Kisama Agent，提供节点管理、文件管理、终端、WebDAV 接入等能力。

## 环境要求

- [Node.js](https://nodejs.org/) 18 或更高版本（推荐使用 LTS 版本）
- [npm](https://www.npmjs.com/)（随 Node.js 一起安装）

## 安装依赖

```bash
npm install
```

## 本地开发

启动开发服务器（端口 9002，见 `vite.config.ts`）：

```bash
npm run dev
```

## 构建

生成生产环境静态文件到 `dist` 目录：

```bash
npm run build
```

构建产物可以直接部署到任意静态文件服务器（Nginx、Caddy、GitHub Pages 等）。

## 本地预览构建产物

```bash
npm run preview
```

## 项目结构

```
kisama-panel/
├── public/          # 静态资源
├── src/
│   ├── assets/      # 图片、wasm 等资源
│   ├── components/  # Vue 组件
│   ├── composables/ # 组合式函数
│   ├── lib/         # 核心逻辑库
│   └── types/       # TypeScript 类型定义
├── index.html       # 入口 HTML
├── package.json
└── vite.config.ts   # Vite 配置
```