// src/lib/task-daemon.ts
// 🗄️ 注意：本守护进程只遍历 useNodes().nodes（活跃节点）。
// 回收站（agent_recycle_bin）中冻结的节点不在该列表中，因此永远不会
// 触发这里的脚本任务维护、基础信息同步或任务恢复逻辑。
import { useNodes } from '../composables/useNodes';
import { probeProxyPoolHealth } from './proxy-health';
import { AgentClient } from './agent-client';
import { runConfigSync } from './configsync';
import type { AgentNode } from '../types';

class TaskDaemon {
  private taskTimer: number | null = null;
  private syncTimer: number | null = null;
  private configSyncTimer: number | null = null;

  // 💡 按节点 ID 的失败退却状态（内存态，刷新页面自动归零）
  private nodeBackoffs = new Map<string, { failures: number; nextRetryAt: number }>();

  private readonly TASK_INTERVAL_MS = 5 * 60 * 1000;
  private readonly SYNC_INTERVAL_MS = 10 * 60 * 1000;
  private readonly CONFIG_SYNC_INTERVAL_MS = 10 * 60 * 1000; // ☁️ 配置云同步周期
  private readonly BACKOFF_MAX_MS = 12 * 60 * 60 * 1000; // 最长退却12小时

  public start() {
    if (!this.taskTimer) {
      console.log('🛡️ [TaskDaemon] 任务守护进程已启动，周期: 5分钟');
      setTimeout(() => {
        this.runTaskMaintenance();
      }, 10000);

      this.taskTimer = window.setInterval(() => {
        this.runTaskMaintenance();
      }, this.TASK_INTERVAL_MS);
    }

    if (!this.syncTimer) {
      console.log('🔄 [TaskDaemon] 节点同步进程已启动，周期: 10分钟');
      setTimeout(() => {
        this.runNodeSync();
      }, 20000);

      this.syncTimer = window.setInterval(() => {
        this.runNodeSync();
      }, this.SYNC_INTERVAL_MS);
    }

    if (!this.configSyncTimer) {
      console.log('☁️ [TaskDaemon] 配置云同步进程已启动，周期: 10分钟');
      setTimeout(() => {
        this.runConfigSyncJob();
      }, 45000); // 错峰启动，避开前两个任务的初始化高峰

      this.configSyncTimer = window.setInterval(() => {
        this.runConfigSyncJob();
      }, this.CONFIG_SYNC_INTERVAL_MS);
    }
  }

  public stop() {
    if (this.taskTimer) { clearInterval(this.taskTimer); this.taskTimer = null; }
    if (this.syncTimer) { clearInterval(this.syncTimer); this.syncTimer = null; }
    if (this.configSyncTimer) { clearInterval(this.configSyncTimer); this.configSyncTimer = null; }
    console.log('🛑 [TaskDaemon] 所有后台守护进程已停止');
  }

  /**
   * ⚡ 新增：中传代理站点池自动化动态洗牌与健康嗅探
   * 已抽离至共享模块 proxy-health.ts，single-flight + 冷却期避免与手动刷新/全部同步重复探测
   */
  private async refreshProxyPoolHealth(): Promise<void> {
    try {
      await probeProxyPoolHealth();
    } catch (e) {
      console.error('[TaskDaemon] 自动维护中传站点池失败:', e);
    }
  }

  // ==================== 任务 3：配置云同步 (10分钟) ====================
  /**
   * ☁️ 定时配置同步：委托 configsync 引擎自动识别三种局面
   * （远端缺失推送 / 本地缺失拉取 / 双方分域合并）。
   * 静默运行：不传 notify，仅 console 记录；未登录时引擎内部直接跳过。
   */
  private async runConfigSyncJob() {
    try {
      const outcome = await runConfigSync();
      if (outcome !== 'in-sync' && outcome !== 'no-login' && outcome !== 'busy') {
        console.log(`[TaskDaemon] 定时配置云同步完成: ${outcome}`);
      }
    } catch (e) {
      console.error('[TaskDaemon] 定时配置云同步异常:', e);
    }
  }

  // ==================== 任务 1：同步节点基础信息 (10分钟) ====================
  private async runNodeSync() {
    // 💡 执行前，先过一遍中传站健康洗牌
    await this.refreshProxyPoolHealth();

    const { nodes, syncNodeBaseInfo } = useNodes();
    const nodeList = nodes.value;
    if (nodeList.length === 0) return;

    const now = Date.now();
    let eligibleCount = 0;
    let successCount = 0;
    let skipCount = 0;

    console.log(`[TaskDaemon] 开始节点同步检查 (共${nodeList.length}个节点)...`);

    await Promise.allSettled(nodeList.map(async (node) => {
      // 检查退却：尚未到达下一次重试时间则跳过
      const backoff = this.nodeBackoffs.get(node.id);
      if (backoff && now < backoff.nextRetryAt) {
        skipCount++;
        return;
      }

      eligibleCount++;
      try {
        await syncNodeBaseInfo(node.id);
        // 同步成功 → 清除退却记录
        this.nodeBackoffs.delete(node.id);
        successCount++;
      } catch {
        // 首次失败 → 立刻重试一次（容忍瞬时网络抖动）
        try {
          console.warn(`[TaskDaemon] 节点 [${node.name}] 首次同步失败，正在尝试立刻重试...`);
          await syncNodeBaseInfo(node.id);
          this.nodeBackoffs.delete(node.id);
          successCount++;
        } catch {
          // 二次重试依旧失败 → 指数退却 (1min, 2min, 4min, 8min ... 封顶12h)
          const existing = this.nodeBackoffs.get(node.id);
          const failures = (existing?.failures || 0) + 1;
          const delay = Math.min(Math.pow(2, failures - 1) * 60 * 1000, this.BACKOFF_MAX_MS);
          this.nodeBackoffs.set(node.id, { failures, nextRetryAt: Date.now() + delay });
          console.warn(
            `[TaskDaemon] 节点 [${node.name}] 同步失败，第${failures}次，` +
            `${delay / 60000}分钟后重试`
          );
        }
      }
    }));

    console.log(
      `[TaskDaemon] 节点同步完成: ${successCount}/${eligibleCount} 个节点在线` +
      (skipCount > 0 ? ` (跳过${skipCount}个退却中节点)` : '')
    );
  }

  // ==================== 任务 2：维护节点脚本任务 (5分钟) ====================
  private async runTaskMaintenance() {
    // 💡 执行前，先过一遍中传站健康洗牌
    await this.refreshProxyPoolHealth();

    const { nodes, globalConfig } = useNodes();
    const nodeList = nodes.value;
    // 💡 ✨【核心新增】：仅对在线且非 PHP 探针的节点进行例行脚本任务检查
    // 跳过离线/错误节点，避免产生不必要的连接错误日志
    const maintainableNodes = nodeList.filter(node => {
      if (node.status !== 'online') return false;
      return !node.baseinfo?.version?.toLowerCase().includes('php');
    });
    if (maintainableNodes.length === 0) return;

    console.log(`[TaskDaemon] 开始对 ${maintainableNodes.length} 个在线节点进行例行脚本任务检查...`);

    await Promise.allSettled(maintainableNodes.map(async (node) => {
      try {
        const ecdsaKey = node.ecdsaPrivateKey || globalConfig.value?.ecdsaPrivateKey || '';
        const eciesKey = node.eciesPrivateKey || globalConfig.value?.eciesPrivateKey || '';
  
        const client = new AgentClient({
          domain: node.domain,
          eciesPrivateKey: eciesKey,
          ecdsaPrivateKey: ecdsaKey,
          timeout: 15000,
          Encryption: true
        });
  
        // 🌐 必须先建立会话握手（getBaseInfo 获取 session_key），
        // 否则服务器端会话未建立时，后续写入类请求（set*/POST）会被服务端拒绝
        await client.getBaseInfo();

        const [otRes, ctRes] = await Promise.all([
          client.getOneTimeTasks().catch(() => null),
          client.getCronTasks().catch(() => null)
        ]);
  
        if (otRes) await this.checkOnetimeTasks(client, node, otRes.tasks || []);
        if (ctRes) await this.checkCronTasks(client, node, ctRes.tasks || {});
  
      } catch (err: any) {
        console.error(`[TaskDaemon] 节点 [${node.name}] 维护请求失败:`, err.message);
      }
    }));
  }

  private async checkOnetimeTasks(client: AgentClient, node: AgentNode, remoteTasks: string[]) {
    const localTasks = node.onetimeTasks || [];
    if (remoteTasks.length === 0 && localTasks.length > 0) {
      console.log(`⚠️ [TaskDaemon] 节点 [${node.name}] 远程启动任务丢失，正在恢复...`);
      try {
        await client.setOneTimeTasks(localTasks);
        console.log(`✅ [TaskDaemon] 节点 [${node.name}] 启动任务恢复成功！`);
      } catch (e: any) {
        console.error(`❌ [TaskDaemon] 节点 [${node.name}] 启动任务恢复失败:`, e.message);
      }
    }
  }

  private async checkCronTasks(client: AgentClient, node: AgentNode, remoteTasks: Record<string, string>) {
    const localTasks = node.cronTasks || {};
    const remoteCount = Object.keys(remoteTasks).length;
    const localCount = Object.keys(localTasks).length;

    if (remoteCount === 0 && localCount > 0) {
      console.log(`⚠️ [TaskDaemon] 节点 [${node.name}] 远程定时任务丢失，正在恢复...`);
      try {
        await client.setCronTasks(localTasks);
        console.log(`✅ [TaskDaemon] 节点 [${node.name}] 定时任务恢复成功！`);
      } catch (e: any) {
        console.error(`❌ [TaskDaemon] 节点 [${node.name}] 定时任务恢复失败:`, e.message);
      }
    }
  }
}

export const taskDaemon = new TaskDaemon();