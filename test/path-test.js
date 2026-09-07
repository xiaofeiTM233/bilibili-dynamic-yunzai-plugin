/**
 * 数据目录测试：模拟安装在 Yunzai plugins/ 下时，数据应存到 <云崽根>/data/bilibili-dynamic/
 *
 * 将插件复制到模拟云崽目录后从该路径 import Config，校验目录判定与文件布局。
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
// 依赖目录以 junction 链接复用真实 node_modules
fs.symlinkSync(path.join(pluginRoot, 'node_modules'), path.join(fakePlugin, 'node_modules'), 'junction')

// 从模拟安装路径加载
const pluginUrl = 'file:///' + fakePlugin.replace(/\\/g, '/') + '/model/Config.js'
const Config = await import(pluginUrl)

let failed = 0
const check = (name, ok, extra = '') => {
  console.log(`${ok ? '✅' : '❌'} ${name} ${extra}`)
  if (!ok) failed++
}

const dataDir = path.join(fakeYunzai, 'data/bilibili-dynamic')
check('配置文件位于云崽 data 文件夹', Config.configPath === path.join(dataDir, 'BiliConfig.yml'), Config.configPath)
check('缓存目录', Config.cacheDir === path.join(dataDir, 'cache'))
check('字体目录', Config.fontDir === path.join(dataDir, 'font'))
check('数据文件', Config.dataPath === path.join(dataDir, 'BiliData.yml'))

// 首次读取应生成 4 个 YAML 默认文件
Config.getConfig()
Config.getData()
for (const f of ['BiliConfig.yml', 'BiliData.yml', 'ImageQuality.yml', 'ImageTheme.yml']) {
  check(`默认生成 ${f}`, fs.existsSync(path.join(dataDir, f)))
}

// 独立运行回退：从插件真实路径加载，应回退到插件目录
const ConfigLocal = await import('../model/Config.js')
check('独立运行回退插件目录', ConfigLocal.configPath === path.join(pluginRoot, 'data', 'BiliConfig.yml'), ConfigLocal.configPath)

console.log(failed === 0 ? '\n全部通过 ✔' : `\n${failed} 项失败 ✘`)
fs.rmSync(fakeYunzai, { recursive: true, force: true })
process.exit(failed === 0 ? 0 : 1)
