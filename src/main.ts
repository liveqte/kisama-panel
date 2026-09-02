// src/main.ts
import { createApp } from 'vue';
import App from './App.vue';
import './style.css';  // 如果有全局样式

const app = createApp(App);

// ✅ 添加错误处理，方便调试
app.config.errorHandler = (err, instance, info) => {
  console.error('Vue error:', err, info);
};

// ✅ 确保挂载点存在
const el = document.getElementById('app');
if (!el) {
  console.error('❌ #app element not found!');
} else {
  app.mount('#app');
  console.log('✅ Vue app mounted');
}