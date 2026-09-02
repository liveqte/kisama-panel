import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import { nodePolyfills } from 'vite-plugin-node-polyfills'   // ← 新增
import { readFileSync } from 'node:fs'

// 把 .wasm?inline-b64 导入替换为 base64 data URL（dev / build 均生效，避免运行时 fetch）
const inlineWasmPlugin = (): Plugin => ({
  name: 'inline-wasm-base64',
  enforce: 'pre',
  async resolveId(id, importer) {
    if (!id.endsWith('?inline-b64')) return;
    const cleaned = id.replace(/\?inline-b64$/, '');
    const resolved = await this.resolve(cleaned, importer);
    if (!resolved) return;
    return '\0inline-wasm:' + resolved.id;
  },
  load(id) {
    if (!id.startsWith('\0inline-wasm:')) return;
    const file = id.slice('\0inline-wasm:'.length);
    const base64 = readFileSync(file, 'base64');
    return `export default "data:application/wasm;base64,${base64}"`;
  }
})

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    inlineWasmPlugin(),
    vue(),
    nodePolyfills({          // ← 新增这一段
      globals: {
        Buffer: true,        // 专门修复 buffer
        global: true,
        process: true,
      },
      protocolImports: true,
    })
  ],
  
  // 你之前的端口配置可以保留
  server: {
    port: 9002,
    host: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
    minify: 'esbuild',
    rollupOptions: {
      // 此处可配置外部依赖、输出格式等
    }
  },
  optimizeDeps: {
    include: ['@noble/curves']
  }
});