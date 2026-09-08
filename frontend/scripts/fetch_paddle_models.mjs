/**
 * 一键拉取钓鱼助手所需的本地 OCR 资源（纯前端、无运行时 CDN 依赖）
 *
 *   - PP-OCRv6 tiny 检测/识别模型权重（来自百度云 Paddle 官方推理模型）
 *   - ppocr_keys_v1.txt 中文字典（6623 字 + blank）
 *   - onnxruntime-web 的 wasm 推理引擎（复制到 public/ort-wasm/）
 *
 * 运行：node scripts/fetch_paddle_models.mjs   （在 frontend 目录下）
 * 依赖：curl / tar（macOS / Linux 自带）
 */
import { execSync } from 'node:child_process'
import { mkdirSync, existsSync, copyFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const MODELS_DIR = join(ROOT, 'public', 'models', 'paddleocr')
const ORT_WASM_DIR = join(ROOT, 'public', 'ort-wasm')

const CDN = {
  det: 'https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/PP-OCRv6_tiny_det_onnx_infer.tar',
  rec: 'https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/PP-OCRv6_tiny_rec_onnx_infer.tar'
}
const DICT_URL = 'https://raw.githubusercontent.com/PaddlePaddle/PaddleOCR/main/ppocr/utils/ppocr_keys_v1.txt'

function sh(cmd) {
  console.log('$', cmd)
  execSync(cmd, { stdio: 'inherit', cwd: ROOT })
}

function fetchTar(url, outDir, label) {
  mkdirSync(outDir, { recursive: true })
  const tarPath = join(outDir, `${label}.tar`)
  sh(`curl -fSL "${url}" -o "${tarPath}"`)
  sh(`tar -xf "${tarPath}" -C "${outDir}"`)
  sh(`rm -f "${tarPath}"`)
  console.log(`  ✓ ${label} 解包完成 -> ${outDir}`)
}

console.log('== 拉取 PP-OCRv6 tiny 模型 ==')
fetchTar(CDN.det, join(MODELS_DIR, 'PP-OCRv6_tiny_det_infer'), 'det')
fetchTar(CDN.rec, join(MODELS_DIR, 'PP-OCRv6_tiny_rec_infer'), 'rec')

console.log('== 拉取中文字典 ==')
mkdirSync(MODELS_DIR, { recursive: true })
sh(`curl -fSL "${DICT_URL}" -o "${join(MODELS_DIR, 'ppocr_keys_v1.txt')}"`)

console.log('== 复制 onnxruntime-web wasm 引擎 ==')
const ortDist = join(ROOT, 'node_modules', 'onnxruntime-web', 'dist')
if (existsSync(ortDist)) {
  mkdirSync(ORT_WASM_DIR, { recursive: true })
  for (const f of readdirSync(ortDist)) {
    if (f.endsWith('.wasm') || f.endsWith('.mjs')) {
      copyFileSync(join(ortDist, f), join(ORT_WASM_DIR, f))
    }
  }
  console.log(`  ✓ 已复制 onnxruntime-web dist -> ${ORT_WASM_DIR}`)
} else {
  console.warn('  ! 未找到 node_modules/onnxruntime-web/dist，请先 npm install')
}

console.log('\n完成。资源位于：')
console.log('  ', MODELS_DIR)
console.log('  ', ORT_WASM_DIR)
