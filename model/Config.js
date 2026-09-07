/**
 * 配置与数据管理 —— 与 mirai 插件共用同一套配置文件，内存形状 = 文件形状
 *
 * 所有文件均位于 <云崽根目录>/data/bilibili-dynamic/（独立运行时为 <插件目录>/data/）：
 *   - BiliConfig.yml   插件配置（对应 mirai BiliConfig.kt）
 *   - BiliData.yml     订阅数据（对应 mirai BiliData.kt）
 *   - ImageQuality.yml 图片分辨率
 *   - ImageTheme.yml   图片主题
 *
 * 数据格式即 mirai 原格式，无任何转换层：
 *   - 联系人字符串：群 "-<群号>" / 好友 "<QQ号>"；分组名为普通名称
 *   - 过滤器/AtAll：BLACK_LIST / WHITE_LIST、DYNAMIC 等枚举名
 *   - 推送模板：模板名 -> 联系人列表
 * 可将 mirai 的原文件直接放入本目录使用，也可复制回 mirai 继续使用。
 * 文件缺失时从插件自带的 config/*.default.yml 复制补齐，代码内无任何默认值表。
 * 登录 cookie 优先取 BiliConfig.yml 的 accountConfig.cookie（mirai 登录写入处），
 * BiliData.yml 中的扩展键 cookie/uid 优先（#bili登录 写入）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as yamlParse, stringify as yamlStringify } from 'yaml'
import { QUALITY_PRESETS, THEME_PRESETS } from 'bilibili-dynamic-canvaskit'
import { deepMerge, ensureDir } from './Utils.js'

export const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** 数据根目录：安装在云崽 plugins/ 下时为云崽 data/bilibili-dynamic，独立运行时为插件目录 data/ */
const dataRoot = (() => {
  const yunzaiRoot = path.resolve(pluginRoot, '../..')
  const underPlugins = path.basename(path.dirname(pluginRoot)) === 'plugins'
  const isYunzai = fs.existsSync(path.join(yunzaiRoot, 'lib/plugins/plugin.js'))
  return underPlugins || isYunzai ? path.join(yunzaiRoot, 'data/bilibili-dynamic') : path.join(pluginRoot, 'data')
})()

export const cacheDir = path.join(dataRoot, 'cache')
export const fontDir = path.join(dataRoot, 'font')

export const configPath = path.join(dataRoot, 'BiliConfig.yml')
export const qualityPath = path.join(dataRoot, 'ImageQuality.yml')
export const themePath = path.join(dataRoot, 'ImageTheme.yml')
export const dataPath = path.join(dataRoot, 'BiliData.yml')

ensureDir(dataRoot)
ensureDir(cacheDir)

/* ------------------------------------------------------------------ */
/* 默认文件：全部随插件附带（config/*.default.yml），缺失时复制补齐            */
/* ------------------------------------------------------------------ */

const configDir = path.join(pluginRoot, 'config')

/** 文件不存在时复制插件附带的默认文件（对应 mirai 首启自动生成默认配置） */
function ensureFile(file, defaultFile) {
  if (!fs.existsSync(file)) fs.copyFileSync(defaultFile, file)
}

/* ------------------------------------------------------------------ */
/* YAML 读写                                                            */
/* ------------------------------------------------------------------ */

function readYaml(file, fallback) {
  try {
    if (fs.existsSync(file)) {
      const parsed = yamlParse(fs.readFileSync(file, 'utf8'))
      if (parsed != null) return parsed
    }
  } catch (err) {
    console.error(`[bilibili-dynamic] 解析 ${file} 失败: ${err.message}`)
  }
  return fallback
}

function writeYaml(file, obj) {
  ensureDir(path.dirname(file))
  fs.writeFileSync(file, yamlStringify(obj, { lineWidth: 0 }))
}

/* ------------------------------------------------------------------ */
/* 配置读取（getConfig 返回兼容视图，字段与旧版扁平键一致）                   */
/* ------------------------------------------------------------------ */

let cached = null

function buildView(cfg, qualityDoc, themeDoc) {
  const e = cfg.enableConfig ?? {}
  const a = cfg.accountConfig ?? {}
  const c = cfg.checkConfig ?? {}
  const p = cfg.pushConfig ?? {}
  const i = cfg.imageConfig ?? {}
  const t = cfg.templateConfig ?? {}
  // ImageQuality.yml / ImageTheme.yml 的 customOverload 开启后覆盖 imageConfig 对应项
  const quality = qualityDoc?.customOverload && qualityDoc.customQuality ? qualityDoc.customQuality : i.quality
  const theme = themeDoc?.customOverload && themeDoc.customTheme ? themeDoc.customTheme : i.theme
  return {
    root: cfg,
    admin: cfg.admin,
    timeout: c.timeout,
    interval: c.interval,
    liveInterval: c.liveInterval,
    lowSpeed: c.lowSpeed,
    drawEnable: e.drawEnable,
    liveCloseNotify: e.liveCloseNotifyEnable,
    showLoadingMessage: e.showLoadingMessage,
    autoFollow: a.autoFollow,
    followGroup: a.followGroup,
    quality,
    theme,
    font: i.font,
    defaultColor: i.defaultColor,
    cardOrnament: i.cardOrnament,
    colorGenerator: i.colorGenerator,
    badgeEnable: i.badgeEnable,
    downloadOriginal: cfg.cacheConfig?.downloadOriginal,
    cacheClearDays: cfg.cacheConfig?.expires?.DRAW ?? 7,
    pushInterval: p.pushInterval,
    messageInterval: p.messageInterval,
    atAllPlus: p.atAllPlus,
    template: {
      dynamic: t.defaultDynamicPush,
      live: t.defaultLivePush,
      liveClose: t.defaultLiveClose,
    },
    dynamicTemplates: t.dynamicPush ?? {},
    liveTemplates: t.livePush ?? {},
    liveCloseTemplates: t.liveClose ?? {},
    footer: t.footer ?? {},
    /** 停用的链接解析功能仍透传 mirai 的配置键，供日后恢复使用 */
    linkResolve: cfg.linkResolveConfig ?? {},
  }
}

/** 读取配置视图（BiliConfig.yml + ImageQuality.yml + ImageTheme.yml），修改后可调用 reloadConfig */
export function getConfig() {
  if (!cached) {
    ensureFile(configPath, path.join(configDir, 'BiliConfig.default.yml'))
    ensureFile(qualityPath, path.join(configDir, 'ImageQuality.default.yml'))
    ensureFile(themePath, path.join(configDir, 'ImageTheme.default.yml'))
    const cfg = readYaml(configPath, null)
    const qualityDoc = readYaml(qualityPath, null)
    const themeDoc = readYaml(themePath, null)
    cached = buildView(cfg, qualityDoc, themeDoc)
  }
  return cached
}

export function reloadConfig() {
  cached = null
  return getConfig()
}

/* ------------------------------------------------------------------ */
/* 订阅数据（BiliData.yml，内存形状 = mirai 文件形状，无转换层）               */
/* ------------------------------------------------------------------ */

let saveTimer = null

export function getData() {
  if (!globalThis.__biliData) {
    ensureFile(configPath, path.join(configDir, 'BiliConfig.default.yml'))
    ensureFile(dataPath, path.join(configDir, 'BiliData.default.yml'))
    // deepMerge 以默认文件为骨架补齐新键，纯函数不改基线
    const data = deepMerge(readYaml(path.join(configDir, 'BiliData.default.yml'), {}), readYaml(dataPath, {}) ?? {})
    // cookie 兜底：BiliData 未登录时取 BiliConfig.accountConfig.cookie（mirai 登录写入处）
    if (!data.cookie) {
      const cookie = getConfig().root?.accountConfig?.cookie
      if (cookie) {
        data.cookie = cookie
        const m = /DedeUserID=(\d+)/.exec(cookie)
        if (m) data.uid = Number(m[1])
      }
    }
    globalThis.__biliData = data
  }
  return globalThis.__biliData
}

/** 防抖落盘（对应 AutoSavePluginData 的自动保存），原样写回 BiliData.yml */
export function saveData() {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    try {
      writeYaml(dataPath, getData())
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
  fs.writeFileSync(dataPath, yamlStringify(getData(), { lineWidth: 0 }))
}
