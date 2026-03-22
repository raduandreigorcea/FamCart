<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'

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
const supportsCamera = computed(() => Boolean(navigator.mediaDevices?.getUserMedia))
const supportsBarcodeDetection = computed(() => {
  const barcodeDetector = (window as Window & { BarcodeDetector?: DetectorConstructor }).BarcodeDetector
  return Boolean(barcodeDetector)
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
  emit('close')
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
    }

    void detectLoop(localToken)
  } catch {
    errorMessage.value = 'Unable to start the camera. Check camera permission or enter the barcode manually.'
    stopStream()
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
          <button type="button" class="scanner-close" @click="closeScanner">Close</button>
        </div>

        <div class="scanner-frame">
          <video ref="videoRef" class="scanner-video" playsinline muted />
          <div class="scanner-guide"></div>
          <div v-if="isStarting" class="scanner-status">Starting camera...</div>
          <div v-else-if="errorMessage" class="scanner-status">{{ errorMessage }}</div>
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
  background: #fff;
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
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: 12px;
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(15, 23, 42, 0.72);
  color: #fff;
  font-size: 0.8125rem;
  text-align: center;
}

.scanner-manual {
  padding: 14px 18px 18px;
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
  transition: opacity 0.3s ease;
}

.modal-enter-active .scanner-sheet {
  animation: scannerSheetUp 0.45s cubic-bezier(0.32, 0.72, 0, 1) both;
}

.modal-leave-active .scanner-sheet {
  animation: scannerSheetDown 0.28s ease-in both;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

@keyframes scannerSheetUp {
  0% { transform: translateY(100%) scale(0.96); opacity: 0; }
  60% { transform: translateY(-2%) scale(1.005); opacity: 1; }
  100% { transform: translateY(0) scale(1); opacity: 1; }
}

@keyframes scannerSheetDown {
  0% { transform: translateY(0) scale(1); opacity: 1; }
  100% { transform: translateY(100%) scale(0.96); opacity: 0; }
}
</style>
