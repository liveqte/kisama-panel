// src/lib/node-stable.ts
import type { AgentNode } from '../types';

/**
 * 节点稳定特征投影：仅保留"用户配置"相关字段。
 *
 * 刻意剔除后台守护进程反复刷新的易变缓存字段：
 *   status / baseinfo / lastConnected / ipType / flag
 * 这些字段的值由探测与心跳决定，不代表用户的配置意图。
 * 若纳入比对，守护进程每刷新一轮就会造成一次"配置变化"假象，
 * 触发无意义的同步风暴。
 *
 * 消费方：
 *  - configsync.ts ：分域合并时的内容哈希与节点级 LWW 比较
 *  - useNodes.importConfig ：判断导入节点是否与现有节点实质相同
 */
export function nodeStableSignature(n: Partial<AgentNode>) {
  return {
    id: n.id,
    name: n.name,
    domain: n.domain,
    eciesPrivateKey: n.eciesPrivateKey ?? '',
    ecdsaPrivateKey: n.ecdsaPrivateKey ?? '',
    createdAt: n.createdAt ?? 0,
    updatedAt: n.updatedAt ?? 0,
    onetimeTasks: n.onetimeTasks ?? [],
    cronTasks: n.cronTasks ?? {},
    Encryption: n.Encryption,
    forceNoiseWss: n.forceNoiseWss,
    incognitoMode: n.incognitoMode,
  };
}
