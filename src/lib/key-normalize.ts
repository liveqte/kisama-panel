// src/lib/key-normalize.ts
/**
 * 密钥粘贴/复制净化工具
 * 浏览器复制多行文本时常带入多余空行、行尾空格或 \r\n，会破坏密钥格式。
 * 在展示层提供“干净复制”，在提交/保存层对所有密钥输入做归一化。
 */

// PEM (ECDSA/公钥等)：统一换行为 \n，清空空行与行尾空白，首尾去空
export const sanitizePem = (raw: string | null | undefined): string => {
  if (!raw) return '';
  return raw
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .filter((line) => line.trim().length > 0)
    .join('\n')
    .trim();
};

/**
 * 按密钥类型清洗：
 * - 'ecies'：64 位 hex，允许粘贴时混入换行/空格，一律剔除
 * - 'ecdsa'（及一切 PEM）：仅保留关键内容行与规范化换行
 */
export const sanitizeKeyInput = (
  raw: string | null | undefined,
  type: 'ecdsa' | 'ecies'
): string => {
  if (!raw) return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (type === 'ecies') return trimmed.replace(/\s+/g, '');
  return sanitizePem(trimmed);
};