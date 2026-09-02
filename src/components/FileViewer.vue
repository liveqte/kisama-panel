<script setup lang="ts">
import { watch, onBeforeUnmount } from 'vue'

const props = defineProps<{
  modelValue: boolean
  src: string
  name: string
  kind: 'image' | 'video' | 'audio'
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
}>()

function close() {
  emit('update:modelValue', false)
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') close()
}

watch(() => props.modelValue, (val) => {
  if (val) {
    window.addEventListener('keydown', onKeydown)
  } else {
    window.removeEventListener('keydown', onKeydown)
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="viewer-fade">
      <div v-if="modelValue" class="viewer-overlay" @click.self="close">
        <div class="viewer-toolbar">
          <span class="viewer-name">{{ kind === 'image' ? '🖼️' : kind === 'video' ? '🎬' : '🎵' }} {{ name }}</span>
          <button class="viewer-close" @click="close">✕</button>
        </div>
        <div class="viewer-stage">
          <img v-if="kind === 'image'" :src="src" :alt="name" />
          <video v-else-if="kind === 'video'" :src="src" controls></video>
          <div v-else class="viewer-audio-box">
            <div class="viewer-audio-icon">🎵</div>
            <audio :src="src" controls></audio>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.viewer-overlay { position: fixed; inset: 0; z-index: 2100; background: rgba(2, 6, 23, 0.92); display: flex; flex-direction: column; }
.viewer-toolbar { display: flex; align-items: center; justify-content: space-between; padding: 14px 24px; color: #e2e8f0; background: rgba(15, 23, 42, 0.6); border-bottom: 1px solid rgba(148, 163, 184, 0.2); }
.viewer-name { font-size: 1rem; font-weight: 700; word-break: break-all; }
.viewer-close { background: transparent; border: none; font-size: 1.5rem; cursor: pointer; color: #94a3b8; padding: 4px 10px; border-radius: 8px; line-height: 1; transition: all 0.2s ease; }
.viewer-close:hover { background: rgba(148, 163, 184, 0.2); color: #f8fafc; }
.viewer-stage { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; padding: 20px; overflow: auto; }
.viewer-stage img { max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 8px; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.6); }
.viewer-stage video { max-width: 100%; max-height: 100%; width: auto; height: auto; border-radius: 8px; background: #000; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.6); outline: none; }
.viewer-audio-box { display: flex; flex-direction: column; align-items: center; gap: 24px; padding: 48px 64px; border-radius: 16px; background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(148, 163, 184, 0.2); }
.viewer-audio-icon { font-size: 4rem; }
.viewer-audio-box audio { width: min(520px, 80vw); }
.viewer-fade-enter-active, .viewer-fade-leave-active { transition: opacity 0.2s ease; }
.viewer-fade-enter-from, .viewer-fade-leave-to { opacity: 0; }
</style>
