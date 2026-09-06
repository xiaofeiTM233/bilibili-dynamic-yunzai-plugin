/**
 * 数据目录测试：模拟安装在 Yunzai plugins/ 下时，数据应存到 <云崽根>/data/bilibili-dynamic/
 *
 * 将插件复制到 test/fake-yunzai/plugins/bilibili-dynamic（模拟真实安装布局），
 * 从该路径 import Config 校验目录判定与旧数据迁移。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const testDir = path.dirname(fileURLToPath(import.meta.url))
const pluginRoot = path.resolve(testDir, '..')
// 模拟云崽根目录放在系统临时目录，避免嵌套在插件目录内无法复制
const fakeYunzai = path.join(os.tmpdir(), 'bili-dynamic-path-test', `fake-yunzai-${process.pid}`)
const fakePlugin = path.join(fakeYunzai, 'plugins/bilibili-dynamic')

// 重建模拟目录
fs.rmSync(fakeYunzai, { recursive: true, force: true })
fs.mkdirSync(path.join(fakeYunzai, 'lib/plugins'), { recursive: true })
fs.writeFileSync(path.join(fakeYunzai, 'lib/plugins/plugin.js'), 'export default class Plugin {}')

// 复制插件（不含 node_modules / test / 运行时数据）
fs.cpSync(pluginRoot, fakePlugin, {
  recursive: true,
  filter: (src) => !/[\\/]node_modules([\\/]|$)/.test(src) && !/[\\/]test([\\/]|$)/.test(src),
})

// 预置一份旧版数据，验证自动迁移
fs.mkdirSync(path.join(fakePlugin, 'data'), { recursive: true })
fs.writeFileSync(path.join(fakePlugin, 'data/bili_data.json'), JSON.stringify({ uid: 0, cookie: '' }))
fs.mkdirSync(path.join(fakePlugin, 'resources/font'), { recursive: true })
fs.writeFileSync(path.join(fakePlugin, 'resources/font/OLD.ttf'), 'font')

// 从模拟安装路径加载
const pluginUrl = 'file:///' + fakePlugin.replace(/\\/g, '/') + '/model/Config.js'
const Config = await import(pluginUrl)

let failed = 0
const check = (name, ok, extra = '') => {
  console.log(`${ok ? '✅' : '❌'} ${name} ${extra}`)
  if (!ok) failed++
}

check('数据目录位于云崽 data 文件夹', Config.dataDir === path.join(fakeYunzai, 'data/bilibili-dynamic'), Config.dataDir)
check('缓存目录', Config.cacheDir === path.join(Config.dataDir, 'cache'))
check('字体目录', Config.fontDir === path.join(Config.dataDir, 'font'))
check('订阅数据文件', Config.dataPath === path.join(Config.dataDir, 'bili_data.json'))
check('配置仍保留在插件目录', Config.configPath === path.join(fakePlugin, 'config/config.json'))
check('数据目录已创建', fs.existsSync(Config.dataDir))

// 旧数据迁移
check('旧订阅数据已迁移', fs.existsSync(Config.dataPath) && JSON.parse(fs.readFileSync(Config.dataPath, 'utf8')).uid === 0)
check('旧字体已迁移', fs.existsSync(path.join(Config.fontDir, 'OLD.ttf')))

// 独立运行回退：从插件真实路径加载，应回退到插件目录
const ConfigLocal = await import('../model/Config.js')
check('独立运行回退插件目录', ConfigLocal.dataDir === path.join(pluginRoot, 'data'), ConfigLocal.dataDir)

console.log(failed === 0 ? '\n全部通过 ✔' : `\n${failed} 项失败 ✘`)
fs.rmSync(fakeYunzai, { recursive: true, force: true })
process.exit(failed === 0 ? 0 : 1)
