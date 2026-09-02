// src/types/index.ts
// import { AgentClient } from '../lib/agent-client';
import type { BaseInfo } from '../lib/agent-client'; 

// 业务扩展类型
export interface AgentNode {
  id: string;
  name: string;
  domain: string;
  eciesPrivateKey?: string;
  ecdsaPrivateKey?: string; 
  baseinfo?: BaseInfo | null;
  createdAt: number;
  updatedAt?: number;
  lastConnected?: number;
  status?: 'online' | 'offline' | 'syncing' | 'error';
  ipType?: 'isp' | 'hosting' | 'business' | string;
  flag?: string; // 国旗码（两位大写，如 US / DE），持久化后刷新可免请求
  onetimeTasks?: string[];
  cronTasks?: Record<string, string>;
  Encryption?: boolean;
  forceNoiseWss?: boolean;
  incognitoMode?: boolean; // 无痕模式：开启时不将终端历史命令写入磁盘
}

export interface NodeFormData {
  id?: string;
  name: string;
  domain: string;
  eciesPrivateKey?: string;
  ecdsaPrivateKey?: string;
  forceNoiseWss?: boolean;
  incognitoMode?: boolean; // 无痕模式：开启时不将终端历史命令写入磁盘
}

export interface NodeConfigExport {
  version: string;
  exportedAt: number;
  nodes: AgentNode[];
}

/**
 * 基础日志字段
 */
interface BaseTaskLog {
  ts: string;         // 对应文档中的 ts
  cmd: string;        // 对应文档中的 cmd
  output: string;
  exitcode: number;   // 0 通常表示成功，非 0 表示失败
  formatted: string;  // 格式化后的输出
}

/**
 * 启动任务 (Onetime)
 */
export interface OnetimeTaskLog extends BaseTaskLog {
  type: 'onetime';
}

/**
 * 定时任务 (Cron)
 */
export interface CronTaskLog extends BaseTaskLog {
  type: 'cron';
  cron: string;       // 定时任务特有的表达式字段
}