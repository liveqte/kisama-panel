// src/lib/check_iptype.ts
// 🌍 IP 情报一体化探测（国旗 + 归属类型共用同一条请求）
// 判定铁律：只信「明确证据」——
//   · hosting：接口显式类型(hosting/IDC) / 名称特征 / 备链路中任何非空商家名
//   · 备链路规则：凡能识别出商家（orgName 非空）一律算 hosting（如 Latitude.sh 等云商家），
//     仅当接口完全给不出归属时才保持 unknown
// 接口（均已 curl 实测）：
//   1. gbjs.sld.tw/ipapi/query.php?ip= —— 主链路，company_type 显式分类(hosting/isp/business) + 国家全名
//   2. 备用组（仅 ipType 缺失时请求，均 CORS 放行）：
//      api.iping.cc/v1/query?ip=（原主链路，降级为备） → ipwho.is/{ip}（1000次/天/IP） → api.ip.sb/geoip/{ip}（需 UA）
//   3. api.country.is/{ip} —— 仅国家两位代码，以上链路都无国家时兜底补全（CORS 已实测放行）
// 实测不可用/受限已剔除：api.ipapi.is（有次数限制） / ip.eooce.com（无法跨域） / ipinfo.io（限速） / ipapi.co（限速）/ freeipapi.com（无法跨域）/ ip-api.com（https需付费key，免费仅http）（）
// ========================================================
import { countryNameToCode } from './country';

const flagCache = new Map<string, string>();
const metaCache = new Map<string, IpMeta | null>();

const isPrivateIP = (ip: string) =>
  /^(10\.|192\.168\.|127\.|169\.254\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/.test(ip)
  || ip === '0.0.0.0' || ip === '::1';

export type IpType = 'isp' | 'hosting' | 'business' | 'unknown';

export interface IpMeta {
  country?: string;
  ipType?: IpType;
}

// 知名数据中心 / 云主机 / IDC 品牌特征（名称级 hosting 证据）
const HOSTING_MARKERS = /(amazon|aws|azure|microsoft|google|gcp|oracle|digitalocean|vultr|linode|ovh|hetzner|scaleway|upcloud|contabo|rackspace|ionos|leaseweb|iweb|hivelocity|inmotion|hostgator|hostinger|bluehost|namecheap|colocation|colo|datacenter|data ?center|hosting|hostnet|cloud|cloudflare|heroku|netlify|fly\.io|vercel|fastly|akamai|latitude)/i;

/** 显式类型映射：接口说是什么就是什么，不说绝不猜 */
function classifyByAsnType(type: unknown): IpType | null {
  if (!type) return null;
  const t = String(type).toLowerCase();
  if (t === 'hosting' || t === 'idc') return 'hosting';
  if (t === 'isp') return 'isp';
  if (t === 'business' || t === 'education' || t === 'government') return 'business';
  return null;
}

/**
 * 💡 一体化情报获取：国旗与 ipType 共用一条请求链路
 * 结果按 IP 缓存，fetchFlag 命中缓存即不再重复请求
 */
export async function fetchIpMeta(ip: string): Promise<IpMeta | null> {
  if (!ip) return null;
  if (isPrivateIP(ip)) return null;
  if (metaCache.has(ip)) return metaCache.get(ip)!;

  // 主链路：gbjs.sld.tw —— 国家全名 + countryCode + company_type 显式分类(hosting/isp/business)
  let meta: IpMeta | null = null;
  try {
    const res = await fetch(`https://gbjs.sld.tw/ipapi/query.php?ip=${ip}`, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new Error(`gbjs.sld.tw HTTP ${res.status}`);
    const d = await res.json();
    meta = {
      ipType: classifyByAsnType(d?.company_type) ?? undefined,
      // 国家全名走 name→code 映射，全名映射不到时直接用接口给的两位码
      country: countryNameToCode(d?.country) ?? (d?.countryCode ? String(d.countryCode).toUpperCase() : undefined),
    };
  } catch {
    console.warn(`[IP Meta Probe] 主链路 gbjs.sld.tw 未给出有效情报...`);
  }

  // 备链路组：api.iping.cc（原主链路降级） → ipwho.is → api.ip.sb
  // 仅当主链路未给出 ipType 时才请求；均 CORS 放行；country_code 直接使用
  const backupProviders: ((ip: string) => Promise<{ ipType?: IpType; country?: string } | null>)[] = [
    // 原主链路：company_type/as_type 显式分类 + 名称特征 hosting
    async (ip) => {
      const res = await fetch(`https://api.iping.cc/v1/query?ip=${ip}`, { signal: AbortSignal.timeout(6000) });
      if (!res.ok) throw new Error(`api.iping.cc HTTP ${res.status}`);
      const d = (await res.json())?.data;
      return {
        ipType:
          classifyByAsnType(d?.company_type) ??
          classifyByAsnType(d?.as_type) ??
          (d?.isp && HOSTING_MARKERS.test(String(d.isp)) ? 'hosting' : undefined),
        country: countryNameToCode(d?.country),
      };
    },
    async (ip) => {
      const res = await fetch(`https://ipwho.is/${ip}`, { signal: AbortSignal.timeout(6000) });
      if (!res.ok) throw new Error(`ipwho.is HTTP ${res.status}`);
      const d = await res.json();
      const orgName = String(d?.connection?.org || d?.connection?.isp || '');
      return {
        ipType: orgName ? 'hosting' : undefined,
        country: d?.country_code ? String(d.country_code).toUpperCase() : '',
      };
    },
    async (ip) => {
      const res = await fetch(`https://api.ip.sb/geoip/${ip}`, {
        signal: AbortSignal.timeout(6000),
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });
      if (!res.ok) throw new Error(`api.ip.sb HTTP ${res.status}`);
      const d = await res.json();
      const orgName = String(d?.organization || d?.isp || d?.asn_organization || '');
      return {
        ipType: orgName ? 'hosting' : undefined,
        country: d?.country_code ? String(d.country_code).toUpperCase() : '',
      };
    },
  ];
  for (const provider of backupProviders) {
    if (meta?.ipType) break;
    try {
      const alt = await provider(ip);
      // 💡 备链路判定规则：凡能识别出商家（orgName 非空）一律视为 hosting——
      // 如 Latitude.sh 等云商家；仅当接口完全给不出归属时才保持 unknown
      meta = {
        ...(meta ?? {}),
        ipType: alt?.ipType ?? meta?.ipType,
        country: alt?.country || meta?.country,
      };
    } catch {
      console.warn(`[IP Meta Probe] 备用链路不可用...`);
    }
  }

  // 🚩 国家兜底：主链路未提供国家时（请求失败/该库无此国家），用 api.country.is 单独补全国旗
  if (!meta?.country) {
    try {
      const res = await fetch(`https://api.country.is/${ip}`, { signal: AbortSignal.timeout(6000) });
      if (!res.ok) throw new Error(`api.country.is HTTP ${res.status}`);
      const c = (await res.json())?.country;
      if (c) {
        meta = { ...(meta ?? {}), country: String(c).toUpperCase() };
      }
    } catch {
      console.warn(`[IP Meta Probe] 国家兜底接口 api.country.is 不可用`);
    }
  }

  metaCache.set(ip, meta);
  return meta;
}

/** 🚩 国旗探测：复用一体化情报，仅取 country 字段 */
export async function fetchFlag(ip: string): Promise<string> {
  if (!ip) return 'ERROR';
  if (isPrivateIP(ip)) return 'LOCAL';
  if (flagCache.has(ip)) return flagCache.get(ip)!;

  const meta = await fetchIpMeta(ip);
  if (meta?.country) {
    const upper = meta.country.toUpperCase();
    flagCache.set(ip, upper);
    return upper;
  }
  return 'UNKNOWN';
}
