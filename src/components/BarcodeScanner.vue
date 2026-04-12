<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { Capacitor } from '@capacitor/core'
import { BarcodeScanner as NativeBarcodeScanner } from '@capacitor-mlkit/barcode-scanning'

type DetectedBarcode = { rawValue?: string }
type DetectorInstance = {
  detect: (source: HTMLVideoElement) => Promise<DetectedBarcode[]>
}
type DetectorConstructor = new (options?: { formats?: string[] }) => DetectorInstance

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  close: []
  scanned: [barcode: string]
}>()

const videoRef = ref<HTMLVideoElement | null>(null)
const manualBarcode = ref('')
const errorMessage = ref('')
const isStarting = ref(false)
const permissionDenied = ref(false)
const hasActivePreview = ref(false)
const isNativePlatform = computed(() => Capacitor.isNativePlatform())
const supportsCamera = computed(() => Boolean(navigator.mediaDevices?.getUserMedia))
const supportsBarcodeDetection = computed(() => {
  const barcodeDetector = (window as Window & { BarcodeDetector?: DetectorConstructor }).BarcodeDetector
  return Boolean(barcodeDetector)
})
const showCameraPreview = computed(
  () => !isNativePlatform.value && supportsCamera.value && supportsBarcodeDetection.value && !permissionDenied.value,
)
const statusTone = computed(() => {
  const message = errorMessage.value.toLowerCase()

  if (message.includes('valid barcode')) return 'danger'
  if (message.includes('not supported')) return 'warning'
  if (message.includes('permission') || message.includes('unable')) return 'danger'
  return 'info'
})

let activeStream: MediaStream | null = null
let detector: DetectorInstance | null = null
let scanTimer: number | null = null
let sessionToken = 0

function normalizeBarcode(value: string) {
  return value.replace(/\D/g, '')
}

function stopScanLoop() {
  if (scanTimer !== null) {
    window.clearTimeout(scanTimer)
    scanTimer = null
  }
}

function stopStream() {
  stopScanLoop()
  hasActivePreview.value = false

  if (activeStream) {
    activeStream.getTracks().forEach((track) => track.stop())
    activeStream = null
  }

  if (videoRef.value) {
    videoRef.value.srcObject = null
  }
}

function closeScanner() {
  stopStream()
  errorMessage.value = ''
  manualBarcode.value = ''
  permissionDenied.value = false
  emit('close')
}

async function openCameraSettings() {
  if (!isNativePlatform.value) return

  try {
    await NativeBarcodeScanner.openSettings()
  } catch {
    errorMessage.value = 'Unable to open settings. Enable camera permission for this app manually.'
  }
}

async function detectLoop(localToken: number) {
  if (!props.open || localToken !== sessionToken) return

  const videoElement = videoRef.value
  if (!videoElement || !detector || videoElement.readyState < 2) {
    scanTimer = window.setTimeout(() => {
      void detectLoop(localToken)
    }, 250)
    return
  }

  try {
    const barcodes = await detector.detect(videoElement)
    const barcode = normalizeBarcode(barcodes[0]?.rawValue ?? '')

    if (barcode) {
      stopStream()
      manualBarcode.value = ''
      errorMessage.value = ''
      emit('scanned', barcode)
      return
    }
  } catch {
    errorMessage.value = 'Camera is on, but barcode detection is unavailable on this device.'
  }

  scanTimer = window.setTimeout(() => {
    void detectLoop(localToken)
  }, 350)
}

async function startScanner() {
  sessionToken += 1
  const localToken = sessionToken
  stopStream()
  errorMessage.value = ''
  manualBarcode.value = ''
  permissionDenied.value = false

  if (isNativePlatform.value) {
    await startNativeScan()
    return
  }

  if (!supportsCamera.value) {
    errorMessage.value = 'Camera access is not available. Enter the barcode manually.'
    return
  }

  if (!supportsBarcodeDetection.value) {
    errorMessage.value = 'Automatic barcode detection is not supported here. Enter the barcode manually.'
    return
  }

  isStarting.value = true

  try {
    const barcodeDetector = (window as Window & { BarcodeDetector?: DetectorConstructor }).BarcodeDetector
    detector = barcodeDetector ? new barcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'] }) : null

    activeStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
      },
    })

    if (!props.open || localToken !== sessionToken) {
      stopStream()
      return
    }

    if (videoRef.value) {
      videoRef.value.srcObject = activeStream
      await videoRef.value.play()
      hasActivePreview.value = true
    }

    void detectLoop(localToken)
  } catch (error) {
    const domError = error as DOMException | null
    const denied = domError?.name === 'NotAllowedError' || domError?.name === 'PermissionDeniedError'

    if (denied) {
      permissionDenied.value = true
      errorMessage.value = 'Camera permission is blocked. Open app settings and allow camera access.'
    } else {
      errorMessage.value = 'Unable to start the camera. Check camera permission or enter the barcode manually.'
    }

    stopStream()
  } finally {
    isStarting.value = false
  }
}

async function startNativeScan() {
  isStarting.value = true

  try {
    const permissionStatus = await NativeBarcodeScanner.requestPermissions()
    if (permissionStatus.camera !== 'granted' && permissionStatus.camera !== 'limited') {
      permissionDenied.value = true
      errorMessage.value = 'Camera permission is blocked. Open app settings and allow camera access.'
      return
    }

    const supportResult = await NativeBarcodeScanner.isSupported()
    if (!supportResult.supported) {
      errorMessage.value = 'Barcode scanning is not supported on this device.'
      return
    }

    const scanResult = await NativeBarcodeScanner.scan()
    const barcode = normalizeBarcode(scanResult.barcodes[0]?.rawValue ?? '')

    if (!barcode) {
      errorMessage.value = 'No barcode detected. Try again or enter manually.'
      return
    }

    emit('scanned', barcode)
  } catch {
    errorMessage.value = 'Unable to start native barcode scan. Enter the barcode manually.'
  } finally {
    isStarting.value = false
  }
}

function submitManualBarcode() {
  const barcode = normalizeBarcode(manualBarcode.value)
  if (!barcode) {
    errorMessage.value = 'Enter a valid barcode.'
    return
  }

  stopStream()
  manualBarcode.value = ''
  errorMessage.value = ''
  emit('scanned', barcode)
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      void startScanner()
      return
    }

    stopStream()
    errorMessage.value = ''
    manualBarcode.value = ''
    permissionDenied.value = false
  },
)

onBeforeUnmount(() => {
  stopStream()
})
</script>

<template>
  <Transition name="modal">
    <div v-if="open" class="scanner-backdrop" @click.self="closeScanner">
      <div class="scanner-sheet">
        <div class="scanner-header">
          <div>
            <strong>Scan barcode</strong>
            <p>Point the camera at the code or type it manually.</p>
          </div>
          <button type="button" class="scanner-close" @click="closeScanner">Done</button>
        </div>

        <div v-if="!isNativePlatform && showCameraPreview" class="scanner-frame">
          <video ref="videoRef" class="scanner-video" playsinline muted />
          <div v-if="hasActivePreview" class="scanner-guide"></div>
          <div v-if="isStarting" class="scanner-status">Starting camera...</div>
          <div v-else-if="errorMessage" class="scanner-status" :class="`scanner-status--${statusTone}`">
            <p>{{ errorMessage }}</p>
            <div v-if="permissionDenied" class="scanner-status-actions">
              <button v-if="isNativePlatform" type="button" class="scanner-status-btn" @click="openCameraSettings">Open settings</button>
              <button type="button" class="scanner-status-btn scanner-status-btn--ghost" @click="startScanner">Try again</button>
            </div>
          </div>
        </div>

        <div v-else-if="isStarting || errorMessage" class="scanner-native-status">
          <p v-if="isStarting">Starting camera...</p>
          <div v-else class="scanner-status scanner-status--inline" :class="`scanner-status--${statusTone}`">
            <p>{{ errorMessage }}</p>
            <div v-if="permissionDenied" class="scanner-status-actions">
              <button v-if="isNativePlatform" type="button" class="scanner-status-btn" @click="openCameraSettings">Open settings</button>
              <button type="button" class="scanner-status-btn scanner-status-btn--ghost" @click="startScanner">Try again</button>
            </div>
          </div>
        </div>

        <div class="scanner-manual">
          <label for="barcode-input">Manual barcode</label>
          <div class="scanner-manual-row">
            <input
              id="barcode-input"
              v-model="manualBarcode"
              type="text"
              inputmode="numeric"
              autocomplete="off"
              placeholder="5941234567890"
              @keydown.enter.prevent="submitManualBarcode"
            />
            <button type="button" class="scanner-submit" @click="submitManualBarcode">Use code</button>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.scanner-backdrop {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: 16px;
  background: rgba(15, 23, 42, 0.42);
}

.scanner-sheet {
  width: min(100%, 560px);
  border-radius: 22px;
  background: #f6f8f7;
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.22);
  overflow: hidden;
}

.scanner-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 18px 18px 10px;
}

.scanner-header strong {
  display: block;
  font-size: 1rem;
  color: #0f172a;
}

.scanner-header p {
  margin-top: 4px;
  font-size: 0.8125rem;
  color: #64748b;
}

.scanner-close {
  flex-shrink: 0;
  padding: 8px 10px;
  border-radius: 10px;
  background: transparent;
  color: #1a7a48;
  font-size: 0.875rem;
  font-weight: 600;
}

.scanner-frame {
  position: relative;
  aspect-ratio: 4 / 3;
  margin: 0 18px;
  border-radius: 18px;
  background: #0f172a;
  overflow: hidden;
}

.scanner-video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.scanner-guide {
  position: absolute;
  inset: 22% 12%;
  border: 2px solid rgba(48, 232, 140, 0.92);
  border-radius: 18px;
  box-shadow: 0 0 0 999px rgba(15, 23, 42, 0.22);
}

.scanner-status {
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid rgba(48, 232, 140, 0.32);
  background: #ecf9f1;
  color: #1a7a48;
  font-size: 0.8125rem;
  text-align: center;
}

.scanner-status--warning {
  border-color: rgba(245, 158, 11, 0.45);
  background: #fff7e6;
  color: #9a6700;
}

.scanner-status--danger {
  border-color: rgba(239, 68, 68, 0.4);
  background: #fff1f1;
  color: #b42318;
}

.scanner-frame .scanner-status {
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: 12px;
  background: rgba(236, 249, 241, 0.94);
  backdrop-filter: blur(6px);
}

.scanner-status--inline {
  position: static;
}

.scanner-status p {
  margin: 0;
}

.scanner-status-actions {
  display: flex;
  justify-content: center;
  gap: 8px;
  margin-top: 10px;
}

.scanner-status-btn {
  padding: 6px 10px;
  border-radius: 8px;
  background: #30e88c;
  color: #112119;
  font-size: 0.75rem;
  font-weight: 700;
}

.scanner-status-btn--ghost {
  background: rgba(26, 122, 72, 0.12);
  color: #1a7a48;
}

.scanner-native-status {
  margin: 0 18px;
  padding: 10px 0;
}

.scanner-native-status > p {
  margin: 0;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid rgba(48, 232, 140, 0.32);
  background: #ecf9f1;
  color: #1a7a48;
  font-size: 0.8125rem;
  text-align: center;
}

.scanner-manual {
  padding: 14px 18px calc(var(--safe-bottom) + 12px);
}

.scanner-manual label {
  display: block;
  margin-bottom: 8px;
  font-size: 0.8125rem;
  font-weight: 600;
  color: #334155;
}

.scanner-manual-row {
  display: flex;
  gap: 8px;
}

.scanner-manual-row input {
  flex: 1;
  height: 46px;
  padding: 0 14px;
  border-radius: 12px;
  border: 1px solid rgba(15, 23, 42, 0.1);
  background: #fff;
  font-size: 0.9375rem;
}

.scanner-submit {
  flex-shrink: 0;
  padding: 0 14px;
  border-radius: 12px;
  background: #30e88c;
  color: #112119;
  font-size: 0.875rem;
  font-weight: 700;
}

.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.2s ease;
}

.modal-enter-active .scanner-sheet {
  animation: scannerSheetUp 0.32s cubic-bezier(0.32, 0.72, 0, 1) both;
}

.modal-leave-active .scanner-sheet {
  animation: scannerSheetUp 0.24s ease-in reverse both;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

@keyframes scannerSheetUp {
  from {
    transform: translateY(100%);
  }
  to {
    transform: translateY(0);
  }
}
</style>
