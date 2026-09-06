/**
 * bilibili-dynamic-yunzai-plugin
 *
 * 云崽 Yunzai-Bot V3 的 B 站动态/直播订阅推送插件。
 * 绘图基于 bilibili-dynamic-canvaskit（Skia/CanvasKit），
 * 功能参考 bilibili-dynamic-mirai-plugin 实现。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const logger = global.logger ?? console

// 基于当前文件位置定位 apps 目录，不依赖运行目录与插件文件夹名
const appsPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'apps')
const apps = {}

if (!fs.existsSync(appsPath)) {
  logger.error?.('[bilibili-dynamic] apps 目录不存在，插件加载失败')
} else {
  logger.info?.('- 正在载入 bilibili-dynamic-yunzai-plugin')

  const files = fs.readdirSync(appsPath).filter((file) => file.endsWith('.js'))

  const results = await Promise.allSettled(
    files.map((file) => import(pathToFileURL(path.join(appsPath, file)).href))
  )

  let successCount = 0
  for (const [i, result] of results.entries()) {
    const name = files[i].replace(/\.js$/, '')

    if (result.status !== 'fulfilled') {
      logger.error?.(`[bilibili-dynamic] 载入插件错误：${name}`)
      logger.error?.(result.reason?.stack || result.reason)
      continue
    }

    // 从导出中筛选出插件类（class 声明），普通函数导出（如工具函数）会被跳过
    let registered = 0
    for (const [, value] of Object.entries(result.value)) {
      if (typeof value === 'function' && /^class[\s{]/.test(String(value))) {
        apps[value.name || name] = value
        registered++
      }
    }

    if (!registered) {
      logger.warn?.(`[bilibili-dynamic] 载入插件错误：${name} 未导出任何插件类`)
      continue
    }
    successCount += registered
  }

  logger.info?.(`- bilibili-dynamic-yunzai-plugin 载入成功，共加载 ${successCount}/${files.length} 个应用模块`)
}

export { apps }
