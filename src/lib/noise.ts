// src/lib/noise.ts

import createNoise from 'noise-c.wasm';
import wasmUrl from '../assets/noise-c.wasm?inline-b64';

// ============ 工具函数 ============
const loadWasmBytes = async (): Promise<Uint8Array> => {
  if (wasmUrl.startsWith('data:')) {
    const base64 = wasmUrl.slice(wasmUrl.indexOf(',') + 1);
    const binaryString = window.atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  }
  const res = await fetch(wasmUrl);
  if (!res.ok) throw new Error(`[Noise] WASM 资源请求失败: HTTP ${res.status} ${wasmUrl}`);
  return new Uint8Array(await res.arrayBuffer());
};
const base64ToUint8Array = (base64: string): Uint8Array => {
  try {
    const cleanBase64 = base64.replace(/\s+/g, '');
    const binaryString = window.atob(cleanBase64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  } catch (err) {
    throw new Error(`Base64 解码失败，请检查密钥格式: ${err}`);
  }
};

// ============ 单例加载 WASM 模块 ============
let noiseLibCache: any = null;
const initNoiseLib = (): Promise<any> => {
    return new Promise((resolve, reject) => {
      if (noiseLibCache) {
        return resolve(noiseLibCache);
      }
      
      try {
        loadWasmBytes().then((wasmBytes) => {
          createNoise({ wasmBinary: wasmBytes }, (instance: any) => {
            noiseLibCache = instance;
            resolve(instance);
          });
        }).catch(reject);
        
      } catch (err) {
        console.error('[Noise] WASM 模块加载彻底失败:', err);
        reject(err);
      }
    });
  };

// ============ Noise 加密封装类 ============
export class Noise {
  private hs: any = null;
  private sendCipher: any = null;
  private recvCipher: any = null;
  private isInitiator: boolean;
  private noiseLib: any;

  public isEstablished: boolean = false;

  private constructor(isInitiator: boolean) {
    this.isInitiator = isInitiator;
  }

  public static async create(
    isInitiator: boolean,
    localPrivB64: string,
    expectedRemotePubB64?: string
  ): Promise<Noise> {
    const lib = await initNoiseLib();
    const instance = new Noise(isInitiator);
    instance.noiseLib = lib;

    const role = isInitiator 
        ? lib.constants.NOISE_ROLE_INITIATOR 
        : lib.constants.NOISE_ROLE_RESPONDER;

    instance.hs = lib.HandshakeState("Noise_XX_25519_ChaChaPoly_BLAKE2s", role);

    let s = undefined;
    if (localPrivB64) {
      s = base64ToUint8Array(localPrivB64);
      if (s.length !== 32) throw new Error(`[Noise] 本地私钥长度错误！`);
    }

    const prologue = new TextEncoder().encode("kisama_terminal_v1");

    // agent 0.4.8 起服务端强制校验发起方静态公钥，并要求预置对端（agent）静态公钥作为 rs
    // （对齐 tools/control.py 的 _noise_initiator 参考实现）。旧版 agent 不校验，预置 rs 无害兼容。
    let rs: Uint8Array | undefined = undefined;
    if (expectedRemotePubB64) {
      rs = base64ToUint8Array(expectedRemotePubB64);
      if (rs.length !== 32) throw new Error(`[Noise] 对端公钥长度错误！`);
    }

    try {
      instance.hs.Initialize(prologue, s, undefined, rs);
    } catch (initErr) {
      if (rs) {
        // 极旧版 noise-c.wasm 不支持 4 参 Initialize（无法预置 rs）：降级为仅预置本地静态私钥。
        // XX 握手仍会在 msg2 交换对端公钥，功能不受影响，仅失去对端公钥前置校验。
        console.warn('[Noise] 当前 WASM 库不支持预置对端公钥 (rs)，降级为两参 Initialize:', initErr);
        instance.hs.Initialize(prologue, s);
      } else {
        throw initErr;
      }
    }

    return instance;
  }

  public processHandshake(payload: Uint8Array): Uint8Array {
    if (this.isEstablished) return new Uint8Array(0);

    const constants = this.noiseLib.constants;
    let action = this.hs.GetAction();
    let response = new Uint8Array(0);

    if (payload.length > 0 && action === constants.NOISE_ACTION_READ_MESSAGE) {
      try {
        this.hs.ReadMessage(payload);
      } catch (e) {
        throw new Error(`[ReadMessage 失败] ${e}`);
      }
      action = this.hs.GetAction();
    }

    if (action === constants.NOISE_ACTION_WRITE_MESSAGE) {
      try {
        response = this.hs.WriteMessage(new Uint8Array(0));
      } catch (e) {
        throw new Error(`[WriteMessage 失败] ${e}`);
      }
      action = this.hs.GetAction();
    }

    if (action === constants.NOISE_ACTION_SPLIT) {
      let ciphers;
      
      // 1. 执行真实的底层 Split
      try {
        ciphers = this.hs.Split();
      } catch (e) {
        throw new Error(`[底层 Split 函数崩溃] ${e}`);
      }

      // 2. 赋值管道
      try {
        if (this.isInitiator) {
          this.sendCipher = ciphers[0];
          this.recvCipher = ciphers[1];
        } else {
          this.sendCipher = ciphers[1];
          this.recvCipher = ciphers[0];
        }
        this.isEstablished = true;
      } catch (e) {
        throw new Error(`[管道提取失败] ${e}`);
      }

      // 3. 🔥 终极修复：安全地释放内存。
      // 捕获所有由于底层库自动 free() 而导致我们二次 free() 时引发的 INVALID_PARAM。
      try {
        if (this.hs && typeof this.hs.free === 'function') {
          this.hs.free();
        }
      } catch (e) {
        console.warn("[Noise] 内存清理完成 (自动吞并重复释放警告)");
      }
      this.hs = null;
    }

    return response;
  }

  public encrypt(plaintext: Uint8Array): Uint8Array {
    if (!this.isEstablished || !this.sendCipher) throw new Error("握手未完成，无法加密");
    return this.sendCipher.EncryptWithAd(new Uint8Array(0), plaintext);
  }

  public decrypt(ciphertext: Uint8Array): Uint8Array {
    if (!this.isEstablished || !this.recvCipher) throw new Error("握手未完成，无法解密");
    return this.recvCipher.DecryptWithAd(new Uint8Array(0), ciphertext);
  }
  // ============ 内存清理 ============
  public destroy() {
    // 释放发送管道
    if (this.sendCipher && typeof this.sendCipher.free === 'function') {
      try {
        this.sendCipher.free();
      } catch (e) {
        console.warn("[Noise] 释放 sendCipher 失败:", e);
      }
      this.sendCipher = null;
    }

    // 释放接收管道
    if (this.recvCipher && typeof this.recvCipher.free === 'function') {
      try {
        this.recvCipher.free();
      } catch (e) {
        console.warn("[Noise] 释放 recvCipher 失败:", e);
      }
      this.recvCipher = null;
    }

    // 释放可能未完成握手的 HandshakeState
    if (this.hs && typeof this.hs.free === 'function') {
      try {
        this.hs.free();
      } catch (e) {
        // 忽略
      }
      this.hs = null;
    }

    this.isEstablished = false;
  }
}