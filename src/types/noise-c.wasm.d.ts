// noise-c.wasm 模块类型声明（独立 .d.ts，避免被当作模块增强）
declare module 'noise-c.wasm' {
  function createNoise(options: Record<string, any>, callback: (instance: any) => void): void;
  function createNoise(callback: (instance: any) => void): void;
  export default createNoise;
}
