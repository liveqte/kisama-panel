/**
 * 校验私钥是否合法
 * @param key 私钥字符串 (PEM 格式 或 Hex 格式)
 * @param type 密钥类型：'ecdsa' (PEM) 或 'ecies' (Hex)
 * @returns { valid: boolean, error?: string }
 */
export function validatePemKey(
  key: string, 
  type: 'ecdsa' | 'ecies'
): { valid: boolean; error?: string } {
  
  const trimmed = key?.trim();
  
  // ✅ 允许为空（可选字段场景）
  if (!trimmed) return { valid: true };

  // ─────────────────────────────────────
  // 🔹 ECIES 类型：校验 64 位 Hex 字符串
  // ─────────────────────────────────────
  if (type === 'ecies') {
    // 移除可选的 0x/0X 前缀
    const cleanHex = trimmed.replace(/^0x/i, '');
    
    // 1. 长度校验：必须为 64 字符 (32 字节)
    if (cleanHex.length !== 64) {
      return { 
        valid: false, 
        error: `ECIES 私钥必须为 64 位十六进制字符串 (32 字节)，当前长度: ${cleanHex.length}` 
      };
    }
    
    // 2. 字符合法性校验：仅允许 0-9, a-f, A-F
    if (!/^[0-9a-fA-F]{64}$/.test(cleanHex)) {
      return { 
        valid: false, 
        error: 'ECIES 私钥包含非法字符，仅允许十六进制字符 (0-9, a-f, A-F)' 
      };
    }
    
    // 3. (可选) 校验不能为全 0 或超出曲线阶值
    // secp256k1 阶值: 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
    const upperHex = cleanHex.toUpperCase();
    if (upperHex === '0000000000000000000000000000000000000000000000000000000000000000') {
      return { valid: false, error: '私钥不能为全 0' };
    }
    if (upperHex > 'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141') {
      return { valid: false, error: '私钥超出 secp256k1 曲线有效范围' };
    }
    
    return { valid: true };
  }

  // ─────────────────────────────────────
  // 🔹 ECDSA 类型：校验 PKCS#8 PEM 格式
  // ─────────────────────────────────────
  if (type === 'ecdsa') {
    const header = '-----BEGIN PRIVATE KEY-----';
    const footer = '-----END PRIVATE KEY-----';
  
    if (!trimmed.includes(header)) {
      return { 
        valid: false, 
        error: `私钥必须以 "${header}" 开头（仅支持 PKCS#8 格式）` 
      };
    }
  
    if (!trimmed.includes(footer)) {
      return { valid: false, error: `缺少闭合标签 "${footer}"` };
    }
  
    // 提取 Base64 内容
    const content = trimmed
      .replace(new RegExp(header, 'g'), '')
      .replace(new RegExp(footer, 'g'), '')
      .replace(/\s/g, '');
  
    if (!content) {
      return { valid: false, error: '私钥内容为空' };
    }
  
    // 检查 Base64 字符合法性
    if (!/^[A-Za-z0-9+/=]+$/.test(content)) {
      return { valid: false, error: '私钥包含非法字符，仅允许 Base64 字符' };
    }
  
    return { valid: true };
  }

  // 未知类型
  return { valid: false, error: `不支持的密钥类型: ${type}` };
}