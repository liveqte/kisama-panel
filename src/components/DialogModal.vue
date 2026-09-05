<!-- src/components/DialogModal.vue -->
<script setup lang="ts">
const props = defineProps<{
  modelValue: boolean
  title?: string
  width?: 'small' | 'medium' | 'large'
  confirmText?: string
  cancelText?: string
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'confirm'): void
  (e: 'cancel'): void
}>()

function close() {
  emit('update:modelValue', false)
  emit('cancel')
}

function confirm() {
  emit('confirm')
}
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="modelValue" class="dialog-overlay" @click.self="close">
        <div class="dialog-content" :class="width">
          <div class="dialog-header">
            <h3 v-if="title">{{ title }}</h3>
            <button class="close-btn" @click="close">✕</button>
          </div>
          <div class="dialog-body">
            <slot />
          </div>
          <div class="dialog-footer">
            <slot name="actions">
              <button class="btn secondary" @click="close">{{ cancelText || '取消' }}</button>
              <button class="btn primary" @click="confirm">{{ confirmText || '确定' }}</button>
            </slot>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: center;
  justify-content: center;
  /* 2200：需盖过通知/回收站抽屉（2100/2101），确认弹窗永远最顶层 */
  z-index: 2200;
}
.dialog-content {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 20px;
  min-width: 420px;
  max-width: 90vw;
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  color: var(--text);
}
.dialog-content.small {
  max-width: 400px;
}
.dialog-content.medium {
  max-width: 500px;
}
.dialog-content.large {
  max-width: 1600px;
  height: 85vh;
  max-height: 85vh;
}
.dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}
.dialog-header h3 {
  font-size: 1.2rem;
  font-weight: 600;
  margin: 0;
}
.close-btn {
  background: none;
  border: none;
  font-size: 1.5rem;
  cursor: pointer;
  color: var(--muted);
  line-height: 1;
}
.dialog-body {
  flex: 1;
  overflow-y: auto;
}
.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 20px;
}
.fade-enter-active, .fade-leave-active {
  transition: opacity 0.2s;
}
.fade-enter-from, .fade-leave-to {
  opacity: 0;
}
</style>