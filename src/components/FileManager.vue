<script setup lang="ts">
import { ref, computed, watch, type Ref } from 'vue'
import { AgentClient } from '../lib/agent-client'
import type { AgentNode } from '../types'
import DialogModal from './DialogModal.vue'
import FileViewer from './FileViewer.vue'

// 💡 ✨【核心更替：对接全局组合式通知】
import { useToast } from '../composables/useToast'
const { showToast } = useToast()

const props = defineProps<{
  node: AgentNode
  visible: boolean
  globalConfig?: { ecdsaPrivateKey?: string; eciesPrivateKey?: string }
}>()

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void
  (e: 'close'): void
}>()

const isUploading = ref(false)
const uploadProgress = ref(0)
const currentChunk = ref(0)
const totalChunksCount = ref(0)
const uploadSpeed = ref('')

const client = ref<AgentClient | null>(null)
const lastNodeDomain = ref<string>('')
const loading = ref(false)
const currentPath = ref('./')
const pathHistory = ref<string[]>([])
const files = ref<any[]>([])
const selectedFiles = ref<Set<string>>(new Set())
const agentVersion = ref<string>('')

function isVersionGte30(versionStr: string): boolean {
  if (!versionStr) return false
  const match = versionStr.match(/^(\d+)\.(\d+)\.(\d+)/)
  if (!match) return false
  const major = parseInt(match[1], 10)
  const minor = parseInt(match[2], 10)
  if (major > 0) return true
  if (major === 0 && minor >= 3) return true
  return false
}

const isQueryingAuth = ref(false)
const authDetails = ref<{ readable?: boolean; writable?: boolean; executable?: boolean }>({})
const editableContent = ref('')

const isPreviewEditable = computed(() => {
  if (!fileContentPath.value) return false
  const name = fileContentPath.value.split('/').pop() || ''
  const ext = name.split('.').pop()?.toLowerCase() || ''
  
  // 🎯 1. 新增：特殊系统配置文件名全量绝对匹配（不区分大小写，完美支持 .bashrc 等隐藏文件）
  const textNames = [
    '.bashrc', '.bash_profile', '.profile', '.zshrc', '.zprofile',
    '.gitignore', '.dockerignore', 'dockerfile', 'makefile'
  ]
  if (textNames.includes(name.toLowerCase())) return true

  // 📝 2. 传统文件后缀名匹配
  const textExts = [
    'txt', 'md', 'markdown', 'js', 'ts', 'vue', 'py', 'json',
    'css', 'html', 'htm', 'xml', 'yaml', 'yml', 'sh', 'bash', 'bashrc',
    'log', 'conf', 'ini', 'env', 'go', 'rs', 'php', 'java'
  ]
  return textExts.includes(ext)
})

const previewTitle = computed(() => {
  const name = fileContentPath.value.split('/').pop() || ''
  return name ? `${name} 文件内容预览` : '文件内容预览'
})

type MediaKind = 'image' | 'video' | 'audio'

const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico', 'avif']
const videoExts = ['mp4', 'webm', 'mkv', 'mov', 'avi', 'm4v', 'ogv']
const audioExts = ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'opus']

function getMediaKind(name: string): MediaKind | null {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  if (imageExts.includes(ext)) return 'image'
  if (videoExts.includes(ext)) return 'video'
  if (audioExts.includes(ext)) return 'audio'
  return null
}

const showFileViewer = ref(false)
const viewerSrc = ref('')
const viewerName = ref('')
const viewerKind = ref<MediaKind>('image')

async function viewMediaFile(file: any, kind: MediaKind) {
  if (file.size > 200 * 1024 * 1024) {
    showToast('info', '文件大于200MB，无法预览')
    return
  }
  try {
    loading.value = true
    const res = await client.value!.downloadFile(file.path)
    if (viewerSrc.value) URL.revokeObjectURL(viewerSrc.value)
    viewerSrc.value = URL.createObjectURL(res.blob)
    viewerName.value = file.name
    viewerKind.value = kind
    showFileViewer.value = true
  } catch (err: any) {
    showToast('error', `读取失败: ${err.message}`)
  } finally {
    loading.value = false
  }
}

watch(showFileViewer, (val) => {
  if (!val && viewerSrc.value) {
    URL.revokeObjectURL(viewerSrc.value)
    viewerSrc.value = ''
  }
})

function openPreview(file: any) {
  const kind = getMediaKind(file.name)
  if (kind) {
    viewMediaFile(file, kind)
  } else {
    viewFileContent(file)
  }
}

const showNewFolderDialog = ref(false)
const showRenameDialog = ref(false)
const showPermissionDialog = ref(false)
const showFileContentDialog = ref(false)
const showNewFileEditor = ref(false) 
const newFileNameEditor = ref('')    
const newFileContentEditor = ref('') 

const newFolderName = ref('')
const renameTarget = ref<any>(null)
const newName = ref('')
const permissionTarget = ref<any>(null)
const permissionMode = ref('')
const fileContent = ref('')
const fileContentPath = ref('')

const isDirectory = (file: any) => file.type === 'dir' || file.type === 'directory'

function getParentPath(path: string): string {
  let normalized = path.replace(/\/+$/, '');
  if (normalized === '' || normalized === '.' || normalized === './') {
    return './';
  }
  const purePath = normalized.startsWith('./') ? normalized.substring(2) : normalized;
  const lastSlash = purePath.lastIndexOf('/');
  if (lastSlash === -1) {
    return './';
  }
  const parentPure = purePath.substring(0, lastSlash);
  return './' + parentPure;
}

async function saveNewFile() {
  const filename = newFileNameEditor.value.trim();
  const content = newFileContentEditor.value;
  const targetDir = currentPath.value;

  if (!filename) {
    showToast('error', '文件名不能为空');
    return;
  }

  showNewFileEditor.value = false;

  try {
    const useRaw = isVersionGte30(agentVersion.value);
    if (useRaw) {
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const res = await client.value!.uploadFileRaw({
        path: targetDir,
        filename: filename,
        content: blob
      });
      if (!res || res.status !== 'ok') {
        throw new Error(res?.message || '探针接收裸流异常');
      }
    } else {
      await client.value!.uploadFile({
        path: targetDir,
        filename: filename,
        content: btoa(unescape(encodeURIComponent(content))) 
      });
    }
    showToast('success', `文件 “${filename}” 创建成功`);
    refresh(); 
  } catch (err: any) {
    showToast('error', `创建失败: ${err.message || '网络或网关故障'}`);
    console.error('Upload failed:', err);
  }
}

interface DirPickerState {
  currentPath: string
  dirs: any[]
  selectedDest: string
}

const showCutDialog = ref(false)
const cutTargets = ref<any[]>([])
const cutState = ref<DirPickerState>({
  currentPath: './',
  dirs: [],
  selectedDest: ''
})

const showCopyDialog = ref(false)
const copyTargets = ref<any[]>([])
const copyState = ref<DirPickerState>({
  currentPath: './',
  dirs: [],
  selectedDest: ''
})

async function loadDirsForPicker(path: string, state: Ref<DirPickerState>) {
  if (!client.value) return
  try {
    const res = await client.value.listFiles(path, false)
    state.value.dirs = (res.files || []).filter(f => isDirectory(f))
    state.value.currentPath = path
  } catch (err: any) {
    showToast('error',`加载目录失败: ${err.message}`)
  }
}

function goUpForPicker(state: Ref<DirPickerState>) {
  if (!state?.value) return;
  const parent = getParentPath(state.value.currentPath);
  loadDirsForPicker(parent, state);
  state.value.selectedDest = parent;
}

// 进入子目录
function enterDirForPicker(path: string, state: Ref<DirPickerState>) {
  if (!state?.value) return;
  loadDirsForPicker(path, state);
  state.value.selectedDest = path;
}

const sortKey = ref<'name' | 'size' | 'mode'>('mode')
const sortAsc = ref(false)

const encryptionStatus = computed(() => {
  if (!client.value) return '未连接'
  return client.value?.Encryption ? '🔒 加密会话' : '🔓 明文传输'
})

async function initClient() {
  const ecdsaKey = props.node.ecdsaPrivateKey || props.globalConfig?.ecdsaPrivateKey || ''
  const eciesKey = props.node.eciesPrivateKey || props.globalConfig?.eciesPrivateKey || ''
  client.value = new AgentClient({
    domain: props.node.domain,
    eciesPrivateKey: eciesKey,
    ecdsaPrivateKey: ecdsaKey,
    timeout: 600000,
    Encryption: true 
  })
  try {
    const baseInfo = await client.value.getBaseInfo()
    if (baseInfo && baseInfo.version) {
      agentVersion.value = baseInfo.version 
    }
  } catch (e) {
    console.error('文件管理器初始化失败:', e)
  }
}

async function loadFiles(path?: string) {
  if (!client.value) return
  let targetPath = path ?? currentPath.value
  console.log(`%c[FileManager] 正在请求路径: %c"${targetPath}"`, "color: #3b82f6", "color: #ef4444; font-weight: bold;")
  loading.value = true
  try {
    const res = await client.value.listFiles(targetPath, false)
    files.value = res.files || []
    currentPath.value = targetPath
    updatePathHistory(targetPath)
    selectedFiles.value.clear()
  } catch (err: any) {
    console.error(`[FileManager] 请求失败:`, err)
    showToast('error',`加载目录失败: ${err.message}`)
  } finally {  // 🎯 修正为 finally
    loading.value = false
  }
}

function updatePathHistory(fullPath: string) {
  if (fullPath === './' || fullPath === '.') {
    pathHistory.value = ['./']
    return
  }
  const displayPath = fullPath.startsWith('./') ? fullPath.substring(2) : fullPath
  const parts = displayPath.split('/').filter(p => p)
  const paths: string[] = ['./']
  let accum = './'
  for (const part of parts) {
    accum += (accum === './' ? '' : '/') + part
    paths.push(accum)
  }
  pathHistory.value = paths
}

const sortedFiles = computed(() => {
  const list = [...files.value]
  list.sort((a, b) => {
    let valA: any, valB: any
    if (sortKey.value === 'name') {
      valA = a.name
      valB = b.name
    } else if (sortKey.value === 'size') {
      valA = a.size || 0
      valB = b.size || 0
    } else {
      valA = a.mode || ''
      valB = b.mode || ''
    }
    if (typeof valA === 'string' && typeof valB === 'string') {
      return sortAsc.value ? valA.localeCompare(valB) : valB.localeCompare(valA)
    }
    return sortAsc.value ? valA - valB : valB - valA
  })
  return list.sort((a, b) => {
    if (a.type === 'dir' && b.type !== 'dir') return -1
    if (a.type !== 'dir' && b.type === 'dir') return 1
    return 0
  })
})

function enterDirectory(dirPath: string) {
  loadFiles(dirPath)
}

function goBack() {
  const path = currentPath.value
  if (path === './' || path === '.') return
  const normalizedPath = path.replace(/\/+$/, '')
  const lastSlashIndex = normalizedPath.lastIndexOf('/')
  if (lastSlashIndex === -1 || normalizedPath === './' + normalizedPath.split('/').pop()) {
    loadFiles('./')
  } else {
    const parent = normalizedPath.substring(0, lastSlashIndex)
    loadFiles(parent || './')
  }
}

function refresh() {
  loadFiles(currentPath.value)
}

function toggleSelect(file: any) {
  const path = file.path
  const newSet = new Set(selectedFiles.value)
  if (newSet.has(path)) {
    newSet.delete(path)
  } else {
    newSet.add(path)
  }
  selectedFiles.value = newSet
}

function toggleSelectAll(event: Event) {
  const checked = (event.target as HTMLInputElement).checked
  selectedFiles.value = checked ? new Set(files.value.map(f => f.path)) : new Set()
}

function isSelected(file: any): boolean {
  return selectedFiles.value.has(file.path)
}

function joinPath(base: string, name: string) {
  const b = base.endsWith('/') ? base : base + '/'
  return b + name
}

async function createNewFolder() {
  const folderName = newFolderName.value.trim()
  if (!folderName) {
    showNewFolderDialog.value = false
    return
  }
  showNewFolderDialog.value = false
  const targetPath = joinPath(currentPath.value, folderName)
  newFolderName.value = ''
  try {
    await client.value!.createDirectory(targetPath)
    refresh()
    showToast('success', `文件夹 “${folderName}” 创建成功`)
  } catch (err: any) {
    showToast('error', `创建失败：${err.message}`)
  }
}

const showDeleteConfirmDialog = ref(false)
const pendingDeletePaths = ref<string[]>([])
const pendingDeleteCount = computed(() => pendingDeletePaths.value.length)

function deleteSelected() {
  const paths = Array.from(selectedFiles.value)
  if (!paths.length) return
  pendingDeletePaths.value = paths
  showDeleteConfirmDialog.value = true
}
async function confirmDelete() {
  if (!pendingDeletePaths.value.length) return
  showDeleteConfirmDialog.value = false
  const paths = [...pendingDeletePaths.value]
  const count = paths.length
  pendingDeletePaths.value = []
  try {
    const usePostDelete = agentVersion.value?.includes('php-froxlor') ?? false
    if (usePostDelete) {
      await client.value!.deleteFilesPost(paths)
    } else {
      await client.value!.deleteFiles(paths)
    }
    refresh()
    showToast('success', `成功删除 ${count} 个项目`)
  } catch (err: any) {
    showToast('error', `删除失败：${err.message}`)
  }
}
function deleteSingle(file: any) {
  pendingDeletePaths.value = [file.path]
  showDeleteConfirmDialog.value = true
}

function openRenameDialog(file: any) {
  renameTarget.value = file
  newName.value = file.name
  showRenameDialog.value = true
}
function openNewFileEditor() {
  newFileNameEditor.value = ''
  newFileContentEditor.value = ''
  showNewFileEditor.value = true
}

async function doRename() {
  if (!renameTarget.value || !newName.value.trim()) {
    showRenameDialog.value = false
    return
  }
  const oldPath = renameTarget.value.path
  const newNameTrim = newName.value.trim()
  const parent = getParentPath(oldPath)
  const newPath = joinPath(parent, newNameTrim)

  showRenameDialog.value = false
  newName.value = ''

  if (oldPath === newPath) {
    showToast('info', '文件名未改变', 2000)
    return
  }

  try {
    await client.value!.moveFiles({ [oldPath]: newPath })
    refresh()
    showToast('success', `重命名成功：${renameTarget.value.name} → ${newNameTrim}`)
  } catch (err: any) {
    showToast('error', `重命名失败：${err.message}`)
  } finally {
    renameTarget.value = null
  }
}

async function downloadFile(file: any) {
  if (isDirectory(file)) {
    showToast('info','暂不支持下载文件夹')
    return
  }
  try {
    const res = await client.value!.downloadFile(file.path)
    const blob = res.blob; 
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = file.name
    a.click()
    URL.revokeObjectURL(url)
  } catch (err: any) {
    showToast('error',`下载失败: ${err.message}`)
  }
}

const fileInputRef = ref<HTMLInputElement | null>(null)
function triggerUpload() {
  fileInputRef.value?.click()
}

function readBlobAsBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      resolve(result.substring(result.indexOf(',') + 1))
    }
    reader.onerror = () => reject(new Error('文件读取失败'))
    reader.readAsDataURL(blob)
  })
}

async function handleUpload(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  let CHUNK_SIZE = 2 * 1024 * 1024; 
  try {
    const proxyRaw = localStorage.getItem('kisama_proxy_config');
    if (proxyRaw && JSON.parse(proxyRaw).enabled) {
      CHUNK_SIZE = 512 * 1024; 
    }
  } catch (err) {
    console.error(err);
  }

  try {
    loading.value = true 
    isUploading.value = true
    uploadProgress.value = 0
    uploadSpeed.value = '0 B/s'
    currentChunk.value = 0
    totalChunksCount.value = 0

    const totalSize = file.size
    let uploadedBytes = 0

    const uploadTargetPath = currentPath.value

    const useRaw = isVersionGte30(agentVersion.value);
    
    if (file.size <= CHUNK_SIZE) {
      const startTime = performance.now()
      if (useRaw) {
        const res = await client.value!.uploadFileRaw({
          path: uploadTargetPath,
          filename: file.name,
          content: file 
        });
        if (!res || res.status !== 'ok') throw new Error(res?.message || '裸流直传异常');
      } else {
        const base64Content = await readBlobAsBase64(file)
        const res = await client.value!.uploadFile({
          path: uploadTargetPath,
          filename: file.name,
          content: base64Content
        });
        if (!res || res.status !== 'ok') throw new Error(res?.message || '服务器返回异常');
      }
      const endTime = performance.now()
      const duration = (endTime - startTime) / 1000 || 0.001
      uploadSpeed.value = formatBytes(file.size / duration) + '/s'
      uploadProgress.value = 100
      showToast('success', `文件 “${file.name}” 上传成功`)
    } else {
      const totalChunks = Math.ceil(file.size / CHUNK_SIZE)
      totalChunksCount.value = totalChunks
      showToast('info', useRaw ? `大文件自动建立裸字节切片(共 ${totalChunks} 块)...` : `文件较大，正在分块编码上传 (共 ${totalChunks} 块)...`, 3000)

      for (let i = 0; i < totalChunks; i++) {
        currentChunk.value = i + 1
        const start = i * CHUNK_SIZE
        const end = Math.min(start + CHUNK_SIZE, file.size)
        const chunkBlob = file.slice(start, end)
        const currentChunkSize = end - start
        const startTime = performance.now()
        
        if (useRaw) {
          const res = await client.value!.uploadFileRaw({
            path: uploadTargetPath,
            filename: file.name,
            content: chunkBlob, 
            chunk_id: i,             
            total_chunks: totalChunks 
          });
          if (!res || res.status !== 'ok') throw new Error(res?.message || `第 ${i+1} 块裸流分片传输失败`);
        } else {
          const base64Content = await readBlobAsBase64(chunkBlob)
          const res = await client.value!.uploadFile({
            path: uploadTargetPath,
            filename: file.name,
            content: base64Content,
            chunk_id: i,             
            total_chunks: totalChunks 
          });
          if (!res || res.status !== 'ok') throw new Error(res?.message || `第 ${i+1} 块分片传输合并失败`);
        }
        const endTime = performance.now()

        uploadedBytes += currentChunkSize
        uploadProgress.value = Math.round((uploadedBytes / totalSize) * 100)
        const duration = (endTime - startTime) / 1000 || 0.001
        uploadSpeed.value = formatBytes(currentChunkSize / duration) + '/s'
        console.log(`[Upload Channel] ${file.name} - 进度: ${i + 1}/${totalChunks}`)
      }
      showToast('success', `大文件 “${file.name}” 上传并最终安全合并！`)
    }
    refresh() 
  } catch (err: any) {
    showToast('error', `上传失败: ${err.message || '网络或接口故障'}`)
    console.error('Upload Error:', err)
  } finally {
    input.value = '' 
    loading.value = false
    setTimeout(() => { isUploading.value = false }, 1500)
  }
}

async function viewFileContent(file: any) {
  if (isDirectory(file)) return
  if (file.size > 1024 * 1024) {
    showToast('info','文件大于1MB，无法预览')
    return
  }
  try {
    const res = await client.value!.catFile(file.path)
    fileContent.value = res.content
    fileContentPath.value = file.path
    editableContent.value = res.content   
    showFileContentDialog.value = true
  } catch (err: any) {
    showToast('error',`读取失败: ${err.message}`)
  }
}

async function saveAndClosePreview() {
  if (!client.value || !fileContentPath.value) {
    showFileContentDialog.value = false
    return
  }
  const filename = fileContentPath.value.split('/').pop() || 'untitled'
  const targetDir = getParentPath(fileContentPath.value)   
  try {
    const useRaw = isVersionGte30(agentVersion.value);
    if (useRaw) {
      const blob = new Blob([editableContent.value], { type: 'text/plain;charset=utf-8' });
      const res = await client.value!.uploadFileRaw({
        path: targetDir,
        filename: filename,
        content: blob
      });
      if (!res || res.status !== 'ok') throw new Error(res?.message || '保存裸数据异常');
    } else {
      const base64Content = btoa(unescape(encodeURIComponent(editableContent.value)))
      const res = await client.value!.uploadFile({
        path: targetDir,
        filename: filename,
        content: base64Content
      });
      if (!res || res.status !== 'ok') throw new Error(res?.message || '服务器保存失败');
    }
    showToast('success', `文件 “${filename}” 保存成功`)
    refresh()                    
    showFileContentDialog.value = false
  } catch (err: any) {
    showToast('error',`保存失败: ${err.message}`)
  }
}

function cancelPreviewEdit() {
  showFileContentDialog.value = false
}

async function openPermissionDialog(file: any) {
  permissionTarget.value = file
  showPermissionDialog.value = true
  isQueryingAuth.value = true
  permissionMode.value = ''
  authDetails.value = {}

  try {
    if (!client.value) return
    const res = await client.value.queryFileAuthority([file.path])
    if (res.status === 'ok' && res.files && res.files.length > 0) {
      const info = res.files[0]
      if (info.mode_octal) {
        permissionMode.value = info.mode_octal.replace(/^0o/, '')
      } else {
        const match = info.mode.match(/[0-7]{3,4}$/)
        permissionMode.value = match ? match[0] : '644'
      }
      authDetails.value = {
        readable: info.readable,
        writable: info.writable,
        executable: info.executable
      }
    }
  } catch (err: any) {
    console.error('获取权限详情失败:', err)
    const match = file.mode.match(/[0-7]{3,4}$/)
    permissionMode.value = match ? match[0] : '644'
  } finally {
    isQueryingAuth.value = false
  }
}

async function doSetPermission() {
  const target = permissionTarget.value
  const mode = permissionMode.value.trim()
  if (!target || !mode) {
    showPermissionDialog.value = false
    return
  }
  showPermissionDialog.value = false
  try {
    await client.value!.setFileAuthority({ [target.path]: mode })
    refresh()
    showToast('success', `权限设置成功：${target.name} → ${mode}`)
  } catch (err: any) {
    showToast('error', `权限设置失败：${err.message}`)
  }
}

async function openCutDialog() {
  if (selectedFiles.value.size === 0) return
  cutTargets.value = files.value.filter(f => selectedFiles.value.has(f.path))
  cutState.value = { currentPath: currentPath.value, dirs: [], selectedDest: '' }
  await loadDirsForPicker(cutState.value.currentPath, cutState)
  cutState.value.selectedDest = cutState.value.currentPath
  showCutDialog.value = true
}

async function doCut() {
  if (!cutState.value.selectedDest || cutTargets.value.length === 0) {
    showCutDialog.value = false
    return
  }
  const targets = [...cutTargets.value]
  const dest = cutState.value.selectedDest
  showCutDialog.value = false
  selectedFiles.value.clear()

  const mappings: Record<string, string> = {}
  for (const file of targets) {
    const destPath = joinPath(dest, file.name)
    if (file.path === destPath) {
      showToast('info', '源路径与目标路径相同，操作取消', 2000)
      return
    }
    mappings[file.path] = destPath
  }
  try {
    await client.value!.moveFiles(mappings)
    refresh()
    showToast('success', `成功剪切 ${targets.length} 个项目到 ${dest}`)
  } catch (err: any) {
    showToast('error', `剪切失败：${err.message}`)
  }
}

async function openCopyDialog() {
  if (selectedFiles.value.size === 0) return
  copyTargets.value = files.value.filter(f => selectedFiles.value.has(f.path))
  copyState.value = { currentPath: currentPath.value, dirs: [], selectedDest: '' }
  await loadDirsForPicker(copyState.value.currentPath, copyState)
  copyState.value.selectedDest = copyState.value.currentPath
  showCopyDialog.value = true
}

function generateCopyName(baseName: string, existingNames: string[]): string {
  const lastDotIndex = baseName.lastIndexOf('.')
  const nameWithoutExt = lastDotIndex > 0 ? baseName.slice(0, lastDotIndex) : baseName
  const ext = lastDotIndex > 0 ? baseName.slice(lastDotIndex) : ''
  let copyName = `${nameWithoutExt}_copy${ext}`
  let counter = 2
  while (existingNames.includes(copyName)) {
    copyName = `${nameWithoutExt}_copy${counter}${ext}`
    counter++
  }
  return copyName
}

async function doCopy() {
  if (!copyState.value.selectedDest || copyTargets.value.length === 0) {
    showCopyDialog.value = false
    return
  }
  const targets = [...copyTargets.value]
  const destDir = copyState.value.selectedDest
  showCopyDialog.value = false
  selectedFiles.value.clear()

  try {
    const destRes = await client.value!.listFiles(destDir, false)
    const existingNames = (destRes.files || []).map(f => f.name)
    const mappings: Record<string, string> = {}

    for (const file of targets) {
      let destName = file.name
      if (file.path === joinPath(destDir, file.name)) {
        destName = generateCopyName(file.name, existingNames)
        existingNames.push(destName)
      }
      mappings[file.path] = joinPath(destDir, destName)
    }
    await client.value!.copyFiles(mappings)
    refresh()
    showToast('success', `成功复制 ${targets.length} 个项目到 ${destDir}`)
  } catch (err: any) {
    showToast('error', `复制失败：${err.message}`)
  }
}

function close() {
  emit('update:visible', false)
  emit('close')
}

watch(() => props.visible, async (val) => {
  if (val) {
    const currentDomain = props.node.domain
    if (lastNodeDomain.value !== currentDomain) {
      files.value = []
      currentPath.value = './'
      pathHistory.value = ['./']
      selectedFiles.value.clear()
      agentVersion.value = ''
      lastNodeDomain.value = currentDomain 
      await initClient()
      loadFiles('./')
    } else {
      await initClient()
      loadFiles(currentPath.value)
    }
  }
}, { immediate: true })

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}
async function openCutDialogForSingle(file: any) {
  if (!client.value) return
  cutTargets.value = [file]
  cutState.value = { currentPath: currentPath.value, dirs: [], selectedDest: '' }
  await loadDirsForPicker(cutState.value.currentPath, cutState)
  cutState.value.selectedDest = cutState.value.currentPath
  showCutDialog.value = true
}
function handleCutGoUp() { goUpForPicker(cutState) }
function handleCutEnterDir(path: string) { enterDirForPicker(path, cutState) }
function handleCopyGoUp() { goUpForPicker(copyState) }
function handleCopyEnterDir(path: string) { enterDirForPicker(path, copyState) }
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="visible" class="filemanager-overlay" @click.self="close">
        <div class="filemanager-modal">
          <div class="fm-header">
            <div class="fm-title">
              <span class="icon">📁</span>
              <span>{{ node.name }} - 文件管理</span>
            </div>
            <button class="close-btn" @click="close">✕</button>
          </div>

          <div class="fm-toolbar">
            <button @click="goBack" :disabled="currentPath === './' || currentPath === '.'" title="返回上级">⬅️</button>
            <button @click="refresh" title="刷新">🔄</button>
            <button @click="showNewFolderDialog = true" title="新建文件夹">📂+</button>
            <button @click="openNewFileEditor" title="新建文件">📄+</button>
            <button @click="triggerUpload" title="上传文件">⬆️</button>
            <button @click="deleteSelected" :disabled="selectedFiles.size === 0" title="删除">🗑️</button>
            <button @click="openCopyDialog" :disabled="selectedFiles.size === 0" title="复制到...">📋</button>
            <button @click="openCutDialog" :disabled="selectedFiles.size === 0" title="剪切到...">✂️</button>
            <span class="spacer"></span>
            <div class="breadcrumb">
              <template v-for="(part, idx) in pathHistory" :key="idx">
                <span @click="loadFiles(part)" class="crumb">
                  {{ part === './' || part === '.' ? '.' : (part === '/' ? '根目录' : part.split('/').pop() || part) }}
                </span>
                <span v-if="idx < pathHistory.length - 1" class="separator">/</span>
              </template>
            </div>
          </div>

          <div class="fm-content">
            <table class="file-table">
              <thead>
                <tr>
                  <th style="width: 30px">
                    <input type="checkbox"
                      :indeterminate="selectedFiles.size > 0 && selectedFiles.size < files.length"
                      :checked="selectedFiles.size === files.length && files.length > 0"
                      @change="toggleSelectAll"
                    >
                  </th>
                  <th @click="sortKey = 'name'; sortAsc = !sortAsc" style="width: 60%">名称 {{ sortKey === 'name' ? (sortAsc ? '↑' : '↓') : '' }}</th>
                  <th @click="sortKey = 'size'; sortAsc = !sortAsc" style="width: 90px">大小</th>
                  <th @click="sortKey = 'mode'; sortAsc = !sortAsc" style="width: 90px">权限</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="file in sortedFiles" :key="file.path" :class="{ selected: isSelected(file) }" @click="toggleSelect(file)" @dblclick="isDirectory(file) ? enterDirectory(file.path) : openPreview(file)">
                  <td><input type="checkbox" :checked="isSelected(file)" @click.stop="toggleSelect(file)"></td>
                  <td class="file-name-cell" :title="file.name">
                    <span :class="['file-icon', isDirectory(file) ? 'dir' : 'file']">
                      {{ isDirectory(file) ? '📁' : '📄' }}
                    </span>
                    {{ file.name }}
                  </td>
                  <td>{{ isDirectory(file) ? '-' : formatBytes(file.size) }}</td>
                  <td>{{ file.mode }}</td>
                  <td>
                    <button class="action-btn" @click.stop="openRenameDialog(file)">✏️</button>
                    <button class="action-btn" @click.stop="downloadFile(file)" v-if="!isDirectory(file)">⬇️</button>
                    <button class="action-btn" @click.stop="openPreview(file)" v-if="!isDirectory(file)">👁️</button>
                    <button class="action-btn" @click.stop="openPermissionDialog(file)">🔒</button>
                    <button class="action-btn" @click.stop="openCutDialogForSingle(file)">✂️</button>
                    <button class="action-btn delete-btn" @click.stop="deleteSingle(file)" title="删除">🗑️</button>
                  </td>
                </tr>
                <tr v-if="files.length === 0 && !loading">
                  <td colspan="5" class="empty-msg">目录为空</td>
                </tr>
              </tbody>
            </table>
            <div v-if="loading" class="loading-indicator">加载中...</div>
          </div>
          <div v-if="isUploading" class="upload-progress-wrapper">
            <div class="upload-progress-bar" :style="{ width: uploadProgress + '%' }"></div>
            <span class="upload-progress-percent">{{ uploadProgress }}%</span>
          </div>

          <div class="fm-footer">
            <span>{{ files.length }} 个项目</span>
            <span v-if="selectedFiles.size > 0">已选择 {{ selectedFiles.size }} 项</span>
            <div v-if="isUploading" class="upload-status-metrics">
              <span v-if="totalChunksCount > 0" class="chunk-badge">
                📦 分块: {{ currentChunk }} / {{ totalChunksCount }}
              </span>
              <span class="speed-badge">⚡ {{ uploadSpeed }}</span>
            </div>
            <span class="encryption-status" :class="{ encrypted: client?.Encryption }">
              {{ encryptionStatus }}
            </span>
          </div>
        </div>
      </div>
    </Transition>

    <DialogModal v-model="showNewFileEditor" title="新建文件" width="large">
      <div class="preview-dialog-body">
        <div class="file-info" style="display: flex; align-items: center; gap: 15px; background: var(--surface-2); color: var(--text-soft);">
          <span style="font-weight: bold; white-space: nowrap;">📄 文件名:</span>
          <input v-model="newFileNameEditor" placeholder="例如: script.py 或 readme.md" style="flex: 1; height: 40px; font-size: 1rem; margin: 0; padding: 0 12px; border: 1px solid var(--border-strong); background: var(--btn-bg); color: var(--text);" />
        </div>
        <div class="editable-badge">✍️ 正在当前目录创建新文件</div>
        <div class="preview-content">
          <textarea v-model="newFileContentEditor" class="editable-textarea" placeholder="在此输入文件内容..." spellcheck="false"></textarea>
        </div>
      </div>
      <template #actions>
        <button class="btn secondary" @click="showNewFileEditor = false">取消</button>
        <button class="btn primary" @click="saveNewFile">创建并保存</button>
      </template>
    </DialogModal>
    
    <DialogModal v-model="showNewFolderDialog" title="新建文件夹" @confirm="createNewFolder">
      <div class="rename-dialog-body"><input v-model="newFolderName" placeholder="请输入文件夹名称" autofocus @keyup.enter="createNewFolder" /></div>
    </DialogModal>
    
    <DialogModal v-model="showRenameDialog" title="重命名" @confirm="doRename">
      <div class="rename-dialog-body"><input v-model="newName" placeholder="请输入新名称" autofocus /></div>
    </DialogModal>

    <DialogModal v-model="showPermissionDialog" title="设置权限" @confirm="doSetPermission">
      <div class="permission-dialog-body">
        <div class="file-info"><span>当前项目：</span><code>{{ permissionTarget?.path }}</code></div>
        <div class="input-group">
          <label>八进制权限（Octal）</label>
          <input v-model="permissionMode" :placeholder="isQueryingAuth ? '正在同步云端权限...' : '例如：755 或 644'" :disabled="isQueryingAuth" autofocus />
        </div>
        <div v-if="!isQueryingAuth" class="status-tags">
          <div :class="['tag', authDetails.readable ? 'ok' : 'no']">{{ authDetails.readable ? '✔ 可读' : '✘ 不可读' }}</div>
          <div :class="['tag', authDetails.writable ? 'ok' : 'no']">{{ authDetails.writable ? '✔ 可写' : '✘ 不可写' }}</div>
          <div :class="['tag', authDetails.executable ? 'ok' : 'no']">{{ authDetails.executable ? '✔ 可执行' : '✘ 不可执行' }}</div>
        </div>
      </div>
    </DialogModal>

    <DialogModal v-model="showFileContentDialog" :title="previewTitle" width="large">
      <div class="preview-dialog-body">
        <div class="preview-content">
          <textarea v-if="isPreviewEditable" v-model="editableContent" class="editable-textarea" spellcheck="false"></textarea>
          <pre v-else>{{ fileContent }}</pre>
        </div>
      </div>
      <template #actions v-if="isPreviewEditable">
        <button class="btn secondary" @click="cancelPreviewEdit">取消</button>
        <button class="btn primary" @click="saveAndClosePreview">保存并关闭</button>
      </template>
      <template #actions v-else>
        <button class="btn primary" @click="showFileContentDialog = false">关闭</button>
      </template>
    </DialogModal>
    
    <DialogModal v-model="showDeleteConfirmDialog" title="确认删除" @confirm="confirmDelete" confirm-text="删除">
      <div class="delete-confirm-body">
        <p class="warning-icon">⚠️</p>
        <p>确定要删除 <strong>{{ pendingDeleteCount }}</strong> 个项目吗？</p>
        <p class="warning-text">此操作不可撤销。</p>
      </div>
    </DialogModal>
    
    <DialogModal v-model="showCutDialog" title="选择目标目录" width="large" @confirm="doCut" confirm-text="移动到此处">
      <div class="picker-content">
        <div class="nav-bar">
          <button @click="handleCutGoUp" :disabled="cutState.currentPath === './'">⬆️ 上级目录</button>
          <span class="path-display">{{ cutState.currentPath }}</span>
        </div>
        <div class="dir-list">
          <div v-for="dir in cutState.dirs" :key="dir.path" class="dir-item" :class="{ selected: cutState.selectedDest === dir.path }" @click="cutState.selectedDest = dir.path" @dblclick="handleCutEnterDir(dir.path)">
            <span>📁 {{ dir.name }}</span>
          </div>
        </div>
      </div>
    </DialogModal>

    <DialogModal v-model="showCopyDialog" title="复制到目录" width="large" @confirm="doCopy" confirm-text="复制到此处">
      <div class="picker-content">
        <div class="nav-bar">
          <button @click="handleCopyGoUp" :disabled="copyState.currentPath === './'">⬆️ 上级目录</button>
          <span class="path-display">{{ copyState.currentPath }}</span>
        </div>
        <div class="dir-list">
          <div v-for="dir in copyState.dirs" :key="dir.path" class="dir-item" :class="{ selected: copyState.selectedDest === dir.path }" @click="copyState.selectedDest = dir.path" @dblclick="handleCopyEnterDir(dir.path)">
            <span>📁 {{ dir.name }}</span>
          </div>
        </div>
      </div>
    </DialogModal>
    <FileViewer v-model="showFileViewer" :src="viewerSrc" :name="viewerName" :kind="viewerKind" />
    <input type="file" ref="fileInputRef" style="display: none" @change="handleUpload" />
  </Teleport>
</template>

<style scoped>
/* 保持原有文件管理表格与弹窗样式，已剔除 .global-toast 等样式块 */
.filemanager-overlay { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.5); backdrop-filter: blur(8px); display: flex; align-items: center; justify-content: center; z-index: 1001; padding: 40px; }
.filemanager-modal { width: 100%; max-width: 1100px; height: 80vh; background: var(--card); border-radius: 16px; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25); display: flex; flex-direction: column; overflow: hidden; border: 1px solid var(--border); color: var(--text); }
.fm-header { display: flex; justify-content: space-between; align-items: center; padding: 18px 24px; background: var(--header-bg); border-bottom: 1px solid var(--border); }
.fm-title { font-size: 1.1rem; font-weight: 700; color: var(--text); display: flex; align-items: center; gap: 10px; }
.fm-toolbar { display: flex; align-items: center; gap: 10px; padding: 12px 24px; background: var(--surface-2); border-bottom: 1px solid var(--border); }
.fm-toolbar button { height: 36px; padding: 0 14px; border: 1px solid var(--border); border-radius: 8px; background: var(--btn-bg); color: var(--text-soft); cursor: pointer; font-size: 0.9rem; transition: all 0.2s; display: flex; align-items: center; justify-content: center; }
.fm-toolbar button:hover:not(:disabled) { background: var(--surface-3); border-color: var(--border-strong); color: var(--text); }
.breadcrumb { display: flex; align-items: center; gap: 6px; font-size: 0.9rem; background: var(--card); padding: 4px 12px; border-radius: 20px; border: 1px solid var(--border); color: var(--text-soft); }
.fm-content { flex: 1; overflow-y: auto; }
.file-table { width: 100%; table-layout: fixed; border-collapse: separate; border-spacing: 0; }
.file-table th { position: sticky; top: 0; z-index: 10; text-align: left; padding: 14px 16px; background: var(--surface-2); font-weight: 600; color: var(--muted); font-size: 0.85rem; border-bottom: 1px solid var(--border); text-transform: uppercase; letter-spacing: 0.05em; }
.file-table td { padding: 12px 16px; border-bottom: 1px solid var(--border); color: var(--text-soft); font-size: 0.95rem; }
.file-table tr:hover { background: var(--hover-bg); }
.file-table tr.selected { background: var(--chip-syncing-bg); }
.action-btn { padding: 6px; border-radius: 6px; transition: background 0.2s; border: none; background: transparent; cursor: pointer; color: var(--muted); }
.action-btn:hover { background: var(--surface-3); }
:deep(.dialog-body input), :deep(.dialog-content input) { width: 100%; height: 56px; padding: 0 24px; font-size: 1.25rem; font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace; color: var(--text); background-color: var(--surface-2); border: 2px solid var(--border); border-radius: 12px; transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); box-sizing: border-box; margin: 12px 0; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05); }
:deep(.dialog-body input:focus), :deep(.dialog-content input:focus) { background-color: var(--btn-bg); border-color: var(--primary); box-shadow: 0 0 0 5px rgba(59, 130, 246, 0.2); transform: translateY(-2px); }
.rename-dialog-body { padding: 32px 0 20px; min-width: 460px; text-align: center; }
.rename-dialog-body input { height: 64px !important; font-size: 1.35rem !important; font-weight: 600; text-align: center; }
.permission-dialog-body { padding: 24px 0; min-width: 480px; }
.permission-dialog-body .input-group { margin-bottom: 28px; }
.permission-dialog-body .input-group label { display: block; font-size: 1.1rem; font-weight: 700; color: var(--text-soft); margin-bottom: 10px; margin-left: 4px; }
.permission-dialog-body input { height: 68px !important; font-size: 1.85rem !important; font-weight: 700; letter-spacing: 8px; text-align: center; background-color: var(--surface-3); }
.file-info { background: var(--surface-3); padding: 16px 20px; border-radius: 12px; border-left: 5px solid var(--muted); font-size: 0.95rem; line-height: 1.6; word-break: break-all; margin-bottom: 24px; display: flex; align-items: center; gap: 10px; color: var(--text-soft); }
.file-info::before { content: "📍"; font-size: 1.3rem; }
.file-info code { color: var(--text-strong); font-weight: 700; background: var(--surface-2); padding: 3px 8px; border-radius: 6px; font-size: 1rem; }
.status-tags { display: flex; gap: 14px; margin-top: 24px; justify-content: space-between; }
.tag { flex: 1; text-align: center; font-size: 1.05rem; font-weight: 700; padding: 16px 0; border-radius: 12px; border: 2px solid transparent; display: flex; align-items: center; justify-content: center; gap: 8px; transition: all 0.25s ease; }
.tag.ok { background-color: var(--chip-online-bg); color: var(--chip-online-text); border-color: var(--chip-online-border); }
.tag.no { background-color: var(--chip-offline-bg); color: var(--chip-offline-text); border-color: var(--chip-offline-border); }
.preview-dialog-body { height: 100%; box-sizing: border-box; padding: 8px 0 20px; display: flex; flex-direction: column; gap: 16px; min-width: 1050px; }
.editable-badge { background: var(--chip-online-bg); color: var(--chip-online-text); font-size: 0.95rem; font-weight: 700; padding: 6px 14px; border-radius: 9999px; display: inline-flex; align-items: center; gap: 6px; width: fit-content; border: 1px solid var(--chip-online-border); }
.preview-content { flex: 1; min-height: 0; display: flex; flex-direction: column; background: #0f172a; border-radius: 12px; border: 2px solid #1e2937; padding: 4px; overflow: hidden; box-shadow: inset 0 4px 12px rgba(0, 0, 0, 0.3); }
.preview-content pre { flex: 1; min-height: 0; margin: 0; padding: 20px; background: transparent; color: #e2e8f0; font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace; font-size: 1.05rem; line-height: 1.65; white-space: pre-wrap; word-break: break-all; overflow-y: auto; }
.editable-textarea { flex: 1; min-height: 0; width: 100%; padding: 20px; background: transparent; color: #e2e8f0; font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace; font-size: 1.05rem; line-height: 1.65; border: none; border-radius: 8px; outline: none; resize: none; overflow-y: auto; box-shadow: none; }
.preview-content pre::-webkit-scrollbar, .editable-textarea::-webkit-scrollbar { width: 8px; height: 8px; }
.preview-content pre::-webkit-scrollbar-thumb, .editable-textarea::-webkit-scrollbar-thumb { background: #64748b; border-radius: 10px; }
.preview-content pre::-webkit-scrollbar-track, .editable-textarea::-webkit-scrollbar-track { background: #1e2937; }
.preview-content pre:empty::before { content: '文件内容为空'; color: var(--muted); font-style: italic; display: block; text-align: center; padding: 80px 0; }
.empty-msg { text-align: center; padding: 60px 0; color: var(--muted); }
.fm-footer { padding: 12px 24px; background: var(--header-bg); border-top: 1px solid var(--border); font-size: 0.85rem; color: var(--muted); display: flex; justify-content: space-between; }
.spacer { flex-grow: 1; min-width: 20px; }
.breadcrumb .crumb { padding: 4px 10px; border-radius: 6px; cursor: pointer; transition: all 0.2s; }
.breadcrumb .crumb:hover { background: var(--chip-syncing-bg); color: var(--chip-syncing-text); }
.breadcrumb .crumb:last-child { font-weight: 600; color: var(--text); }
.fm-toolbar button[disabled] { opacity: 0.45; cursor: not-allowed; background-color: var(--surface-3); color: var(--muted); border-color: var(--border); box-shadow: none; }
.fm-toolbar button[disabled]:hover { background-color: var(--surface-3); transform: none; }
.picker-content { height: 100%; box-sizing: border-box; display: flex; flex-direction: column; }
.dir-list { flex: 1; min-height: 0; overflow-y: auto; border: 2px solid var(--border); border-radius: 12px; background: var(--card); margin-top: 10px; }
.dir-item { padding: 14px 18px; cursor: pointer; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 12px; transition: all 0.2s ease; color: var(--text-soft); font-size: 0.95rem; }
.dir-item:hover { background-color: var(--surface-3); }
.dir-list .dir-item.selected { background-color: var(--chip-syncing-bg) !important; color: var(--primary) !important; border-left: 4px solid var(--primary) !important; font-weight: 600; padding-left: 22px; }
.dir-item span { pointer-events: none; }
.delete-confirm-body { text-align: center; padding: 20px 0; }
.action-btn.delete-btn:hover { background: var(--hover-tint-red); color: var(--chip-error-text); }
.warning-icon { font-size: 3rem; margin-bottom: 10px; }
.warning-text { color: var(--chip-error-text); font-size: 0.9rem; margin-top: 10px; }
.close-btn { background: transparent; border: none; font-size: 1.5rem; cursor: pointer; color: var(--muted); padding: 6px; border-radius: 8px; line-height: 1; display: inline-flex; align-items: center; justify-content: center; transition: background-color 0.2s ease; }
.close-btn:hover { background-color: var(--surface-3); }
.close-btn:active { background-color: var(--border-strong); }
.encryption-status { margin-left: auto; font-weight: 500; }
.encryption-status.encrypted { color: var(--success); }
.file-name-cell { cursor: pointer; user-select: text; -webkit-user-select: text; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.file-name-text { cursor: inherit; }
.upload-progress-wrapper { position: relative; width: 100%; height: 6px; background: var(--surface-3); overflow: hidden; }
.upload-progress-bar { height: 100%; background: linear-gradient(90deg, var(--primary), #60a5fa); transition: width 0.2s cubic-bezier(0.4, 0, 0.2, 1); }
.upload-progress-percent { position: absolute; right: 16px; top: -18px; font-size: 0.75rem; font-weight: 700; color: var(--primary); background: var(--card); padding: 0 4px; border-radius: 4px; box-shadow: 0 1px 2px rgba(0,0,0,0.05); }
.upload-status-metrics { display: flex; align-items: center; gap: 12px; margin-left: 20px; }
.chunk-badge { background: var(--surface-3); color: var(--text-soft); padding: 2px 8px; border-radius: 6px; font-size: 0.8rem; font-weight: 600; border: 1px solid var(--border); }
.speed-badge { background: var(--chip-syncing-bg); color: var(--chip-syncing-text); padding: 2px 8px; border-radius: 6px; font-size: 0.8rem; font-weight: 600; border: 1px solid var(--chip-syncing-border); }
</style>