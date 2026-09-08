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
import { formatTime, formatDuration, sleep, nowSec, today, hourOf } from './Utils.js'

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
  if (!list?.items) return
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

export async function liveCheck() {
  const data = getData()
  if (!data.cookie) return
  if (Data.allContacts().length === 0) return

  const liveList = await Api.getLiveList()
  if (!liveList?.rooms) return
  stats.liveChecks++

  const following = new Set(Data.subscribedUids().map(String))
  const lives = liveList.rooms
    .filter((room) => room.live_time > lastLive)
    .filter((room) => following.has(String(room.uid)))
    .sort((a, b) => a.live_time - b.live_time)

  if (lives.length === 0) return
  lastLive = lives[lives.length - 1].live_time

  for (const room of lives) {
    try {
      const message = await buildLiveMessage(room)
      queue.push(message)
      processQueue()
      if (getConfig().liveCloseNotify) liveUsers.set(room.uid, room.live_time)
    } catch (err) {
      logger.error(`[bilibili-dynamic] 构建直播消息失败 ${room.uid}: ${err.message}`)
    }
  }
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
    const liveTime = liveUsers.get(info.uid)
    if (liveTime == null) continue
    liveUsers.delete(info.uid)
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
  if (!template) return [[global.segment.image(message.draw.buffer)]]

  const messages = buildMessages(message, template, [contact])
  return messages.length > 0 ? messages : [[global.segment.image(message.draw.buffer)]]
}

async function buildLiveMessage(room) {
  const cfg = getConfig()
  const color = Data.subColor(room.uid)

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
          liveTime: room.live_time,
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
    time: formatTime(room.live_time),
    timestamp: room.live_time,
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

function applyFilter(contactList, mid, category, content) {
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

    const regularSelect = dynamicFilter.regularSelect
    if (regularSelect?.list?.length > 0) {
      for (const regex of regularSelect.list) {
        let matched = false
        try {
          matched = new RegExp(regex).test(content)
        } catch {
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
  return applyFilter([...list], mid, 'live', '')
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

  if (contactList.length === 0) return

  // 模板选择：按目标配置分组，未配置的使用默认模板
  const templateKey =
    message.kind === 'dynamic' ? 'dynamic' : message.kind === 'live' ? 'live' : 'liveClose'
  const defaultTemplate = cfg.template?.[templateKey] ?? (templateKey === 'dynamic' ? 'OneMsg' : templateKey === 'live' ? 'OneMsg' : 'SimpleMsg')
  const templates = templateKey === 'dynamic' ? cfg.dynamicTemplates : templateKey === 'live' ? cfg.liveTemplates : cfg.liveCloseTemplates
  const templateOfContact = (contact) =>
    Data.templateOf(templateKey === 'dynamic' ? 'd' : templateKey === 'l' ? 'l' : 'c', contact) ?? defaultTemplate

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
