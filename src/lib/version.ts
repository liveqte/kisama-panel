// src/lib/version.ts
/**
 * 版本号比较工具（兼容 "0.4.3-js" / "0.0.6-python" 等带后缀的版本格式）
 */

// 判定 v1 >= v2，版本号格式如 "0.4.3" 或 "0.4.3-js"
export const isVersionAtLeast = (v1?: string | null, v2: string = ''): boolean => {
  if (!v1 || !v2) return false;
  const parse = (v: string): number[] => {
    return v.split('-')[0].split('.').map(n => parseInt(n, 10) || 0);
  };
  const a = parse(v1);
  const b = parse(v2);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return true;
};

// 判定 v1 > v2（严格大于），版本号格式如 "0.4.3" 或 "0.4.3-js"
export const isVersionGreater = (v1?: string | null, v2: string = ''): boolean => {
  if (!v1 || !v2) return false;
  const parse = (v: string): number[] => {
    return v.split('-')[0].split('.').map(n => parseInt(n, 10) || 0);
  };
  const a = parse(v1);
  const b = parse(v2);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
};

// 判定是否为 GO 版本（版本后缀如 "0.4.6-go"），GO 版未实现 /api/argo 路由
export const isGoVersion = (v1?: string | null): boolean => {
  if (!v1) return false;
  const lower = v1.toLowerCase();
  const suffix = lower.includes('-') ? lower.split('-').slice(1).join('-') : lower;
  return suffix.includes('go') || suffix.includes('g0');
};