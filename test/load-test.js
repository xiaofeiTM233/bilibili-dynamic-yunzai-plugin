/**
 * 插件整体加载测试：用 loader 桩替换 Yunzai 的 Plugin 基类后加载 index.js
 */
import { register } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const testDir = path.dirname(fileURLToPath(import.meta.url))

global.logger = {
  info: () => {},
  warn: (...a) => console.warn('[warn]', ...a),
  error: (...a) => console.error('[error]', ...a),
}

register(pathToFileURL(path.join(testDir, 'loader-hook.mjs')).href)

let failed = 0
const check = (name, ok, extra = '') => {
  console.log(`${ok ? '✅' : '❌'} ${name} ${extra}`)
  if (!ok) failed++
}

const apps = (await import('../index.js')).apps
check('index.js 导出 apps 插件类表', typeof apps === 'object' && Object.keys(apps).length > 0)

const expected = ['BiliSubscribe', 'BiliQuery', 'BiliManage']
for (const name of expected) {
  const cls = apps[name]
  check(`加载 ${name}`, typeof cls === 'function' && cls.prototype instanceof (await import('./plugin-stub.js')).default)
}

// 实例化检查（构造函数中会启动推送任务，需要桩掉）
for (const name of expected) {
  try {
    const instance = new apps[name]({
      // 最小事件桩
    })
    check(`实例化 ${name}（规则 ${instance.config.rule.length} 条）`, Array.isArray(instance.config.rule) && instance.config.rule.length > 0)
  } catch (err) {
    check(`实例化 ${name}`, false, err.message)
  }
}

console.log(failed === 0 ? '\n全部通过 ✔' : `\n${failed} 项失败 ✘`)
process.exit(failed === 0 ? 0 : 1)
