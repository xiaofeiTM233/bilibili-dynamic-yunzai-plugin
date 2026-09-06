/**
 * B 站 API 客户端 —— 移植自 api/*.kt + client/BiliClient.kt
 */
import crypto from 'node:crypto'
import { getConfig, getData, saveData } from './Config.js'
import { md5 } from './Utils.js'

const logger = global.logger ?? console

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

export const Api = {
  LOGIN_QRCODE: 'https://passport.bilibili.com/x/passport-login/web/qrcode/generate',
  LOGIN_INFO: 'https://passport.bilibili.com/x/passport-login/web/qrcode/poll',

  NEW_DYNAMIC: 'https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/all',
  SPACE_DYNAMIC: 'https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/space',
  DYNAMIC_DETAIL: 'https://api.bilibili.com/x/polymer/web-dynamic/v1/detail',

  VIDEO_DETAIL: 'https://api.bilibili.com/x/web-interface/view',
  ARTICLE_LIST: 'https://api.bilibili.com/x/article/cards',

  LIVE_LIST: 'https://api.live.bilibili.com/xlive/web-ucenter/v1/xfetter/GetWebList',
  LIVE_STATUS_BATCH: 'https://api.live.bilibili.com/room/v1/Room/get_status_info_by_uids',
  LIVE_DETAIL: 'https://api.live.bilibili.com/room/v1/Room/get_info',

  SEARCH: 'https://api.bilibili.com/x/web-interface/search/type',
  USER_INFO_WBI: 'https://api.bilibili.com/x/space/wbi/acc/info',
  USER_NAV: 'https://api.bilibili.com/x/web-interface/nav',
  SPACE_SEARCH: 'https://api.bilibili.com/x/space/wbi/arc/search',

  IS_FOLLOW: 'https://api.bilibili.com/x/relation',
  FOLLOW: 'https://api.bilibili.com/x/relation/modify',
  GROUP_LIST: 'https://api.bilibili.com/x/relation/tags',
  CREATE_GROUP: 'https://api.bilibili.com/x/relation/tag/create',
  ADD_USER: 'https://api.bilibili.com/x/relation/tags/addUsers',

  PGC_MEDIA_INFO: 'https://api.bilibili.com/pgc/review/user',
  PGC_INFO: 'https://api.bilibili.com/pgc/view/web/season',
  FOLLOW_PGC: 'https://api.bilibili.com/pgc/web/follow/add',
}

/** 登录失效异常，指令层捕获后提示重新登录 */
export class LoginExpiredError extends Error {
  constructor() {
    super('账号登录失效，请使用 #bili登录 重新登录')
    this.name = 'LoginExpiredError'
  }
}

function cookieString() {
  const data = getData()
  // buvid3 为风控必需（-352），未登录/无 cookie 时本地生成并持久化
  if (!data.buvid3) {
    data.buvid3 = crypto.randomUUID().toUpperCase() + 'infoc'
    data.buvid4 = crypto.randomUUID().toUpperCase() + 'infoc'
    saveData()
  }
  const parts = []
  if (data.cookie) parts.push(data.cookie.replace(/;\s*$/, '; '))
  if (data.uid) parts.push(`DedeUserID=${data.uid}`)
  parts.push(`buvid3=${data.buvid3}`, `buvid4=${data.buvid4}`, `b_nut=${Math.floor(Date.now() / 1000)}`)
  return parts.join(' ')
}

let loginNotified = false
export function resetLoginNotify() {
  loginNotified = false
}

function fetchOptions(method = 'GET', extra = {}) {
  const cfg = getConfig()
  const options = {
    method,
    headers: {
      'User-Agent': UA,
      Referer: 'https://t.bilibili.com',
      Origin: 'https://t.bilibili.com',
      Cookie: cookieString(),
      ...extra.headers,
    },
    signal: AbortSignal.timeout((cfg.timeout ?? 10) * 1000),
    ...extra,
  }
  return options
}

async function request(url, options) {
  const response = await fetch(url, options)
  if (!response.ok) throw new Error(`请求失败 HTTP ${response.status}: ${url}`)
  return response.json()
}

function query(params = {}) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    if (Array.isArray(value)) {
      // 数组参数逐个展开（如直播状态批量接口的 uids[]）
      for (const item of value) search.append(key, item)
    } else {
      search.append(key, value)
    }
  }
  return search.toString()
}

/** 检查 BiliResult 并返回 data（对应 getData） */
async function getDataResult(url, params, options = {}) {
  const qs = query(params)
  const full = qs ? `${url}?${qs}` : url
  const res = await request(full, fetchOptions('GET', options))
  if (res.code === -101) {
    if (!loginNotified) {
      loginNotified = true
      notifyLoginExpired()
    }
    throw new LoginExpiredError()
  }
  if (res.code !== 0 || res.data == null) {
    throw new Error(`CODE: ${res.code}, MSG: ${res.message ?? ''} (${url})`)
  }
  return res.data
}

function notifyLoginExpired() {
  const admin = adminId()
  const message = '[bilibili-dynamic] B 站账号登录失效，请使用 #bili登录 重新登录'
  logger.warn(message)
  if (admin && global.Bot?.pickFriend) {
    try {
      Bot.pickFriend(admin).sendMsg(message)
    } catch {}
  }
}

export function adminId() {
  const cfg = getConfig()
  if (cfg.admin) return String(cfg.admin)
  // 未配置时取 Yunzai 主人列表的第一个
  const masters = global.Bot?.master
  if (Array.isArray(masters) && masters.length > 0) return String(masters[0])
  if (masters && typeof masters === 'object' && masters.size > 0) return String(masters.values().next().value)
  return null
}

/** POST 表单（关注/追番等需要 csrf 的接口） */
async function postForm(url, body, params) {
  const form = query(body)
  const qs = query(params)
  const full = qs ? `${url}?${qs}` : url
  const res = await request(full, fetchOptions('POST', {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
  }))
  if (res.code === -101) {
    if (!loginNotified) {
      loginNotified = true
      notifyLoginExpired()
    }
    throw new LoginExpiredError()
  }
  return res
}

/* ------------------------------------------------------------------ */
/* WBI 签名（对应 getDataWithWbi / getVerifyString）                     */
/* ------------------------------------------------------------------ */

const WBI_KEY_TABLE = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61,
  26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36,
  20, 34, 44, 52,
]

let wbiCache = null // { mixinKey, day }

function splitUrl(url) {
  return url.replace(/\/+$/, '').split('/').pop().split('.')[0]
}

async function getMixinKey() {
  const day = new Date().toDateString()
  if (wbiCache && wbiCache.day === day) return wbiCache.mixinKey
  const data = await getDataResult(Api.USER_NAV)
  const img = data.wbi_img?.img_url
  const sub = data.wbi_img?.sub_url
  if (!img || !sub) throw new Error('获取 wbi 签名参数失败')
  const raw = splitUrl(img) + splitUrl(sub)
  const mixinKey = WBI_KEY_TABLE.filter((i) => i < raw.length)
    .map((i) => raw[i])
    .join('')
    .slice(0, 32)
  wbiCache = { mixinKey, day }
  return mixinKey
}

/** WBI 签名 GET */
async function getWithWbi(url, params) {
  const mixinKey = await getMixinKey()
  const wts = Math.floor(Date.now() / 1000)
  const all = { ...params, wts }
  const sorted = Object.keys(all)
    .sort()
    .map((key) => `${key}=${all[key]}`)
    .join('&')
  const wRid = md5(sorted + mixinKey)
  return getDataResult(url, { ...params, wts, w_rid: wRid })
}

/* ------------------------------------------------------------------ */
/* 登录                                                                 */
/* ------------------------------------------------------------------ */

export async function getLoginQrcode() {
  return getDataResult(Api.LOGIN_QRCODE)
}

export async function pollLoginInfo(qrcodeKey) {
  return getDataResult(Api.LOGIN_INFO, { qrcode_key: qrcodeKey })
}

/** 登录成功后从回调 URL 中解析 cookie 并保存（对应 LoginService.login） */
export function saveLoginCookie(url) {
  const queryStr = new URL(url).search
  let sessData = ''
  let biliJct = ''
  let dedeUserId = ''
  for (const [key, value] of new URLSearchParams(queryStr)) {
    if (key === 'SESSDATA') sessData = value.replace(/,/g, '%2C').replace(/\*/g, '%2A')
    if (key === 'bili_jct') biliJct = value
    if (key === 'DedeUserID') dedeUserId = value
  }
  if (!sessData || !biliJct) throw new Error('返回数据中缺少 SESSDATA/bili_jct')
  const data = getData()
  data.cookie = `SESSDATA=${sessData}; bili_jct=${biliJct}; `
  if (dedeUserId) data.uid = dedeUserId
  saveData()
  resetLoginNotify()
  return data.uid
}

/* ------------------------------------------------------------------ */
/* 动态                                                                 */
/* ------------------------------------------------------------------ */

/** 获取账号全部最新动态 */
export async function getNewDynamic(page = 1, type = 'all') {
  return getDataResult(Api.NEW_DYNAMIC, {
    timezone_offset: '-480',
    type,
    page,
    features: 'itemOpusStyle',
  })
}

/** 获取用户最新动态（hasTop 时走 SPACE_DYNAMIC，包含置顶） */
export async function getUserNewDynamic(uid, hasTop = false, offset = '') {
  return getDataResult(hasTop ? Api.SPACE_DYNAMIC : Api.NEW_DYNAMIC, {
    timezone_offset: '-480',
    host_mid: uid,
    offset,
    features: 'itemOpusStyle',
  })
}

/** 获取指定动态详情 */
export async function getDynamicDetail(did) {
  const data = await getDataResult(Api.DYNAMIC_DETAIL, {
    timezone_offset: '-480',
    id: did,
    features: 'itemOpusStyle',
  })
  return data.item
}

export async function getVideoDetail(id) {
  return getDataResult(Api.VIDEO_DETAIL, id.includes('BV') ? { bvid: id } : { aid: id.replace(/^av/i, '') })
}

export async function getArticleList(ids) {
  return getDataResult(Api.ARTICLE_LIST, { ids: ids.join(',') })
}

export async function getArticleDetail(id) {
  const list = await getArticleList([id.replace(/^cv/i, '')])
  return list?.[id.replace(/^cv/i, '')] ?? null
}

/* ------------------------------------------------------------------ */
/* 直播                                                                 */
/* ------------------------------------------------------------------ */

export async function getLiveList(page = 1, pageSize = 20) {
  return getDataResult(Api.LIVE_LIST, { page, page_size: pageSize })
}

export async function getLiveStatus(uids) {
  return getDataResult(Api.LIVE_STATUS_BATCH, { 'uids[]': uids })
}

export async function getLiveDetail(roomId) {
  return getDataResult(Api.LIVE_DETAIL, { room_id: roomId })
}

/* ------------------------------------------------------------------ */
/* 用户 / 关注                                                          */
/* ------------------------------------------------------------------ */

export async function userInfo(uid) {
  return getWithWbi(Api.USER_INFO_WBI, { mid: uid })
}

export async function isFollowed(fid) {
  return getDataResult(Api.IS_FOLLOW, { fid })
}

export async function followGroupList() {
  return getDataResult(Api.GROUP_LIST)
}

export async function createFollowGroup(tagName) {
  const res = await postForm(Api.CREATE_GROUP, { tag: tagName, csrf: getData().cookie.match(/bili_jct=([^;]+)/)?.[1] ?? '' })
  if (res.code !== 0) throw new Error(`创建关注分组失败: ${res.message}`)
  return res.data
}

export async function followUser(uid) {
  return postForm(Api.FOLLOW, {
    fid: uid,
    act: 1,
    re_src: 11,
    csrf: getData().cookie.match(/bili_jct=([^;]+)/)?.[1] ?? '',
  })
}

export async function groupAddUser(uid, tagid) {
  return postForm(Api.ADD_USER, {
    fids: uid,
    tagids: tagid,
    csrf: getData().cookie.match(/bili_jct=([^;]+)/)?.[1] ?? '',
  })
}

/** 自动关注（对应 DynamicService.followUser），返回错误信息或 null */
export async function autoFollow(uid) {
  const data = getData()
  const res = await isFollowed(uid)
  const attribute = res.attribute
  if (attribute === 0) {
    if (!getConfig().autoFollow) return '未关注此用户'
    const followRes = await followUser(uid)
    if (followRes.code !== 0) return `关注失败: ${followRes.message}`
    if (data.tagid) {
      try {
        await groupAddUser(uid, data.tagid)
      } catch (err) {
        logger.warn(`[bilibili-dynamic] 移动关注分组失败: ${err.message}`)
      }
    }
    return null
  }
  if (attribute === 128) return '此账号已被拉黑'
  return null
}

/** 初始化自动关注分组（对应 initTagid） */
export async function initFollowGroup() {
  const cfg = getConfig()
  if (!cfg.autoFollow || !cfg.followGroup) return
  try {
    const groups = await followGroupList()
    const found = groups.find((g) => g.name === cfg.followGroup)
    if (found) {
      getData().tagid = found.tagid
      saveData()
      return
    }
    const created = await createFollowGroup(cfg.followGroup)
    getData().tagid = created.tagid
    saveData()
  } catch (err) {
    logger.warn(`[bilibili-dynamic] 初始化关注分组失败: ${err.message}`)
  }
}

/* ------------------------------------------------------------------ */
/* 搜索                                                                 */
/* ------------------------------------------------------------------ */

export async function searchUser(keyword, page = 1, pageSize = 20) {
  return getDataResult(Api.SEARCH, {
    page,
    page_size: pageSize,
    search_type: 'bili_user',
    keyword,
  })
}

export async function searchUserVideo(uid, count = 1) {
  return getWithWbi(Api.SPACE_SEARCH, { mid: uid, ps: count, order: 'pubdate' })
}

/* ------------------------------------------------------------------ */
/* 番剧                                                                 */
/* ------------------------------------------------------------------ */

async function pgcGet(url, params) {
  const qs = query(params)
  const full = qs ? `${url}?${qs}` : url
  const res = await request(full, fetchOptions('GET'))
  if (res.code !== 0 || res.result == null) {
    throw new Error(`CODE: ${res.code}, MSG: ${res.message ?? ''} (${url})`)
  }
  return res.result
}

export async function getSeasonInfo(ssid) {
  return pgcGet(Api.PGC_INFO, { season_id: ssid })
}

export async function getEpisodeInfo(epid) {
  return pgcGet(Api.PGC_INFO, { ep_id: epid })
}

export async function getMediaInfo(mdid) {
  return pgcGet(Api.PGC_MEDIA_INFO, { media_id: mdid })
}

export async function followPgc(ssid) {
  const res = await postForm(Api.FOLLOW_PGC, {
    season_id: ssid,
    csrf: getData().cookie.match(/bili_jct=([^;]+)/)?.[1] ?? '',
  })
  return res.result
}
