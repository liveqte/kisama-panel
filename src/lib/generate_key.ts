// src/lib/generate_key.ts
import { secp256k1 } from '@noble/curves/secp256k1';
import { p256 } from '@noble/curves/nist.js';

export interface ProxyKeys {
  controlEcdsaPrivate: string;
  agentEcdsaPublic: string;
  controlEciesPrivate: string;
  agentEciesPublic: string;
}

// 辅助函数：字节数组 → PEM 字符串（与原 exportToPem 输出格式完全一致）
function bytesToPem(bytes: Uint8Array, label: string): string {
  const b64 = btoa(String.fromCharCode(...bytes));
  const pem = b64.match(/.{1,64}/g)?.join('\n') || b64;
  return `-----BEGIN ${label}-----\n${pem}\n-----END ${label}-----`;
}

// 辅助函数：P-256 公钥 → SPKI PEM（与 window.crypto.subtle.exportKey('spki') 完全一致）
function publicKeyToSpkiPem(pubUncompressed: Uint8Array): string {
  // pubUncompressed 必须是 65 字节（0x04 + x + y）
  const spkiDer = new Uint8Array([
    0x30, 0x59,                               // SEQUENCE
    0x30, 0x13,                               // algorithm SEQUENCE
    0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, // ecPublicKey OID
    0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, // prime256v1 OID
    0x03, 0x42, 0x00,                         // BIT STRING (uncompressed public key)
    ...pubUncompressed,
  ]);
  return bytesToPem(spkiDer, 'PUBLIC KEY');
}

// 辅助函数：P-256 私钥 + 公钥 → PKCS#8 PEM（与 window.crypto.subtle.exportKey('pkcs8') 完全一致）
function privateKeyToPkcs8Pem(privBytes: Uint8Array, pubUncompressed: Uint8Array): string {
  // inner ECPrivateKey（包含 publicKey，与 Web Crypto 导出完全一致）
  const bitString = new Uint8Array([0x03, 0x42, 0x00, ...pubUncompressed]);
  const innerContent = new Uint8Array([
    0x02, 0x01, 0x01,                       // version 1
    0x04, 0x20, ...privBytes,               // private key
    0xa0, 0x44, ...bitString,               // [0] BIT STRING publicKey
  ]);
  const innerDer = new Uint8Array([0x30, 0x6b, ...innerContent]);

  // PKCS#8 外层
  const pkcs8Content = new Uint8Array([
    0x02, 0x01, 0x00,                       // version 0
    0x30, 0x13,                             // algorithm
    0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01,
    0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07,
    0x04, 0x6d, ...innerDer,                // privateKey OCTET STRING
  ]);

  const pkcs8Der = new Uint8Array([0x30, 0x81, 0x85, ...pkcs8Content]);
  return bytesToPem(pkcs8Der, 'PRIVATE KEY');
}

export async function generateProxyKeys(): Promise<ProxyKeys> {
  // 1. 生成 ECDSA (P-256) - 使用 @noble/curves（纯 JS，无 subtle）
  const privBytes = p256.utils.randomPrivateKey();
  const pubUncompressed = p256.getPublicKey(privBytes, false); // uncompressed (65 bytes)

  const ecdsaPrivatePem = privateKeyToPkcs8Pem(privBytes, pubUncompressed);
  const ecdsaPublicPem = publicKeyToSpkiPem(pubUncompressed);

  // 2. 生成 ECIES (secp256k1) - 使用 @noble/curves
  const eciesPrivBytes = secp256k1.utils.randomPrivateKey();
  const eciesPubBytes = secp256k1.getPublicKey(eciesPrivBytes, true); // compressed

  return {
    controlEcdsaPrivate: ecdsaPrivatePem,
    agentEcdsaPublic: ecdsaPublicPem,
    controlEciesPrivate: Array.from(eciesPrivBytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(''),
    agentEciesPublic: btoa(String.fromCharCode(...eciesPubBytes)),
  };
}

// ============================================================================
// ✨ 新增扩展方法：手动填入私钥时全自动反向衍生公钥内核
// ============================================================================

/**
 * 💡 从填入的 ECDSA (P-256) PKCS#8 私钥 PEM 中，安全换算出标准 SPKI 公钥 PEM
 */
export async function deriveEcdsaPublicKey(privateKeyPem: string): Promise<string> {
  // 1. 剥离 PEM 头部外壳，提取纯 Base64 文本
  const b64 = privateKeyPem
    .replace(/-----\s*BEGIN[^-]*-----\s*/, '')
    .replace(/-----\s*END[^-]*-----\s*/, '')
    .replace(/\s/g, '');
  
  const binaryStr = atob(b64);
  const derBytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    derBytes[i] = binaryStr.charCodeAt(i);
  }

  // 2. 扫描标准 ASN.1 特征锚点序列：Version=1 (0x02 0x01 0x01) 紧跟 PrivateKey OctetString 头 (0x04 0x20)
  // 这是标准标量椭圆曲线私钥在 PKCS#8 / SEC1 嵌套中的通用足迹
  let privBytes: Uint8Array | null = null;
  for (let i = 0; i < derBytes.length - 37; i++) {
    if (
      derBytes[i] === 0x02 && 
      derBytes[i+1] === 0x01 && 
      derBytes[i+2] === 0x01 && 
      derBytes[i+3] === 0x04 && 
      derBytes[i+4] === 0x20
    ) {
      privBytes = derBytes.slice(i + 5, i + 5 + 32);
      break;
    }
  }

  if (!privBytes) {
    throw new Error('未能提取到合规的 32 字节 P-256 标量私钥特征块');
  }

  // 3. 换算未压缩公钥 (65字节) 并重新包装为标准 SPKI 公钥 PEM
  const pubUncompressed = p256.getPublicKey(privBytes, false);
  return publicKeyToSpkiPem(pubUncompressed);
}

/**
 * 💡 从填入的 32 字节 ECIES (secp256k1) Hex 字符串中，安全换算出压缩格式的公钥 Base64
 */
export async function deriveEciesPublicKey(privateKeyHex: string): Promise<string> {
  const cleanHex = privateKeyHex.trim();
  if (cleanHex.length !== 64) {
    throw new Error('ECIES 私钥长度有误，必须为 64 个十六进制字符（32 字节）');
  }

  // 1. 十六进制转换为字节数组
  const privBytes = new Uint8Array(
    cleanHex.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16))
  );

  // 2. 计算压缩格式公钥字节（33字节）并转换为前端识别的 Base64 编码
  const eciesPubBytes = secp256k1.getPublicKey(privBytes, true);
  return btoa(String.fromCharCode(...eciesPubBytes));
}