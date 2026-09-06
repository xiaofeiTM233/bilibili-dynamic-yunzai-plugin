/**
 * 配置与路径管理 —— 对应 BiliConfig.kt
 *
 * 配置文件：<插件目录>/config/config.json（用户配置，可手动编辑）
 * 默认值：<插件目录>/config/default_config.json
 * 运行时数据：<云崽根目录>/data/bilibili-dynamic/（对应 BiliData.kt）
 *   - bili_data.json  订阅数据
 *   - cache/          图片缓存
 *   - font/           绘图字体
 * 插件独立运行（未安装在 plugins/ 下）时，运行时数据回退到 <插件目录>/data/
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { deepMerge, ensureDir } from './Utils.js'

export const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export const configDir = path.join(pluginRoot, 'config')

/** 云崽根目录（plugins/<插件名>/model 的上两级） */
const yunzaiRoot = path.resolve(pluginRoot, '../..')

function resolveDataRoot() {
  // 安装在云崽 plugins/ 目录下时，数据存入云崽的 data 文件夹
  const underPlugins = path.basename(path.dirname(pluginRoot)) === 'plugins'
  const isYunzai = fs.existsSync(path.join(yunzaiRoot, 'lib/plugins/plugin.js'))
  if (underPlugins || isYunzai) {
    return path.join(yunzaiRoot, 'data/bilibili-dynamic')
  }
  // 独立运行（开发/测试）时回退到插件目录
  return path.join(pluginRoot, 'data')
}

export const dataRoot = resolveDataRoot()
export const dataDir = dataRoot
export const cacheDir = path.join(dataRoot, 'cache')
export const fontDir = path.join(dataRoot, 'font')

export const defaultConfigPath = path.join(configDir, 'default_config.json')
export const configPath = path.join(configDir, 'config.json')
export const dataPath = path.join(dataDir, 'bili_data.json')

ensureDir(configDir)
ensureDir(dataRoot)
ensureDir(cacheDir)

/**
 * 旧版本数据迁移：早期版本把数据/缓存/字体放在插件目录内，
 * 检测到旧位置数据且新位置为空时自动搬运。
 */
function migrateLegacyData() {
  const legacyData = path.join(pluginRoot, 'data/bili_data.json')
  const legacyResources = path.join(pluginRoot, 'resources')
  try {
    if (fs.existsSync(legacyData) && !fs.existsSync(dataPath)) {
      fs.copyFileSync(legacyData, dataPath)
      global.logger?.mark?.('[bilibili-dynamic] 已迁移订阅数据到 ' + dataPath)
    }
    for (const [from, to] of [
      [path.join(legacyResources, 'cache'), cacheDir],
      [path.join(legacyResources, 'font'), fontDir],
    ]) {
      if (!fs.existsSync(from)) continue
      ensureDir(to)
      for (const name of fs.readdirSync(from)) {
        const target = path.join(to, name)
        if (!fs.existsSync(target)) fs.renameSync(path.join(from, name), target)
      }
    }
  } catch (err) {
    console.warn(`[bilibili-dynamic] 旧数据迁移失败: ${err.message}`)
  }
}
migrateLegacyData()

let cached = null

function readJson(file, fallback) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (err) {
    console.error(`[bilibili-dynamic] 解析 ${file} 失败: ${err.message}`)
  }
  return fallback
}

/** 读取配置（默认值 <- 用户配置），修改后可调用 reloadConfig */
export function getConfig() {
  if (!cached) {
    const defaults = readJson(defaultConfigPath, {})
    cached = deepMerge(defaults, readJson(configPath, {}))
  }
  return cached
}

export function reloadConfig() {
  cached = null
  return getConfig()
}

/** 保存用户配置（完整写入当前合并结果） */
export function saveConfig(cfg = getConfig()) {
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2))
}

/* ------------------------------------------------------------------ */
/* 订阅数据（对应 BiliData.kt）                                          */
/* ------------------------------------------------------------------ */

export function defaultData() {
  return {
    /** B 站账号 UID（登录后写入） */
    uid: 0,
    /** 登录 cookie："SESSDATA=xxx; bili_jct=xxx; " */
    cookie: '',
    /** 自动关注分组 tagid（对应 BiliBiliDynamic.tagid） */
    tagid: 0,
    /**
     * 订阅信息，key: uid（"0" 为全体目标聚合，对应 SubData）
     * contacts 元素为 "g<群号>" / "f<QQ号>"
     */
    dynamic: {
      0: { name: 'ALL', color: null, contacts: [] },
    },
    /** 番剧订阅，key: ssid */
    bangumi: {},
    /** 动态过滤，key: contact -> uid -> { typeSelect: {mode, list}, regularSelect: {mode, list} } */
    filter: {},
    /** At全体，key: contact -> uid -> 类型数组 [all/dynamic/video/music/article/live] */
    atAll: {},
    /** 每目标推送模板选择，key: contact -> 模板名 */
    dynamicTemplate: {},
    liveTemplate: {},
    liveCloseTemplate: {},
  }
}

let saveTimer = null

export function getData() {
  if (!globalThis.__biliData) {
    const loaded = readJson(dataPath, null)
    globalThis.__biliData = loaded ? deepMerge(defaultData(), loaded) : defaultData()
  }
  return globalThis.__biliData
}

/** 防抖落盘（对应 AutoSavePluginData 的自动保存） */
export function saveData() {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    try {
      fs.writeFileSync(dataPath, JSON.stringify(getData(), null, 2))
    } catch (err) {
      console.error(`[bilibili-dynamic] 保存订阅数据失败: ${err.message}`)
    }
  }, 500)
}

export function saveDataNow() {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  fs.writeFileSync(dataPath, JSON.stringify(getData(), null, 2))
}
