// src/lib/runtime-inject.ts
/**
 * 自定义样式 / 脚本运行时注入器
 * 从 App.vue 平移至 lib，供「设置保存」「导入恢复」「云同步应用」三处共用
 */

// CSS 实时注入核心函数
export const injectCustomStyle = (css: string) => {
  let styleEl = document.getElementById('kisama-injected-styles');
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'kisama-injected-styles';
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = css;
};

export const injectCustomScript = (htmlOrJs: string) => {
  // 1. 先清理掉上一次注入的旧挂件，防止重复挂载
  const oldContainer = document.getElementById('kisama-injected-widgets');
  if (oldContainer) oldContainer.remove();

  if (!htmlOrJs.trim()) return;

  // 2. 创建一个隔离的容器塞进 body 底部
  const container = document.createElement('div');
  container.id = 'kisama-injected-widgets';

  // 3. 暴力注入 HTML（支持播放器的 iframe、div 挂件等）
  container.innerHTML = htmlOrJs;
  document.body.appendChild(container);

  // 4. 【核心】提取并手动执行里面的 <script> 脚本
  const scripts = container.querySelectorAll('script');
  scripts.forEach((oldScript) => {
    const newScript = document.createElement('script');
    // 复制原 script 的属性（如 src）
    Array.from(oldScript.attributes).forEach(attr => newScript.setAttribute(attr.name, attr.value));
    // 复制内联代码
    newScript.textContent = oldScript.textContent;
    // 挂载到 head 触发执行
    document.head.appendChild(newScript).parentNode?.removeChild(newScript);
  });
};
