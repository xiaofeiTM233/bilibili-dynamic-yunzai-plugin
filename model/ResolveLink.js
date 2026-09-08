/**
 * 链接解析 —— 移植自 ResolveLinkService.kt
 *
 * matchingRegular(content) -> { type, id }
 * drawGeneral(type, id)    -> { buffer, path } | null
 * getLink(type, id)        -> 原始链接
 */
import { getConfig } from './Config.js'
import * as Api from './Api.js'
import * as Data from './Data.js'
import * as Dynamic from './Dynamic.js'
import { renderDynamic, renderSearchCard } from './Render.js'
import { formatTime } from './Utils.js'

const logger = global.logger ?? console

/** 链接类型与正则（对应 LinkType，短链优先） */
export const LINK_TYPES = [
  {
    name: 'ShortLink',
    regexes: [/(?:b23\.tv|bili2233\.cn)\\?\/([0-9A-z]+)/],
    getLink: (id) => `https://b23.tv/${id}`,
  },
  {
    name: 'VideoLink',
    regexes: [/(?:www\.bilibili\.com\/video\/)?((?:BV[0-9A-z]{10})|(?:av\d{1,20}))/],
    getLink: (id) => `https://www.bilibili.com/video/${id}`,
  },
  {
    name: 'Article',
    regexes: [/(?:www\.bilibili\.com\/read\/)?cv(\d{1,10})/, /(?:www\.bilibili\.com\/read\/mobile\/)(\d{1,10})/],
    getLink: (id) => `https://www.bilibili.com/read/cv${id}`,
  },
  {
    name: 'Dynamic',
    regexes: [/[tm]\.bilibili\.com\/(?:dynamic\/)?(\d+)/, /(?:www|m)\.bilibili\.com\/opus\/(\d+)/],
    getLink: (id) => `https://t.bilibili.com/${id}`,
  },
  {
    name: 'Live',
    regexes: [/live\.bilibili\.com\/(?:h5\/)?(\d+)/],
    getLink: (id) => `https://live.bilibili.com/${id}`,
  },
  {
    name: 'User',
    regexes: [/space\.bilibili\.com\/(\d+)/],
    getLink: (id) => `https://space.bilibili.com/${id}`,
  },
  {
    name: 'Pgc',
    regexes: [/(?:(?:www|m)\.bilibili\.com\/bangumi\/(?:play|media)\/)?((?:ss|ep|md)\d+)/],
    getLink: (id) => `https://www.bilibili.com/bangumi/play/${id}`,
  },
]

/** 默认入口正则（对应 BiliConfig.linkResolveConfig.regex） */
export const DEFAULT_RESOLVE_REGEXES = [
  '(www\\.bilibili\\.com/video/((BV[0-9A-z]{10})|(av\\d{1,20})))|^(BV[0-9A-z]{10})|^(av\\d{1,20})',
  '(www\\.bilibili\\.com/read/cv\\d{1,10})|^(cv\\d{1,10})|(www\\.bilibili\\.com/read/mobile/\\d{1,10})',
  '((www|m)\\.bilibili\\.com/bangumi/(play|media)/(ss|ep|md)\\d+)|^((ss|ep|md)\\d+)',
  '([tm]\\.bilibili\\.com/(dynamic/)?\\d+)|(www\\.bilibili\\.com/opus/\\d+)',
  'live\\.bilibili\\.com/(h5/)?\\d+',
  'space\\.bilibili\\.com/\\d+',
  '(b23\\.tv|bili2233\\.cn)\\\\?/[0-9A-z]+',
]

/**
 * 匹配消息中的 B 站链接（先走入口正则门禁，再逐类型匹配）
 * @returns { type, id } | null
 */
export function matchingRegular(content) {
  const gate = getConfigRegexes()
  if (gate.length > 0 && !gate.some((reg) => { try { return new RegExp(reg).test(content) } catch { return false } })) {
    return null
  }
  return matchingInternalRegular(content)
}

function getConfigRegexes() {
  const cfg = getConfig()?.linkResolve
  if (!cfg?.regex || cfg.regex.length === 0) return []
  return cfg.regex
}

/** 逐类型匹配（短链优先，对应 matchingInternalRegular） */
export function matchingInternalRegular(content) {
  for (const linkType of LINK_TYPES) {
    for (const regex of linkType.regexes) {
      const m = regex.exec(content)
      if (m) return { type: linkType.name, id: m[1] }
    }
  }
  return null
}

/** 解析结果对应的原始链接（对应 LinkType.getLink） */
export function getLink(type, id) {
  return LINK_TYPES.find((t) => t.name === type)?.getLink(id) ?? ''
}

/** 短链重定向（对应 biliClient.redirect） */
async function redirect(id) {
  try {
    const response = await fetch(`https://b23.tv/${id}`, { redirect: 'manual', signal: AbortSignal.timeout(10_000) })
    return response.headers.get('location')
  } catch (err) {
    logger.warn(`[bilibili-dynamic] 短链重定向失败 ${id}: ${err.message}`)
    return null
  }
}

/** 解析结果绘制（对应 LinkType.drawGeneral），失败返回 null */
export async function drawGeneral(type, id) {
  switch (type) {
    case 'VideoLink': {
      const v = await Api.getVideoDetail(id)
      if (!v) return null
      return renderSearchCard({
        id: v.bvid ?? id,
        tag: '视频',
        time: v.pubdate ? formatTime(v.pubdate) : '',
        author: Dynamic.plainAuthor({ mid: v.owner?.mid ?? 0, name: v.owner?.name ?? '', face: v.owner?.face ?? null }),
        major: Dynamic.videoToArchive(v),
        link: `https://www.bilibili.com/video/${v.bvid ?? id}`,
      })
    }
    case 'Article': {
      const a = await Api.getArticleDetail(`cv${id}`)
      if (!a) return null
      return renderSearchCard({
        id,
        tag: '专栏',
        time: a.publish_time ? formatTime(a.publish_time) : '',
        author: Dynamic.plainAuthor({ mid: a.author?.mid ?? 0, name: a.author?.name ?? '', face: a.author?.face ?? null }),
        major: Dynamic.articleToMajor(a),
        link: `https://www.bilibili.com/read/cv${id}`,
      })
    }
    case 'Dynamic': {
      const item = await Api.getDynamicDetail(id)
      if (!item) return null
      Dynamic.convertArticle(item)
      const { buffer } = await renderDynamic(item, Data.subColor(Dynamic.midOf(item)))
      return { buffer, path: null }
    }
    case 'Live': {
      const room = await Api.getLiveDetail(id)
      if (!room) return null
      const user = await Api.userInfo(room.uid).catch(() => null)
      return renderSearchCard({
        id,
        tag: '直播',
        time: formatTime(),
        author: Dynamic.plainAuthor({
          mid: user?.mid ?? room.uid ?? 0,
          name: user?.name ?? '',
          face: user?.face ?? null,
          verifyType: user?.official?.type ?? null,
        }),
        live: {
          uid: room.uid,
          uname: user?.name ?? '',
          roomId: room.room_id,
          title: room.title,
          face: user?.face ?? null,
          cover: room.user_cover || room.keyframe || '',
          area: `${room.parent_area_name ?? ''}·${room.area_name ?? ''}`,
        },
        link: `https://live.bilibili.com/${id}`,
      })
    }
    case 'User': {
      const user = await Api.userInfo(id)
      if (!user) return null
      return renderSearchCard({
        id,
        tag: '用户',
        time: formatTime(),
        author: Dynamic.plainAuthor({
          mid: user.mid ?? Number(id),
          name: user.name ?? '',
          face: user.face ?? null,
          verifyType: user.official?.type ?? null,
        }),
        link: `https://space.bilibili.com/${id}`,
      })
    }
    case 'Pgc': {
      const m = /^(ss|ep|md)(\d+)$/.exec(id)
      if (!m) return null
      const info =
        m[1] === 'ss'
          ? await Api.getSeasonInfo(m[2])
          : m[1] === 'ep'
            ? await Api.getEpisodeInfo(m[2])
            : await Api.getMediaInfo(m[2])
      if (!info) return null
      const major = Dynamic.pgcToMajor(info)
      if (!major) return null
      return renderSearchCard({
        id,
        tag: '番剧',
        time: formatTime(),
        author: Dynamic.plainAuthor(major.author ?? { mid: 0, name: major.pgc?.title ?? '', face: major.pgc?.cover ?? null }),
        major,
        link: `https://www.bilibili.com/bangumi/play/${id}`,
      })
    }
    case 'ShortLink': {
      const link = await redirect(id)
      if (!link) return null
      const resolved = matchingInternalRegular(link)
      if (!resolved) return null
      return drawGeneral(resolved.type, resolved.id)
    }
    default:
      return null
  }
}
