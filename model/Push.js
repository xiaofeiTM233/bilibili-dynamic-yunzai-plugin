/**
 * 检测与推送 —— 移植自 tasker/*.kt
 *
 * DynamicCheckTasker: 轮询账号全部最新动态，筛出已订阅用户的更新
 * LiveCheckTasker:    轮询关注列表的直播间开播情况
 * LiveCloseCheckTasker: 已开播用户的下播通知
 * SendTasker:         消息队列 -> 过滤器 -> 模板 -> 发送
 */
import { getConfig, getData, saveDataNow } from './Config.js'
import * as Data from './Data.js'
import * as Api from './Api.js'
import * as Dynamic from './Dynamic.js'
import { renderDynamic, renderLive, clearCache, resetRuntime } from './Render.js'
import { formatTime, formatDuration, sleep, nowSec, today, hourOf, toSec } from './Utils.js'

const logger = global.logger ?? console

/* ------------------------------------------------------------------ */
/* 状态                                                                 */
/* ------------------------------------------------------------------ */

const HISTORY_CAPACITY = 200
const historyDynamic = []
let lastIndex = 0

let lastDynamic = nowSec()
let lastLive = nowSec()
const liveUsers = new Map() // uid -> liveTime

const queue = []
let processing = false
let running = false

let lastCacheClearDay = ''

export const stats = {
  dynamicChecks: 0,
  liveChecks: 0,
  pushed: 0,
  lastCheckAt: 0,
  lastError: '',
}

/* ------------------------------------------------------------------ */
/* 启动                                                                 */
/* ------------------------------------------------------------------ */

export function startPush() {
  if (running) return
  running = true
  logger.info('[bilibili-dynamic] 推送任务已启动')
  dynamicLoop()
  liveLoop()
  liveCloseLoop()
  cacheLoop()
}

export function stopPush() {
  running = false
}

export function queueLength() {
  return queue.length
}

/** 低频检测（对应 BiliCheckTasker.calcTime，"3-8x2" 三点到八点间隔 x2） */
function calcInterval(base) {
  const cfg = getConfig()
  const lowSpeed = String(cfg.lowSpeed ?? '0-0x2')
  const m = /^(\d{1,2})-(\d{1,2})x(\d+)$/.exec(lowSpeed)
  if (!m) return base
  const [, from, to, multiple] = m
  if (Number(from) === Number(to)) return base
  const hour = hourOf()
  const inRange =
    Number(from) > Number(to)
      ? hour >= Number(from) || hour <= Number(to)
      : hour >= Number(from) && hour <= Number(to)
  return inRange ? base * Number(multiple) : base
}

/* ------------------------------------------------------------------ */
/* 动态检测（对应 DynamicCheckTasker）                                   */
/* ------------------------------------------------------------------ */

async function dynamicLoop() {
  await sleep(15_000)
  while (running) {
    const cfg = getConfig()
    try {
      await dynamicCheck()
    } catch (err) {
      stats.lastError = err.message
      logger.warn(`[bilibili-dynamic] 动态检测失败: ${err.message}`)
      if (err instanceof Api.LoginExpiredError) await sleep(120_000)
    }
    await sleep(Math.max(10, calcInterval(cfg.interval ?? 15)) * 1000)
  }
}

export async function dynamicCheck() {
  const data = getData()
  if (!data.cookie) return
  if (Data.allContacts().length === 0) return

  const list = await Api.getNewDynamic()
  if (!list?.items) {
    logger.warn(`[bilibili-dynamic] 动态检测: 接口未返回 items，本轮跳过 | 响应 JSON: ${JSON.stringify(list)?.slice(0, 500)}`)
    return
  }
  stats.dynamicChecks++
  stats.lastCheckAt = Date.now()

  const following = new Set(Data.subscribedUids().map(String))
  const bangumiSsids = new Set(Object.keys(data.bangumi))

  const dynamics = list.items
    .filter((item) => !Dynamic.LIVE_BAN_TYPES.includes(item.type))
    .filter((item) => Dynamic.timeOf(item) > lastDynamic)
    .filter((item) => !historyDynamic.includes(Dynamic.didOf(item)))
    .filter((item) => {
      // 番剧动态按 season_id 匹配订阅
      const ssid = Dynamic.pgcSeasonIdOf(item)
      if (ssid != null) return bangumiSsids.has(String(ssid))
      return following.has(String(Dynamic.midOf(item)))
    })
    .sort((a, b) => Dynamic.timeOf(a) - Dynamic.timeOf(b))

  for (const item of dynamics) {
    historyDynamic.splice(lastIndex, 0, Dynamic.didOf(item))
    lastIndex++
    if (lastIndex >= HISTORY_CAPACITY) lastIndex = 0
    if (historyDynamic.length > HISTORY_CAPACITY) historyDynamic.shift()
  }

  if (dynamics.length > 0) {
    lastDynamic = Dynamic.timeOf(dynamics[dynamics.length - 1])
  }

  for (const item of dynamics) {
    try {
      queue.push(await buildDynamicMessage(item))
      processQueue()
    } catch (err) {
      logger.error(`[bilibili-dynamic] 构建动态消息失败 ${Dynamic.didOf(item)}: ${err.message}`)
    }
  }
}

/* ------------------------------------------------------------------ */
/* 直播检测（对应 LiveCheckTasker / LiveCloseCheckTasker）                */
/* ------------------------------------------------------------------ */

async function liveLoop() {
  await sleep(20_000)
  while (running) {
    const cfg = getConfig()
    try {
      await liveCheck()
    } catch (err) {
      stats.lastError = err.message
      logger.warn(`[bilibili-dynamic] 直播检测失败: ${err.message}`)
    }
    await sleep(Math.max(10, calcInterval(cfg.liveInterval ?? 20)) * 1000)
  }
}

/**
 * 直播检测
 *
 * 数据来源取并集（关注列表接口要求已关注且只取第一页 20 条，容易被漏掉）：
 *  1. GetWebList            关注列表里正在直播的房间（mirai 原逻辑）
 *  2. get_status_info_by_uids  按订阅 UID 主动查直播状态，无关注关系依赖、无分页
 *
 * 判定新开播用「上一轮未在播 -> 本轮在播（或换了房间号）」的快照比对，
 * 不再依赖 live_time 字段（首轮只记基线不推送，与 mirai lastLive=启动时刻 行为一致）
 */
let liveSnapshot = null // Map<uid, roomId>，上一轮在播快照；null = 尚未初始化

export async function liveCheck() {
  const data = getData()
  if (!data.cookie) return
  if (Data.allContacts().length === 0) return

  const following = new Set(Data.subscribedUids().map(String))
  if (following.size === 0) return
  stats.liveChecks++

  const rooms = await collectLiveRooms(following)

  if (liveSnapshot === null) {
    liveSnapshot = new Map([...rooms].map(([uid, room]) => [uid, room.rid]))
    logger.info(`[bilibili-dynamic] 直播检测就绪：订阅 ${following.size} 个，当前在播 ${rooms.size} 个，后续开播将推送`)
    return
  }

  const lives = [...rooms.values()].filter((room) => liveSnapshot.get(room.uid) !== room.rid)
  liveSnapshot = new Map([...rooms].map(([uid, room]) => [uid, room.rid]))

  if (lives.length === 0) return
  logger.info(`[bilibili-dynamic] 检测到 ${lives.length} 个开播，准备推送`)
  lastLive = nowSec()

  for (const room of lives) {
    try {
      await fillLiveCover(room)
      queue.push(await buildLiveMessage(room))
      processQueue()
      if (getConfig().liveCloseNotify) liveUsers.set(room.uid, room.liveTime)
    } catch (err) {
      logger.error(`[bilibili-dynamic] 构建直播消息失败 ${room.uid}: ${err.message}`)
    }
  }
}

/**
 * 开播时封面兜底。
 * 关注列表（GetWebList）与批量状态接口返回的封面字段是 cover_from_user，
 * 开播瞬间可能为空串（keyframe 同样为空）；此时向房间详情接口补取，
 * 该接口返回的是另一个字段名 user_cover，实测有值。
 * 只在开播那一次补查，不影响轮询开销。
 */
async function fillLiveCover(room) {
  if (room.cover_from_user) return
  const detail = await Api.getLiveDetail(room.rid).catch((err) => {
    logger.warn(`[bilibili-dynamic] 房间详情查询失败 ${room.rid}: ${err.message}`)
    return null
  })
  if (!detail) return
  const cover = detail.user_cover || detail.keyframe || detail.cover || detail.cover_from_user || ''
  if (!cover) {
    logger.warn(`[bilibili-dynamic] 房间 ${room.rid} 详情接口同样没有封面（user_cover/keyframe/cover 均为空）`)
    return
  }
  room.cover_from_user = cover
  logger.info(`[bilibili-dynamic] 房间 ${room.rid} 列表接口封面为空，已从房间详情补取：${cover}`)
}

/** 收集当前在播的房间：关注列表 + 订阅补查 */
async function collectLiveRooms(following) {
  const rooms = new Map() // uid -> 归一化房间

  const liveList = await Api.getLiveList().catch((err) => {
    logger.warn(`[bilibili-dynamic] 直播列表接口失败: ${err.message}`)
    return null
  })
  if (Array.isArray(liveList?.rooms)) {
    for (const room of liveList.rooms) {
      const uid = String(room.uid)
      if (following.has(uid)) rooms.set(uid, normalizeRoom(room, '关注列表'))
    }
  }

  // 订阅了但没出现在关注列表里的，主动查状态（绕开"未关注"和"只取第一页"两个坑）
  const missing = [...following].filter((uid) => !rooms.has(uid))
  for (let i = 0; i < missing.length; i += 30) {
    const statusMap = await Api.getLiveStatus(missing.slice(i, i + 30)).catch((err) => {
      logger.warn(`[bilibili-dynamic] 直播状态查询失败: ${err.message}`)
      return null
    })
    for (const info of Object.values(statusMap ?? {})) {
      if (info?.live_status !== 1) continue
      const uid = String(info.uid)
      if (following.has(uid)) rooms.set(uid, normalizeRoom(info, '批量状态'))
    }
  }

  // 轮询结果校验：字段缺失/异常必须在日志里留痕，而不是静默走占位图
  for (const room of rooms.values()) {
    const problems = []
    if (!room.rid) problems.push('room_id 缺失')
    if (!room.uname) problems.push('uname 缺失')
    if (!room.title) problems.push('title 缺失')
    if (!room.face) problems.push('face 缺失')
    if (!room.cover_from_user) {
      problems.push(
        '封面字段均为空（原始值: ' +
          `cover_from_user=${JSON.stringify(room.rawCover.cover_from_user)}` +
          ` user_cover=${JSON.stringify(room.rawCover.user_cover)}` +
          ` cover=${JSON.stringify(room.rawCover.cover)}` +
          ` keyframe=${JSON.stringify(room.rawCover.keyframe)}）`,
      )
    }
    if (problems.length > 0) {
      logger.warn(`[bilibili-dynamic] 直播房间数据异常（来源=${room.source}）: ${problems.join('; ')} | 接口返回字段=[${room.rawKeys.join(',')}]`)
    }
  }

  return rooms
}

/** 把两个来源的房间字段统一成一份（构建消息时只认这套字段）；source 用于日志定位数据来自哪个接口 */
function normalizeRoom(raw, source) {
  const rid = raw.room_id ?? raw.roomid ?? 0
  return {
    uid: String(raw.uid),
    rid,
    room_id: rid,
    uname: raw.uname ?? raw.name ?? String(raw.uid),
    title: raw.title ?? '',
    face: raw.face ?? '',
    cover_from_user: raw.cover_from_user ?? raw.user_cover ?? raw.cover ?? raw.keyframe ?? '',
    area_v2_name: raw.area_v2_name ?? raw.area_name ?? raw.parent_area_name ?? '',
    liveTime: liveTimeOf(raw) || nowSec(),
    source,
    // 原始封面相关字段原样保留，供结果校验日志输出
    rawCover: {
      cover_from_user: raw.cover_from_user ?? null,
      user_cover: raw.user_cover ?? null,
      cover: raw.cover ?? null,
      keyframe: raw.keyframe ?? null,
    },
    rawKeys: Object.keys(raw),
    rawJson: JSON.stringify(raw),
  }
}

/** 开播时间（字段可能是 liveTime / live_time，值可能是秒级时间戳或 "yyyy-MM-dd HH:mm:ss"） */
function liveTimeOf(room) {
  return toSec(room?.liveTime ?? room?.live_time)
}

async function liveCloseLoop() {
  await sleep(40_000)
  while (running) {
    const cfg = getConfig()
    try {
      await liveCloseCheck()
    } catch (err) {
      logger.warn(`[bilibili-dynamic] 下播检测失败: ${err.message}`)
    }
    await sleep(Math.max(10, calcInterval(cfg.liveInterval ?? 20)) * 1000)
  }
}

export async function liveCloseCheck() {
  if (!getConfig().liveCloseNotify || liveUsers.size === 0) return
  const statusMap = await Api.getLiveStatus([...liveUsers.keys()])
  if (!statusMap) return

  const now = nowSec()
  for (const info of Object.values(statusMap)) {
    if (info.live_status === 1) continue
    const uid = String(info.uid)
    const liveTime = liveUsers.get(uid)
    if (liveTime == null) {
      logger.warn(`[bilibili-dynamic] 下播检测: 接口返回的 uid=${uid} 不在开播记录中，跳过下播通知（记录键=[${[...liveUsers.keys()].join(',')}]）`)
      continue
    }
    liveUsers.delete(uid)
    logger.info(
      `[bilibili-dynamic] 检测到下播 ${info.uname}(${uid}) 房间 ${info.room_id}，直播时长 ${formatDuration(now - liveTime)}`,
    )
    queue.push({
      kind: 'liveClose',
      contact: null,
      rid: info.room_id,
      mid: info.uid,
      name: info.uname,
      startTime: formatTime(liveTime),
      endTime: formatTime(now),
      duration: formatDuration(now - liveTime),
      title: info.title,
      area: info.area ?? '',
      link: `https://live.bilibili.com/${info.room_id}`,
    })
    processQueue()
  }
}

/* ------------------------------------------------------------------ */
/* 消息构建（对应 DynamicMessageTasker / LiveMessageTasker）              */
/* ------------------------------------------------------------------ */

async function buildDynamicMessage(item) {
  const cfg = getConfig()
  Dynamic.convertArticle(item)

  const mid = Dynamic.midOf(item)
  const color = Data.subColor(mid) ?? (Dynamic.pgcSeasonIdOf(item) != null
    ? getData().bangumi[String(Dynamic.pgcSeasonIdOf(item))]?.color
    : null)

  let draw = null
  if (cfg.drawEnable) {
    try {
      draw = await renderDynamic(item, color)
    } catch (err) {
      logger.error(`[bilibili-dynamic] 绘制动态失败 ${Dynamic.didOf(item)}: ${err.message}`)
    }
  }

  return {
    kind: 'dynamic',
    contact: null,
    did: Dynamic.didOf(item),
    mid,
    name: Dynamic.nameOf(item),
    type: item.type,
    pgcSsid: Dynamic.pgcSeasonIdOf(item),
    time: Dynamic.formatItemTime(item),
    timestamp: Dynamic.timeOf(item),
    content: Dynamic.textContent(item),
    images: Dynamic.imagesOf(item),
    links: Dynamic.linksOf(item),
    draw,
  }
}

/**
 * 命令直接请求动态详情时使用
 * 与推送走同一套模板，因此发出来是图文
 * @returns 分段数组，外层为多条消息
 */
export async function renderDirectDynamic(item, contact) {
  const cfg = getConfig()
  const message = await buildDynamicMessage(item)
  message.contact = contact

  const name = Data.templateOf('d', contact) ?? cfg.template?.dynamic ?? 'OneMsg'
  const template = cfg.dynamicTemplates?.[name]
  if (!template) {
    logger.warn(`[bilibili-dynamic] 动态详情: 模板 ${name} 不存在，退化为仅发送图片`)
    return [[global.segment.image(message.draw.buffer)]]
  }

  const messages = buildMessages(message, template, [contact])
  return messages.length > 0 ? messages : [[global.segment.image(message.draw.buffer)]]
}

async function buildLiveMessage(room) {
  const cfg = getConfig()
  const color = Data.subColor(room.uid)

  logger.info(
    `[bilibili-dynamic] 检测到开播 ${room.uname}(${room.uid}) 房间 ${room.rid} 来源=${room.source} ` +
      `封面=${room.cover_from_user || '(空，渲染时将使用占位图)'} | 响应 JSON: ${room.rawJson}`,
  )

  let draw = null
  if (cfg.drawEnable) {
    try {
      draw = await renderLive(
        {
          uid: room.uid,
          uname: room.uname,
          roomId: room.room_id,
          title: room.title,
          face: room.face,
          cover: room.cover_from_user,
          liveTime: liveTimeOf(room),
          area: room.area_v2_name,
        },
        color,
      )
    } catch (err) {
      logger.error(`[bilibili-dynamic] 绘制直播失败 ${room.uid}: ${err.message}`)
    }
  }

  return {
    kind: 'live',
    contact: null,
    rid: room.room_id,
    mid: room.uid,
    name: room.uname,
    time: formatTime(liveTimeOf(room)),
    timestamp: liveTimeOf(room),
    title: room.title,
    cover: room.cover_from_user,
    area: room.area_v2_name,
    link: `https://live.bilibili.com/${room.room_id}`,
    draw,
  }
}

/* ------------------------------------------------------------------ */
/* 目标筛选（对应 SendTasker.getDynamicContactList）                      */
/* ------------------------------------------------------------------ */

function applyFilter(contactList, mid, category, content, withRegular = true) {
  const data = getData()
  const filter = data.filter
  return contactList.filter((contact) => {
    const contactFilter = filter[contact]
    if (!contactFilter) return true
    const dynamicFilter = contactFilter[String(mid)] ?? contactFilter[0]
    if (!dynamicFilter) return true

    const typeSelect = dynamicFilter.typeSelect
    if (typeSelect?.list?.length > 0) {
      const hit = typeSelect.list.includes(category)
      if (typeSelect.mode === 'WHITE_LIST' && !hit) return false
      if (typeSelect.mode !== 'WHITE_LIST' && hit) return false
    }

    // 直播/下播不做正则过滤（对应 mirai getLiveContactList 只有 typeSelect）
    const regularSelect = withRegular ? dynamicFilter.regularSelect : null
    if (regularSelect?.list?.length > 0) {
      for (const regex of regularSelect.list) {
        let matched = false
        try {
          matched = new RegExp(regex).test(content)
        } catch {
          logger.warn(`[bilibili-dynamic] 正则过滤规则无效，已忽略: ${regex}`)
          continue
        }
        if (regularSelect.mode === 'WHITE_LIST' && !matched) return false
        if (regularSelect.mode !== 'WHITE_LIST' && matched) return false
      }
    }
    return true
  })
}

function getDynamicContactList(message) {
  // 番剧动态：直接使用番剧订阅的目标
  const ssid = message.pgcSsid
  if (ssid != null) {
    const bangumi = getData().bangumi[String(ssid)]
    return bangumi ? bangumi.contacts : []
  }

  const data = getData()
  const list = new Set(data.dynamic[0]?.contacts ?? [])
  const sub = data.dynamic[String(message.mid)]
  if (sub) {
    for (const c of sub.contacts) list.add(c)
  } else {
    return [...list]
  }
  return applyFilter([...list], message.mid, Data.filterCategoryOf(message.type), message.content)
}

function getLiveContactList(mid) {
  const data = getData()
  const list = new Set(data.dynamic[0]?.contacts ?? [])
  const sub = data.dynamic[String(mid)]
  if (sub) {
    for (const c of sub.contacts) list.add(c)
  } else {
    return [...list]
  }
  return applyFilter([...list], mid, 'LIVE', '', false)
}

/* ------------------------------------------------------------------ */
/* 模板渲染（对应 SendTasker.buildMessage / buildMsg）                    */
/* ------------------------------------------------------------------ */

const FORWARD_RE = /\{>>}([\s\S]*?)\{<<}/g
const TAG_RE = /\{([a-z]+)\}/g

function replaceTags(template, message) {
  return template.replace(TAG_RE, (raw, key) => {
    switch (key) {
      case 'name':
        return message.name
      case 'uid':
        return String(message.mid)
      case 'did':
        return String(message.did ?? '')
      case 'rid':
        return String(message.rid ?? '')
      case 'time':
        return message.kind === 'liveClose' ? message.startTime : message.time
      case 'type':
        return message.kind === 'live' || message.kind === 'liveClose'
          ? '直播'
          : Dynamic.typeText(message.type)
      case 'title':
        return message.title ?? ''
      case 'area':
        return message.area ?? ''
      case 'startTime':
        return message.startTime ?? message.time
      case 'endTime':
        return message.endTime ?? ''
      case 'duration':
        return message.duration ?? ''
      case 'content':
        return message.content ?? ''
      case 'link':
        return message.links?.[0]?.value ?? message.link ?? ''
      case 'links':
        return (message.links ?? [{ value: message.link ?? '' }]).map((l) => l.value).join('\n')
      case 'draw':
      case 'images':
      case 'cover':
        // 图片占位符：保留原样，由后续 TAG_RE 扫描 + imageOfTag 替换为图片段
        return raw
      default:
        return `[不支持的类型: ${key}]`
    }
  })
}

/**
 * 将模板渲染为多条消息（分段数组）
 * @returns segment[][]（外层数组 = 多条消息，内层数组 = 一条消息的段）
 */
export function buildMessages(message, template, contacts) {
  const messages = []

  const emitText = (text) => {
    // 按 \r 拆分为多条消息；文本中的 {draw}/{images}/{cover} 生成图片段
    const parts = text.split(/\r/)
    for (const part of parts) {
      const segments = []
      const imageTags = []
      TAG_RE.lastIndex = 0
      let match
      while ((match = TAG_RE.exec(part))) {
        imageTags.push({ key: match[1], index: match.index, raw: match[0] })
      }
      if (imageTags.length === 0) {
        segments.push(part)
      } else {
        let textRun = ''
        let cursor = 0
        for (const tag of imageTags) {
          textRun += part.slice(cursor, tag.index)
          if (textRun.trim()) segments.push(textRun)
          textRun = ''
          cursor = tag.index + tag.raw.length
          const image = imageOfTag(message, tag.key, contacts)
          if (image) segments.push(image)
        }
        textRun += part.slice(cursor)
        if (textRun.trim() || segments.length === 0) segments.push(textRun)
      }
      const finalSegments = segments.filter((s) => typeof s !== 'string' || s.trim() !== '')
      if (finalSegments.length > 0) messages.push(finalSegments)
    }
  }

  const makeForwardMsg =
    global.Bot?.makeForwardMsg?.bind(global.Bot) ?? global.segment?.makeForwardMsg?.bind(global.segment)

  const emitForward = (content) => {
    const segments = replaceTags(content, message)
      .split(/\r/)
      .flatMap((part) => {
        const out = []
        let textRun = ''
        let cursor = 0
        TAG_RE.lastIndex = 0
        let match
        while ((match = TAG_RE.exec(part))) {
          textRun += part.slice(cursor, match.index)
          cursor = match.index + match[0].length
          const image = imageOfTag(message, match[1], contacts)
          if (image) {
            out.push(textRun)
            out.push(image)
            textRun = ''
          }
        }
        textRun += part.slice(cursor)
        out.push(textRun)
        return out.filter((s) => (typeof s === 'string' ? s.trim() !== '' : true))
      })
    if (!makeForwardMsg || segments.length === 0) {
      messages.push(segments)
      return
    }
    const forward = makeForwardMsg([
      { nickname: message.name, user_id: message.mid, time: message.timestamp, messages: segments },
    ])
    messages.push([forward])
  }

  // 转发块与普通块分段处理
  let cursor = 0
  FORWARD_RE.lastIndex = 0
  let match
  while ((match = FORWARD_RE.exec(template))) {
    if (match.index > cursor) {
      emitText(replaceTags(template.slice(cursor, match.index), message))
    }
    emitForward(match[1])
    cursor = match.index + match[0].length
  }
  if (cursor < template.length) {
    emitText(replaceTags(template.slice(cursor), message))
  }

  return messages
}

function imageOfTag(message, key, contacts) {
  const segment = global.segment
  switch (key) {
    case 'draw':
      return message.draw?.buffer ? segment.image(message.draw.buffer) : null
    case 'images':
      // 多图仅支持在转发块内逐个展开；普通块取第一张
      return message.images?.length > 0 ? segment.image(message.images[0]) : null
    case 'cover':
      return message.cover ? segment.image(message.cover) : null
    default:
      return null
  }
}

/* ------------------------------------------------------------------ */
/* 发送（对应 SendTasker.main）                                          */
/* ------------------------------------------------------------------ */

async function processQueue() {
  if (processing) return
  processing = true
  try {
    while (queue.length > 0) {
      const message = queue.shift()
      try {
        await sendMessage(message)
        stats.pushed++
      } catch (err) {
        logger.error(`[bilibili-dynamic] 消息处理失败: ${err.message}`)
      }
      await sleep(getConfig().pushInterval ?? 500)
    }
  } finally {
    processing = false
  }
}

async function sendMessage(message) {
  const cfg = getConfig()
  const contactList =
    message.contact != null ? [message.contact] : message.kind === 'liveClose' || message.kind === 'live'
      ? getLiveContactList(message.mid)
      : getDynamicContactList(message)

  if (contactList.length === 0) {
    logger.warn(
      `[bilibili-dynamic] 推送跳过: ${message.kind} ${message.mid ?? ''} 没有可用的推送目标` +
        `（未配置联系人、联系人组为空、或全部被过滤器拦下，详见上方"跳过"日志）`,
    )
    return
  }

  // 模板选择：按目标配置分组，未配置的使用默认模板
  const templateKey =
    message.kind === 'dynamic' ? 'dynamic' : message.kind === 'live' ? 'live' : 'liveClose'
  const defaultTemplate = cfg.template?.[templateKey] ?? (templateKey === 'dynamic' ? 'OneMsg' : templateKey === 'live' ? 'OneMsg' : 'SimpleMsg')
  const templates = templateKey === 'dynamic' ? cfg.dynamicTemplates : templateKey === 'live' ? cfg.liveTemplates : cfg.liveCloseTemplates
  const templateKind = templateKey === 'dynamic' ? 'd' : templateKey === 'live' ? 'l' : 'c'
  const templateOfContact = (contact) => Data.templateOf(templateKind, contact) ?? defaultTemplate

  const groups = new Map()
  for (const contact of contactList) {
    const name = templateOfContact(contact)
    if (!groups.has(name)) groups.set(name, [])
    groups.get(name).push(contact)
  }

  for (const [name, contacts] of groups) {
    const template = templates?.[name]
    if (template == null) {
      logger.warn(`[bilibili-dynamic] 模板 ${name} 不存在，跳过`)
      continue
    }
    const messages = buildMessages(message, template, contacts)

    // 分组名展开为组内全部推送目标
    const targets = []
    for (const contact of contacts) {
      const expanded = Data.expandGroupContact(contact)
      if (expanded) for (const c of expanded) targets.push(c)
      else targets.push(contact)
    }

    for (const contact of targets) {
      // @全体
      let withAtAll = false
      if (message.kind !== 'liveClose' && !message.contact) {
        withAtAll = Data.checkAtAll(contact, message.mid, message.type)
      }

      const { type, id } = Data.parseContact(contact)
      const pick =
        type === 'group' ? global.Bot?.pickGroup?.(id) : global.Bot?.pickFriend?.(id)
      if (!pick) {
        logger.warn(`[bilibili-dynamic] 无法找到推送目标 ${Data.contactLabel(contact)}`)
        continue
      }

      try {
        const list = [...messages]
        if (withAtAll) {
          const atAll = global.segment.at('all')
          if (cfg.atAllPlus !== 'SINGLE_MESSAGE') {
            const last = list[list.length - 1]
            if (last && last.length > 0 && typeof last[last.length - 1] === 'string') {
              last[last.length - 1] += '\n'
              last.push(atAll)
            } else if (last) {
              last.push('\n', atAll)
            }
          } else {
            list.push([atAll])
          }
        }
        for (const segments of list) {
          await pick.sendMsg(segments)
          await sleep(cfg.messageInterval ?? 100)
        }
      } catch (err) {
        logger.error(`[bilibili-dynamic] 发送到 ${Data.contactLabel(contact)} 失败: ${err.message}`)
      }
      await sleep(cfg.pushInterval ?? 500)
    }
  }
}

/* ------------------------------------------------------------------ */
/* 缓存清理（对应 CacheClearTasker）                                     */
/* ------------------------------------------------------------------ */

async function cacheLoop() {
  while (running) {
    const day = today()
    const hour = hourOf()
    if (lastCacheClearDay !== day && hour === 4) {
      lastCacheClearDay = day
      try {
        clearCache(getConfig().cacheClearDays ?? 7)
        await resetRuntime()
      } catch (err) {
        logger.warn(`[bilibili-dynamic] 缓存清理失败: ${err.message}`)
      }
    }
    await sleep(3_600_000)
  }
}

/* ------------------------------------------------------------------ */
/* 数据保存兜底                                                          */
/* ------------------------------------------------------------------ */

process.on('exit', () => {
  try {
    saveDataNow()
  } catch {}
})
