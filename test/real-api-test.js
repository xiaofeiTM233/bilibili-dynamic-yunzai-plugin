/**
 * 真实 API 端到端测试（需要网络）：拉取一条真实动态并渲染
 */
global.logger = {
  info: (...a) => console.log('[info]', ...a),
  warn: (...a) => console.warn('[warn]', ...a),
  error: (...a) => console.error('[error]', ...a),
}

const { getDynamicDetail } = await import('../model/Api.js')
const { renderDynamic } = await import('../model/Render.js')
const fs = await import('node:fs')

// B 站官方账号的一条公开动态
const DID = process.argv[2] ?? '1047599195862683648'
try {
  const item = await getDynamicDetail(DID)
  console.log('动态类型:', item.type, '作者:', item.modules?.module_author?.name)
  const { buffer } = await renderDynamic(item)
  fs.writeFileSync(new URL('./output/real-dynamic.png', import.meta.url), buffer)
  console.log(`✅ 真实动态渲染成功 ${(buffer.length / 1024).toFixed(0)} KB`)
  process.exit(0)
} catch (err) {
  console.error('❌ 失败:', err.message)
  process.exit(1)
}
