// src/composables/useToast.ts
import { ref } from 'vue';
import { useNotificationCenter } from './useNotificationCenter';

export type ToastType = 'success' | 'error' | 'info';

interface ToastState {
  show: boolean;
  message: string;
  type: ToastType;
}

// 核心单例状态：确保所有组件调用的都是同一个全局唯一的通知视图
const toastState = ref<ToastState>({
  show: false,
  message: '',
  type: 'info'
});

let toastTimer: ReturnType<typeof setTimeout> | null = null;

const { addNotification } = useNotificationCenter();

export function useToast() {
  /**
   * 🚀 智能自适应参数签名的全局统一显示通知函数
   * 模式 A (App旧风格):        showToast(message, type, duration)
   * 模式 B (FileManager风格):  showToast(type, message, duration)
   */
  const showToast = (arg1: string, arg2?: string | number, arg3?: number) => {
    if (toastTimer) clearTimeout(toastTimer);

    let message = '';
    let type: ToastType = 'info';
    let duration = 3000;

    const validTypes: ToastType[] = ['success', 'error', 'info'];

    if (validTypes.includes(arg1 as ToastType)) {
      // 🧩 匹配模式 B: 第一个参数是类型 (type, message, duration)
      type = arg1 as ToastType;
      message = String(arg2 || '');
      if (typeof arg3 === 'number') duration = arg3;
    } else {
      // 🧩 匹配模式 A: 第一个参数是内容 (message, type, duration)
      message = arg1;
      if (typeof arg2 === 'string' && validTypes.includes(arg2 as ToastType)) {
        type = arg2 as ToastType;
      }
      if (typeof arg3 === 'number') duration = arg3;
      else if (typeof arg2 === 'number') duration = arg2;
    }

    // 同步记入通知中心历史，避免一闪而过没看清
    if (message) addNotification({ kind: 'toast', type, message });

    // 写入全局单例状态
    toastState.value = {
      show: true,
      message,
      type
    };

    // 自动无感关闭
    toastTimer = setTimeout(() => {
      toastState.value.show = false;
    }, duration);
  };

  return {
    toastState,
    showToast
  };
  
}

