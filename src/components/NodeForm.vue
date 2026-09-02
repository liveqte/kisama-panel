<!-- src/components/NodeForm.vue -->
<script setup lang="ts">
import { ref, watch } from 'vue'
import { validatePemKey } from '../lib/validatePemKey'
import type { NodeFormData } from '../types' // [新增] 引入刚刚定义的公共类型

const props = defineProps<{
  // [修改] 直接复用 NodeFormData，并补充 id (因为编辑时可能需要)
  modelValue?: NodeFormData
  isEdit?: boolean
}>()

const emit = defineEmits<{
  // [修改] 提交时直接抛出 NodeFormData 数据结构
  (e: 'submit', data: NodeFormData): void
  (e: 'cancel'): void
}>()

// [修改] 也可以顺手给 form 指定类型，获得更好的代码提示
const form = ref<NodeFormData>({
  name: '',
  domain: '',
  eciesPrivateKey: '',
  ecdsaPrivateKey: '',
  forceNoiseWss: false,
  incognitoMode: true // 无痕模式默认开启
})

const errors = ref({
  ecies: '',
  ecdsa: ''
})

const showAdvanced = ref(false)

watch(
  () => props.modelValue,
  (newVal) => {
    if (newVal) {
      form.value = {
        name: newVal.name || '',
        domain: newVal.domain || '',
        eciesPrivateKey: newVal.eciesPrivateKey || '',
        ecdsaPrivateKey: newVal.ecdsaPrivateKey || '',
        // [优化] 对于布尔值，推荐使用 ?? (空值合并运算符) 替代 || 
        forceNoiseWss: newVal.forceNoiseWss ?? false,
        incognitoMode: newVal.incognitoMode ?? true // 无痕模式未配置时默认开启
      }
      // 如果编辑时已有密钥内容或开启了强制加密，自动展开高级设置
      if (newVal.eciesPrivateKey || newVal.ecdsaPrivateKey || newVal.forceNoiseWss) {
        showAdvanced.value = true
      }
    } else {
      form.value = { name: '', domain: '', eciesPrivateKey: '', ecdsaPrivateKey: '', forceNoiseWss: false, incognitoMode: true }
      showAdvanced.value = false
    }
    errors.value = { ecies: '', ecdsa: '' }
  },
  { immediate: true }
)

const handleSubmit = () => {
  if (!form.value.name.trim() || !form.value.domain.trim()) {
    alert('请填写节点名称和 Domain')
    return
  }

  const ecdsaResult = validatePemKey(form.value.ecdsaPrivateKey || '', 'ecdsa')
  if (!ecdsaResult.valid) {
    errors.value.ecdsa = ecdsaResult.error || '无效的 ECDSA 私钥'
    return
  } else {
    errors.value.ecdsa = ''
  }

  if (form.value.eciesPrivateKey) {
    const eciesResult = validatePemKey(form.value.eciesPrivateKey || '', 'ecies')
    if (!eciesResult.valid) {
      errors.value.ecies = eciesResult.error || '无效的 ECIES 私钥'
      return
    } else {
      errors.value.ecies = ''
    }
  }

  emit('submit', { ...form.value })
}
</script>

<template>
  <form @submit.prevent="handleSubmit" class="node-form">
    <!-- 基础字段 -->
    <div class="form-grid">
      <div class="form-group">
        <label>节点名称 <span class="required">*</span></label>
        <input v-model="form.name" type="text" placeholder="例如: 生产环境-01" required />
      </div>
      <div class="form-group">
        <label>Domain / URL <span class="required">*</span></label>
        <input v-model="form.domain" type="text" placeholder="agent.example.com" required />
      </div>
    </div>

    <!-- 高级设置折叠按钮 (H5 风格) -->
    <button type="button" class="advanced-toggle" @click="showAdvanced = !showAdvanced">
      <span class="toggle-label">
        <span class="toggle-icon">⚙️</span>
        高级设置 (密钥配置)
      </span>
      <span class="chevron">{{ showAdvanced ? '▲' : '▼' }}</span>
    </button>

    <!-- 高级设置内容 -->
    <Transition name="slide-fade">
      <div v-if="showAdvanced" class="advanced-content">
        
        <!-- [新增] 强制 Noise 加密开关 -->
        <div class="form-group checkbox-group">
          <label class="checkbox-label">
            <input type="checkbox" v-model="form.forceNoiseWss" />
            <span class="checkbox-text">强制在 WSS 下使用 Noise 加密连接全能终端</span>
          </label>
        </div>

        <!-- [新增] 无痕模式开关 -->
        <div class="form-group checkbox-group">
          <label class="checkbox-label">
            <input type="checkbox" v-model="form.incognitoMode" />
            <span class="checkbox-text">无痕模式（开启后终端历史命令不写入磁盘，默认开启）</span>
          </label>
        </div>

        <div class="form-group">
          <label>ECDSA 私钥 <span class="optional">(签名认证，支持 PKCS#8)</span></label>
          <textarea
            v-model="form.ecdsaPrivateKey"
            placeholder="-----BEGIN PRIVATE KEY-----&#10;...&#10;-----END PRIVATE KEY-----"
            rows="4"
            :class="{ 'input-error': errors.ecdsa }"
          ></textarea>
          <span v-if="errors.ecdsa" class="error-message">{{ errors.ecdsa }}</span>
        </div>

        <div class="form-group">
          <label>ECIES 私钥 <span class="optional">(解密响应，支持 ECIES secp256k1，可选)</span></label>
          <textarea
            v-model="form.eciesPrivateKey"
            placeholder="请输入 64 位 Hex 字符串 (例如: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855)"
            rows="4"
            :class="{ 'input-error': errors.ecies }"
          ></textarea>
          <span v-if="errors.ecies" class="error-message">{{ errors.ecies }}</span>
        </div>
      </div>
    </Transition>

    <div class="form-actions">
      <button type="button" class="btn secondary" @click="$emit('cancel')">取消</button>
      <button type="submit" class="btn primary">
        {{ isEdit ? '保存修改' : '添加节点' }}
      </button>
    </div>
  </form>
</template>

<style scoped>
.node-form {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  margin-bottom: 4px;
}

@media (max-width: 480px) {
  .form-grid {
    grid-template-columns: 1fr;
    gap: 12px;
  }
}

.form-group {
  margin-bottom: 0;
}

.required {
  color: var(--danger);
  margin-left: 2px;
}

.optional {
  font-size: 0.8rem;
  font-weight: 400;
  color: var(--muted);
  margin-left: 6px;
}

/* 高级设置折叠按钮 - H5 风格 */
.advanced-toggle {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  padding: 12px 0;
  margin: 12px 0 4px;
  background: transparent;
  border: none;
  border-top: 1px solid var(--border);
  cursor: pointer;
  font-size: 0.95rem;
  font-weight: 500;
  color: var(--primary);
  transition: opacity 0.15s;
}

.advanced-toggle:hover {
  opacity: 0.75;
}

.toggle-label {
  display: flex;
  align-items: center;
  gap: 8px;
}

.toggle-icon {
  font-size: 1.1rem;
}

.chevron {
  font-size: 0.75rem;
  color: var(--muted);
}

/* 高级设置内容 */
.advanced-content {
  display: flex;
  flex-direction: column;
  gap: 16px; /* 增加内部元素间距 */
  padding: 16px 18px;
  margin-bottom: 8px;
  background: var(--surface-2);
  border-radius: 18px;
  border: 1px solid var(--border);
}

/* 新增：复选框容器样式 */
.checkbox-group {
  background: var(--card); /* 白色背景凸显层级 */
  padding: 12px 14px;
  border-radius: 12px;
  border: 1px solid var(--border, #eef2f6);
  transition: border-color 0.2s;
}

.checkbox-group:hover {
  border-color: var(--primary);
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  margin: 0;
}

.checkbox-label input[type="checkbox"] {
  width: 18px;
  height: 18px;
  margin: 0;
  cursor: pointer;
  accent-color: var(--primary); /* 使用主题色 */
}

.checkbox-text {
  font-size: 0.9rem;
  font-weight: 500;
  color: var(--text-soft);
}

/* 过渡动画 */
.slide-fade-enter-active {
  transition: all 0.2s ease-out;
}
.slide-fade-leave-active {
  transition: all 0.15s ease-in;
}
.slide-fade-enter-from,
.slide-fade-leave-to {
  transform: translateY(-10px);
  opacity: 0;
}

/* 错误状态 */
.input-error {
  border-color: var(--danger) !important;
  background-color: var(--chip-offline-bg) !important;
}

.error-message {
  color: var(--danger);
  font-size: 0.8rem;
  margin-top: 6px;
  display: flex;
  align-items: center;
  gap: 4px;
}

.error-message::before {
  content: '⚠️';
  font-size: 0.9rem;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
}
</style>