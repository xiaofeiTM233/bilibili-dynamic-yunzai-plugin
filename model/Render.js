/**
 * 渲染封装 —— 基于 npm 包 bilibili-dynamic-canvaskit（Skia/CanvasKit）
 *
 * 对应原插件 draw/DynamicDraw.kt 的 makeDrawDynamic / makeDrawLive：
 *   模块层 -> 作者区 -> assembleCard 拼贴 -> 渐变底图合成 -> PNG
 *
 * 运行时（字体 + 配置 + 图片缓存）常驻，配置重载或每日缓存清理时重建。
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pluginRoot, cacheDir, fontDir, getConfig } from './Config.js'
import { ensureDir, formatTime, walkFiles } from './Utils.js'

const logger = global.logger ?? console

const require = createRequire(import.meta.url)
const ck = require('bilibili-dynamic-canvaskit')
/** npm 包根目录（assets/font/FansCard.ttf、assets/icon、assets/image） */
const ckRoot = path.dirname(require.resolve('bilibili-dynamic-canvaskit/package.json'))

/* ------------------------------------------------------------------ */
/* 字体（对应 Init.kt loadFonts / FontUtils）                            */
/* ------------------------------------------------------------------ */

let fontState = null // { fontBuffers, source }

const FONT_DOWNLOAD_URLS = [
  { api: 'https://api.github.com/repos/lxgw/LxgwWenKai/releases/latest', asset: 'LXGWWenKai-Bold.ttf' },
  'https://github.com/lxgw/LxgwWenKai/releases/download/v1.520/LXGWWenKai-Bold.ttf',
  'https://ghproxy.net/https://github.com/lxgw/LxgwWenKai/releases/download/v1.520/LXGWWenKai-Bold.ttf',
  'https://gh-proxy.com/https://github.com/lxgw/LxgwWenKai/releases/download/v1.520/LXGWWenKai-Bold.ttf',
]

const SYSTEM_FONT_CANDIDATES = [
  'C:\\Windows\\Fonts\\simhei.ttf',
  'C:\\Windows\\Fonts\\msyh.ttc',
  'C:\\Windows\\Fonts\\msyh.ttf',
  '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc',
]

async function downloadFont() {
  ensureDir(fontDir)
  const target = path.join(fontDir, 'LXGWWenKai-Bold.ttf')
  for (const candidate of FONT_DOWNLOAD_URLS) {
    try {
      let url = candidate
      if (typeof candidate === 'object') {
        const response = await fetch(candidate.api, {
          headers: { 'User-Agent': 'bilibili-dynamic-yunzai-plugin' },
          signal: AbortSignal.timeout(30_000),
        })
        if (!response.ok) continue
        const release = await response.json()
        const asset = (release.assets ?? []).find((a) => a.name === candidate.asset)
        if (!asset) continue
        url = asset.browser_download_url
      }
      logger.info(`[bilibili-dynamic] 正在下载默认字体: ${url}`)
      const response = await fetch(url, { signal: AbortSignal.timeout(120_000) })
      if (!response.ok) continue
      const buffer = Buffer.from(await response.arrayBuffer())
      if (buffer.length < 1024 * 1024) continue
      fs.writeFileSync(target, buffer)
      logger.info(`[bilibili-dynamic] 默认字体下载完成: ${target}`)
      return target
    } catch (err) {
      logger.warn(`[bilibili-dynamic] 字体下载失败 ${typeof candidate === 'object' ? candidate.api : candidate}: ${err.message}`)
    }
  }
  return null
}

/** 收集可用字体文件，返回 { fontBuffers, source } */
async function resolveFonts() {
  if (fontState) return fontState
  const cfg = getConfig()
  const files = []

  // 1. 配置指定字体（绝对路径或 font 目录下文件名）
  if (cfg.font) {
    const p = path.isAbsolute(cfg.font) ? cfg.font : path.join(fontDir, cfg.font)
    if (fs.existsSync(p)) files.push(p)
    else logger.warn(`[bilibili-dynamic] 配置的字体不存在: ${p}`)
  }

  // 2. font 目录下的字体
  if (files.length === 0) {
    try {
      for (const file of fs.readdirSync(fontDir)) {
        if (/\.(ttf|otf|ttc)$/i.test(file)) files.push(path.join(fontDir, file))
      }
    } catch {}
  }

  // 3. 下载霞鹜文楷 Bold（对应原插件自动下载行为）
  if (files.length === 0) {
    const downloaded = await downloadFont()
    if (downloaded) files.push(downloaded)
  }

  // 4. 系统字体兜底
  if (files.length === 0) {
    for (const candidate of SYSTEM_FONT_CANDIDATES) {
      if (fs.existsSync(candidate)) {
        files.push(candidate)
        logger.info(`[bilibili-dynamic] 使用系统字体: ${candidate}`)
        break
      }
    }
  }

  if (files.length === 0) {
    throw new Error(
      `未找到可用字体。请下载 LXGW WenKai Bold（霞鹜文楷）等含中文字形的字体文件\n` +
      `放入 ${fontDir} 后重试`,
    )
  }

  fontState = {
    fontBuffers: files.map((file) => new Uint8Array(fs.readFileSync(file))),
    source: files.join(', '),
  }
  logger.info(`[bilibili-dynamic] 绘图字体: ${fontState.source}`)
  return fontState
}

export function resetFontState() {
  fontState = null
}

/* ------------------------------------------------------------------ */
/* 运行时                                                               */
/* ------------------------------------------------------------------ */

/** 图片下载安全校验：仅 http/https，拒绝内网/环回/保留地址 */
const BLOCKED_HOSTNAME_RE =
  /^(localhost$|127\.|0\.|10\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|\[?::1\]?$|\[?fc|\[?fd|\[?fe80)/i

function safeFetch(url, options) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return Promise.reject(new Error(`非法 URL: ${url}`))
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return Promise.reject(new Error(`不允许的协议 ${parsed.protocol}: ${url}`))
  }
  if (BLOCKED_HOSTNAME_RE.test(parsed.hostname)) {
    return Promise.reject(new Error(`不允许的地址: ${parsed.hostname}`))
  }
  return fetch(url, options)
}

let runtimePromise = null
let runtime = null
let runtimeVersion = 0
const iconCache = new Map()

async function createRuntime() {
  const cfg = getConfig()
  const fonts = await resolveFonts()

  const ckInstance = await ck.initCanvasKit()

  const emojiFont = cfg.emojiFont
    ? path.isAbsolute(cfg.emojiFont) ? cfg.emojiFont : path.join(fontDir, cfg.emojiFont)
    : null

  const rt = await ck.createRuntime(ckInstance, {
    imageConfig: {
      quality: cfg.quality ?? '1000w',
      theme: cfg.theme ?? 'v3',
      font: '',
      defaultColor: cfg.defaultColor ?? '#d3edfa',
      cardOrnament: cfg.cardOrnament ?? 'FanCard',
      colorGenerator: cfg.colorGenerator,
      badgeEnable: cfg.badgeEnable ?? { left: true, right: false },
    },
    fontBuffers: fonts.fontBuffers,
    emojiFontBuffer: emojiFont && fs.existsSync(emojiFont)
      ? new Uint8Array(fs.readFileSync(emojiFont))
      : null,
    fansCardFontBuffer: new Uint8Array(
      fs.readFileSync(path.join(ckRoot, 'assets/font/FansCard.ttf')),
    ),
    downloadOriginal: cfg.downloadOriginal !== false,
    fetchImpl: safeFetch,
  })

  logger.info(`[bilibili-dynamic] 渲染运行时就绪 quality=${rt.quality.imageWidth}px theme=${typeof cfg.theme === 'string' ? cfg.theme : 'custom'}`)
  return rt
}

/** 获取（或创建）渲染运行时；配置重载后调用 resetRuntime 重建 */
export async function getRuntime() {
  if (!runtimePromise) {
    runtimePromise = createRuntime()
      .then((rt) => {
        runtime = rt
        runtimeVersion++
        return rt
      })
      .catch((err) => {
        runtimePromise = null
        throw err
      })
  }
  return runtimePromise
}

/** 释放并重建运行时（配置修改 / 每日清理） */
export async function resetRuntime() {
  try {
    if (runtime) {
      for (const image of iconCache.values()) image.delete?.()
      iconCache.clear()
      ck.disposeRuntime(runtime)
    }
  } catch (err) {
    logger.warn(`[bilibili-dynamic] 释放运行时失败: ${err.message}`)
  }
  runtime = null
  runtimePromise = null
}

/** 当前默认主题色列表（支持 "#a;#b" 多色渐变） */
function themeColors(colorHex) {
  const cfg = getConfig()
  const colors = (colorHex ?? cfg.defaultColor ?? '#d3edfa')
    .split(/[;；]/)
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => ck.colorFromHex(c))
  return colors
}

/* ------------------------------------------------------------------ */
/* SVG 图标（对应 loadSVG + SVGDOM.makeImage）                           */
/* ------------------------------------------------------------------ */

function svgToImage(name, size) {
  const key = `${runtimeVersion}:${name}:${Math.round(size)}`
  if (iconCache.has(key)) return iconCache.get(key)
  const svgFile = path.join(ckRoot, 'assets/icon', `${name}.svg`)
  if (!fs.existsSync(svgFile)) return null
  const { Resvg } = require('@resvg/resvg-js')
  const resvg = new Resvg(fs.readFileSync(svgFile), { fitTo: { mode: 'width', value: Math.round(size) } })
  const image = runtime.ck.MakeImageFromEncoded(new Uint8Array(resvg.render().asPng()))
  if (image) iconCache.set(key, image)
  return image
}

/** 模块图标加载器（TOPIC/DISPUTE/WEB/VOTE/LOTTERY/BV） */
function makeIconLoader(rt) {
  return async (name) => svgToImage(name, rt.quality.contentFontSize)
}

function verifyIconOf(rt, verifyType) {
  const name =
    verifyType === 0 ? 'PERSONAL_OFFICIAL_VERIFY' : verifyType === 1 ? 'ORGANIZATION_OFFICIAL_VERIFY' : ''
  return name ? svgToImage(name, rt.quality.verifyIconSize) : null
}

/* ------------------------------------------------------------------ */
/* 图片落盘缓存（对应 cacheImage）                                       */
/* ------------------------------------------------------------------ */

const CACHE_TYPES = {
  dynamic: 'draw/dynamic',
  live: 'draw/live',
  search: 'draw/search',
}

/** 将 PNG 保存到缓存目录，返回绝对路径 */
export function cacheImage(type, subPath, buffer) {
  const dir = path.join(cacheDir, CACHE_TYPES[type] ?? CACHE_TYPES.search)
  ensureDir(dir)
  const file = path.join(dir, subPath.replace(/[\\/:*?"<>|]/g, '_'))
  fs.writeFileSync(file, buffer)
  return file
}

/* ------------------------------------------------------------------ */
/* 动态卡片（对应 DynamicItem.drawDynamic + makeDrawDynamic）             */
/* ------------------------------------------------------------------ */

/** 专栏 opus 转换与作者信息 */
async function prepareItem(item) {
  const Dynamic = await import('./Dynamic.js')
  Dynamic.convertArticle(item)
  return Dynamic
}

/**
 * 渲染完整动态卡片（含转发嵌套），返回 PNG Buffer
 * @param item B 站 API 动态数据（web-dynamic v1 结构）
 * @param colorHex 主题色，如 "#d3edfa" 或 "#a;#b"
 * @returns {{ buffer: Buffer, path: string|null }}
 */
export async function renderDynamic(item, colorHex = null) {
  const rt = await getRuntime()
  const Dynamic = await prepareItem(item)
  const colors = themeColors(colorHex)
  const colorsInt = colors

  const mid = Dynamic.midOf(item)
  const did = Dynamic.didOf(item)

  const cardImage = await drawDynamicCard(rt, item, colorsInt[0], false, Dynamic)

  const finalImage = ck.composeDynamicCard(rt, cardImage, colorsInt)
  cardImage.delete()

  const png = finalImage.encodeToBytes()
  finalImage.delete()
  if (!png) throw new Error('动态卡片 PNG 编码失败')

  const buffer = Buffer.from(png)
  let filePath = null
  try {
    filePath = cacheImage('dynamic', `${mid}/${did}.png`, buffer)
  } catch (err) {
    logger.warn(`[bilibili-dynamic] 动态图片落盘失败: ${err.message}`)
  }
  return { buffer, path: filePath }
}

/** 递归绘制卡片主体（对应 DynamicItem.drawDynamic） */
async function drawDynamicCard(rt, item, themeColor, isForward, Dynamic) {
  const orig = item.orig
    ? await drawDynamicCard(rt, item.orig, themeColor, item.type === 'DYNAMIC_TYPE_FORWARD', Dynamic)
    : null

  const author = Dynamic.toAuthorInfo(item)
  const verifyIcon = verifyIconOf(rt, item?.modules?.module_author?.official_verify?.type)
  const time = Dynamic.formatItemTime(item)
  const link = Dynamic.linkOf(item)

  const moduleImages = []
  if (item.type !== 'DYNAMIC_TYPE_NONE') {
    moduleImages.push(
      isForward
        ? await ck.drawAuthorForward(rt, author, time, verifyIcon)
        : await ck.drawAuthorGeneral(rt, author, time, link, themeColor, verifyIcon),
    )
  }

  if (Dynamic.isUnlocked(item)) {
    // 专属动态：仅绘制占位图
    const bgImage = rt.ck.MakeImageFromEncoded(
      new Uint8Array(fs.readFileSync(path.join(ckRoot, 'assets/image/Blocked_BG_Day.png'))),
    )
    moduleImages.push(ck.drawBlockedDefault(rt, bgImage))
    bgImage?.delete()
  } else {
    const modules = Dynamic.toModules(item)
    const drawn = await ck.drawModuleDynamic(rt, modules, { iconLoader: makeIconLoader(rt) })
    moduleImages.push(...drawn)
  }

  // 转发源动态卡片插入位置：有附加卡片时置于其前（对应原实现的顺序调整）
  let imgList = moduleImages
  if (orig != null) {
    if (item?.modules?.module_dynamic?.additional != null && !Dynamic.isUnlocked(item)) {
      imgList = [...moduleImages.slice(0, -1), orig, moduleImages[moduleImages.length - 1]]
    } else {
      imgList = [...moduleImages, orig]
    }
  }

  const plusHeight =
    item.type === 'DYNAMIC_TYPE_WORD' || item.type === 'DYNAMIC_TYPE_NONE' ? rt.quality.contentSpace * 2 : 0

  const footer = isForward
    ? null
    : buildFooter(Dynamic.nameOf(item), Dynamic.midOf(item), Dynamic.didOf(item), time, Dynamic.typeText(item.type))

  const card = ck.assembleCard(rt, imgList, {
    id: Dynamic.didOf(item),
    footer,
    plusHeight,
    isForward,
    badgeIcon: svgToImage(isForward ? 'FORWARD' : 'BILIBILI_LOGO', rt.quality.contentFontSize),
  })

  for (const image of imgList) image.delete()

  return card
}

/** 页脚（对应 buildFooter） */
function buildFooter(name, uid, id, time, type) {
  const template = getConfig().footer?.dynamicFooter
  if (!template) return null
  return template
    .replaceAll('{name}', name)
    .replaceAll('{uid}', String(uid))
    .replaceAll('{id}', id)
    .replaceAll('{time}', time)
    .replaceAll('{type}', type)
}

/* ------------------------------------------------------------------ */
/* 直播卡片（对应 LiveInfo.drawLive + makeDrawLive）                     */
/* ------------------------------------------------------------------ */

/**
 * 渲染直播卡片
 * @param live { uid, uname, roomId, title, face, cover, liveTime, area }
 */
export async function renderLive(live, colorHex = null) {
  const rt = await getRuntime()
  const colors = themeColors(colorHex)
  const cfg = getConfig()

  const liveInfo = {
    uid: Number(live.uid),
    uname: live.uname,
    roomId: Number(live.roomId),
    title: live.title,
    face: live.face,
    cover: live.cover,
    liveTimeText: formatTime(live.liveTime),
    area: live.area ?? '',
  }

  const badgeIcon = svgToImage('LIVE', rt.quality.contentFontSize)
  const footer = cfg.footer?.liveFooter || null

  const card = await ck.drawLive(rt, liveInfo, { liveFooter: footer, badgeIcon })
  const finalImage = ck.composeLiveCard(rt, card, colors)
  card.delete()

  const png = finalImage.encodeToBytes()
  finalImage.delete()
  if (!png) throw new Error('直播卡片 PNG 编码失败')

  const buffer = Buffer.from(png)
  let filePath = null
  try {
    filePath = cacheImage('live', `${live.uid}_${live.roomId}.png`, buffer)
  } catch (err) {
    logger.warn(`[bilibili-dynamic] 直播图片落盘失败: ${err.message}`)
  }
  return { buffer, path: filePath }
}

/* ------------------------------------------------------------------ */
/* 搜索/解析卡片（对应 ResolveLinkService.drawGeneral）                   */
/* ------------------------------------------------------------------ */

/**
 * 渲染搜索结果卡片：作者区 + 可选主体图
 * @param options { id, tag, time, author, major?, live? }
 */
export async function renderSearchCard(options) {
  const rt = await getRuntime()
  const colors = themeColors()

  const images = []
  const authorImg = await ck.drawAuthorGeneral(
    rt,
    options.author,
    options.time,
    options.link ?? '',
    colors[0],
    verifyIconOf(rt, options.author.verifyType),
  )
  images.push(authorImg)

  if (options.live) {
    const liveCard = await ck.drawLive(rt, { ...options.live, liveTimeText: options.live.liveTimeText ?? options.time }, {})
    images.push(liveCard)
  } else if (options.major) {
    const drawn = await ck.drawMajor(rt, options.major, { iconLoader: makeIconLoader(rt) })
    if (drawn) images.push(drawn)
  }

  const card = ck.assembleCard(rt, images, {
    id: String(options.id ?? ''),
    footer: buildFooter(options.author.name, options.author.mid, options.id, options.time, options.tag),
    tag: options.tag ?? '搜索',
    badgeIcon: svgToImage('BILIBILI_LOGO', rt.quality.contentFontSize),
  })
  for (const image of images) image.delete()

  const finalImage = ck.composeDynamicCard(rt, card, colors)
  card.delete()

  const png = finalImage.encodeToBytes()
  finalImage.delete()
  if (!png) throw new Error('搜索卡片 PNG 编码失败')

  const buffer = Buffer.from(png)
  let filePath = null
  try {
    filePath = cacheImage('search', `${options.id}_${options.tag}.png`, buffer)
  } catch (err) {
    logger.warn(`[bilibili-dynamic] 搜索图片落盘失败: ${err.message}`)
  }
  return { buffer, path: filePath }
}

/* ------------------------------------------------------------------ */
/* 登录二维码                                                            */
/* ------------------------------------------------------------------ */

export async function renderLoginQrcode(url) {
  const QRCode = require('qrcode')
  return QRCode.toBuffer(url, { width: 512, margin: 2 })
}

/* ------------------------------------------------------------------ */
/* 缓存清理（对应 CacheClearTasker）                                     */
/* ------------------------------------------------------------------ */

/** 清理超过 days 天未访问的缓存图片，days=0 时跳过 */
export function clearCache(days) {
  if (!days || days <= 0) return 0
  const expire = Date.now() - days * 86400_000
  let count = 0
  walkFiles(cacheDir, (file) => {
    try {
      if (fs.statSync(file).mtimeMs < expire) {
        fs.unlinkSync(file)
        count++
      }
    } catch {}
  })
  if (count > 0) logger.info(`[bilibili-dynamic] 缓存清理完成，删除 ${count} 个文件`)
  return count
}
