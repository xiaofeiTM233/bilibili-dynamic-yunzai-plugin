/**
 * 动态数据装配 —— 移植自 data/Dynamic.kt + tasker/DynamicMessageTasker.kt
 *
 * 负责：
 * 1. B 站 API 动态数据 -> canvaskit 绘制结构（AuthorInfo / DynamicModules）
 * 2. 模板所需的文本内容 / 图片列表 / 链接列表提取
 */
import { formatTime, formatDuration } from './Utils.js'

/** 动态类型文本（对应 DynamicType.text） */
export const DYNAMIC_TYPE_TEXT = {
  DYNAMIC_TYPE_WORD: '动态',
  DYNAMIC_TYPE_DRAW: '动态',
  DYNAMIC_TYPE_ARTICLE: '专栏',
  DYNAMIC_TYPE_FORWARD: '转发动态',
  DYNAMIC_TYPE_AV: '投稿视频',
  DYNAMIC_TYPE_MUSIC: '音乐',
  DYNAMIC_TYPE_LIVE: '直播',
  DYNAMIC_TYPE_LIVE_RCMD: '直播',
  DYNAMIC_TYPE_PGC: '番剧',
  DYNAMIC_TYPE_PGC_UNION: '番剧',
  DYNAMIC_TYPE_COMMON_SQUARE: '动态',
  DYNAMIC_TYPE_COMMON_VERTICAL: '动态',
  DYNAMIC_TYPE_UGC_SEASON: '合集',
  DYNAMIC_TYPE_NONE: '动态被删除',
  DYNAMIC_TYPE_UNKNOWN: '未知的动态',
}

export function typeText(type) {
  return DYNAMIC_TYPE_TEXT[type] ?? DYNAMIC_TYPE_TEXT.DYNAMIC_TYPE_UNKNOWN
}

export const LIVE_BAN_TYPES = ['DYNAMIC_TYPE_LIVE', 'DYNAMIC_TYPE_LIVE_RCMD']

/* ------------------------------------------------------------------ */
/* 基本字段                                                             */
/* ------------------------------------------------------------------ */

export function didOf(item) {
  return item?.id_str ?? '0'
}

export function midOf(item) {
  return item?.modules?.module_author?.mid ?? 0
}

export function nameOf(item) {
  return item?.modules?.module_author?.name ?? ''
}

/** 动态时间戳：did 高 32 位 + 偏移（对应 DynamicItem.time） */
export function timeOf(item) {
  const did = Number(didOf(item))
  if (!Number.isFinite(did) || did <= 0) {
    return item?.modules?.module_author?.pub_ts ?? 0
  }
  return Math.floor(did / 2 ** 32) + 1498838400
}

export function formatItemTime(item) {
  return formatTime(timeOf(item))
}

/** 动态链接（对应 DynamicItem.link） */
export function linkOf(item) {
  const major = item?.modules?.module_dynamic?.major
  switch (item?.type) {
    case 'DYNAMIC_TYPE_ARTICLE':
      return `https://www.bilibili.com/read/cv${major?.article?.id ?? didOf(item)}`
    case 'DYNAMIC_TYPE_AV':
      return `https://www.bilibili.com/video/${major?.archive?.bvid ?? `av${major?.archive?.aid ?? ''}`}`
    case 'DYNAMIC_TYPE_MUSIC':
      return `https://www.bilibili.com/audio/au${major?.music?.id ?? ''}`
    case 'DYNAMIC_TYPE_LIVE':
    case 'DYNAMIC_TYPE_LIVE_RCMD':
      return `https://live.bilibili.com/${major?.live?.id ?? liveRcmdRoomId(item) ?? ''}`
    case 'DYNAMIC_TYPE_PGC':
    case 'DYNAMIC_TYPE_PGC_UNION':
      return `https://www.bilibili.com/bangumi/play/ep${major?.pgc?.epid ?? ''}`
    case 'DYNAMIC_TYPE_UGC_SEASON':
      return `https://www.bilibili.com/video/av${major?.ugc_season?.aid ?? ''}`
    case 'DYNAMIC_TYPE_NONE':
      return ''
    default:
      return `https://t.bilibili.com/${didOf(item)}`
  }
}

function liveRcmdInfo(item) {
  const content = item?.modules?.module_dynamic?.major?.live_rcmd?.content
  if (!content) return null
  if (typeof content === 'object') return content.live_play_info ?? null
  try {
    return JSON.parse(content).live_play_info ?? null
  } catch {
    return null
  }
}

export function liveRcmdRoomId(item) {
  return liveRcmdInfo(item)?.room_id ?? null
}

/* ------------------------------------------------------------------ */
/* 绘制数据装配                                                          */
/* ------------------------------------------------------------------ */

/** 作者区绘制信息（对应 AuthorInfo） */
export function toAuthorInfo(item) {
  const author = item?.modules?.module_author ?? {}
  const decorate = author.decorate
  return {
    name: author.name ?? '',
    mid: author.mid ?? 0,
    face: author.face ?? null,
    pendant: author.pendant?.image ?? null,
    verifyType: author.official_verify?.type ?? null,
    fanCardUrl: decorate?.card_url ?? null,
    fanType: decorate?.type,
    fanNumStr: decorate?.fan?.num_str,
    fanColor: decorate?.fan?.color ?? undefined,
    iconBadge: author.icon_badge?.render_img ? { renderImg: author.icon_badge.render_img } : null,
  }
}

/** 通用作者信息（视频/专栏/直播/番剧搜索卡用） */
export function plainAuthor({ mid = 0, name = '', face = null, pendant = null, verifyType = null }) {
  return {
    name,
    mid,
    face,
    pendant,
    verifyType,
    fanCardUrl: null,
    fanType: undefined,
    fanNumStr: undefined,
    fanColor: undefined,
    iconBadge: null,
  }
}

/** 富文本节点 -> 绘制结构（保留 B 站小表情 iconUrl） */
function toContentDesc(desc) {
  if (!desc) return null
  return {
    text: desc.text ?? '',
    richTextNodes: (desc.rich_text_nodes ?? []).map((node) => ({
      type: node.type,
      origText: node.orig_text,
      text: node.text,
      emoji: node.emoji?.icon_url ? { iconUrl: node.emoji.icon_url } : undefined,
    })),
  }
}

function toBadge(badge, fallbackText = '') {
  if (!badge) return { text: fallbackText }
  return { text: badge.text ?? fallbackText, color: badge.color, bgColor: badge.bg_color }
}

function toArchive(archive) {
  if (!archive) return null
  return {
    title: archive.title ?? '',
    desc: archive.desc ?? null,
    cover: archive.cover ?? '',
    badge: toBadge(archive.badge, '视频'),
    aid: Number(archive.aid ?? 0),
    bvid: archive.bvid ?? '',
    durationText: archive.duration_text ?? '',
    stat: { play: archive.stat?.play ?? '', danmaku: archive.stat?.danmaku ?? '' },
  }
}

function toAdditional(additional) {
  if (!additional) return null
  const out = { type: additional.type }
  if (additional.common) {
    out.common = {
      headText: additional.common.head_text ?? '',
      cover: additional.common.cover ?? null,
      title: additional.common.title ?? '',
      desc1: additional.common.desc1 ?? '',
      desc2: additional.common.desc2 ?? null,
    }
  }
  if (additional.reserve) {
    out.reserve = {
      stype: additional.reserve.stype,
      premiere: additional.reserve.premiere?.cover ? { cover: additional.reserve.premiere.cover } : null,
      title: additional.reserve.title ?? '',
      desc1: { text: additional.reserve.desc1?.text ?? '' },
      desc2: { text: additional.reserve.desc2?.text ?? '' },
      desc3: additional.reserve.desc3?.text ? { text: additional.reserve.desc3.text } : null,
    }
  }
  if (additional.vote) {
    out.vote = {
      desc: additional.vote.desc ?? '',
      endTimeText: additional.vote.end_time ? formatTime(additional.vote.end_time, 'yyyy-MM-dd HH:mm') : '',
    }
  }
  if (additional.ugc) {
    out.ugc = {
      headText: additional.ugc.head_text ?? '',
      cover: additional.ugc.cover ?? '',
      title: additional.ugc.title ?? '',
      duration: additional.ugc.duration ?? '',
      descSecond: additional.ugc.desc_second ?? '',
    }
  }
  if (additional.goods) {
    const items = (additional.goods.items ?? []).map((g) => ({
      cover: g.cover ?? null,
      name: g.name ?? '',
      price: g.price ?? '',
    }))
    out.goods = { headText: additional.goods.head_text, items }
  }
  if (additional.upower_lottery) {
    out.lottery = {
      title: additional.upower_lottery.title ?? '',
      desc: { text: additional.upower_lottery.desc?.text ?? '' },
    }
  }
  return out
}

/** 动态 -> canvaskit 模块结构（对应 ModuleDynamic.makeGeneral 的数据准备） */
export function toModules(item) {
  const moduleDynamic = item?.modules?.module_dynamic ?? {}
  const major = moduleDynamic.major

  let drawMajor = null
  if (major) {
    switch (major.type) {
      case 'MAJOR_TYPE_ARCHIVE':
        drawMajor = { type: 'MAJOR_TYPE_ARCHIVE', archive: toArchive(major.archive) }
        break
      case 'MAJOR_TYPE_BLOCKED':
        drawMajor = {
          type: 'MAJOR_TYPE_BLOCKED',
          blocked: {
            bgImg: { imgDay: major.blocked?.bg_img?.img_day ?? '' },
            icon: { imgDay: major.blocked?.icon?.img_day ?? '' },
          },
        }
        break
      case 'MAJOR_TYPE_DRAW':
        drawMajor = {
          type: 'MAJOR_TYPE_DRAW',
          draw: {
            items: (major.draw?.items ?? []).map((it) => ({ width: it.width, height: it.height, src: it.src })),
          },
        }
        break
      case 'MAJOR_TYPE_ARTICLE':
        drawMajor = {
          type: 'MAJOR_TYPE_ARTICLE',
          article: {
            title: major.article?.title ?? '',
            desc: major.article?.desc ?? null,
            covers: major.article?.covers ?? [],
            id: Number(major.article?.id ?? 0),
          },
        }
        break
      case 'MAJOR_TYPE_MUSIC':
        drawMajor = {
          type: 'MAJOR_TYPE_MUSIC',
          music: {
            title: major.music?.title ?? '',
            label: major.music?.label ?? '',
            cover: major.music?.cover ?? '',
            id: Number(major.music?.id ?? 0),
          },
        }
        break
      case 'MAJOR_TYPE_LIVE':
        drawMajor = {
          type: 'MAJOR_TYPE_LIVE',
          live: {
            title: major.live?.title ?? '',
            descFirst: major.live?.desc_first,
            descSecond: major.live?.desc_second,
            cover: major.live?.cover ?? '',
            badge: toBadge(major.live?.badge, '直播'),
            id: Number(major.live?.id ?? 0),
          },
        }
        break
      case 'MAJOR_TYPE_LIVE_RCMD': {
        const info = liveRcmdInfo(item)
        drawMajor = {
          type: 'MAJOR_TYPE_LIVE_RCMD',
          liveRcmd: {
            liveInfo: {
              livePlayInfo: {
                title: info?.title ?? '',
                parentAreaName: info?.parent_area_name ?? '',
                areaName: info?.area_name ?? '',
                cover: info?.cover ?? '',
                liveStatus: info?.live_status ?? 0,
                roomId: info?.room_id ?? 0,
              },
            },
          },
        }
        break
      }
      case 'MAJOR_TYPE_PGC':
        drawMajor = {
          type: 'MAJOR_TYPE_PGC',
          pgc: {
            title: major.pgc?.title ?? '',
            stat: { play: major.pgc?.stat?.play ?? '', danmaku: major.pgc?.stat?.danmaku ?? '' },
            cover: major.pgc?.cover ?? '',
            badge: toBadge(major.pgc?.badge, '番剧'),
            epid: Number(major.pgc?.epid ?? 0),
          },
        }
        break
      case 'MAJOR_TYPE_UGC_SEASON':
        drawMajor = { type: 'MAJOR_TYPE_UGC_SEASON', ugcSeason: toArchive(major.ugc_season) }
        break
      case 'MAJOR_TYPE_COMMON':
        drawMajor = {
          type: 'MAJOR_TYPE_COMMON',
          common: {
            cover: major.common?.cover ?? null,
            title: major.common?.title ?? '',
            desc: major.common?.desc ?? '',
            label: major.common?.label ?? '',
            badge: toBadge(major.common?.badge),
          },
        }
        break
      case 'MAJOR_TYPE_OPUS':
        drawMajor = {
          type: 'MAJOR_TYPE_OPUS',
          opus: {
            title: major.opus?.title ?? null,
            summary: toContentDesc(major.opus?.summary) ?? { text: '', richTextNodes: [] },
            pics: (major.opus?.pics ?? []).map((it) => ({ width: it.width, height: it.height, src: it.url ?? it.src })),
          },
        }
        break
      case 'MAJOR_TYPE_NONE':
        drawMajor = { type: 'MAJOR_TYPE_NONE', none: { tips: major.none?.tips ?? '' } }
        break
      default:
        drawMajor = null
    }
  }

  return {
    topic: moduleDynamic.topic?.name ? { name: moduleDynamic.topic.name } : null,
    desc: toContentDesc(moduleDynamic.desc),
    major: drawMajor,
    additional: toAdditional(moduleDynamic.additional),
    dispute: item?.modules?.module_dispute?.title ? { title: item.modules.module_dispute.title } : null,
  }
}

/** 专栏动态：opus -> article（对应 DynamicMessageTasker.buildMessage 的专栏转换） */
export function convertArticle(item) {
  const major = item?.modules?.module_dynamic?.major
  if (item?.type !== 'DYNAMIC_TYPE_ARTICLE' || !major?.opus) return false
  const opus = major.opus
  major.article = {
    id: item.basic?.rid_str ?? didOf(item),
    title: opus.title ?? '',
    desc: opus.summary?.text ?? '',
    label: '',
    jump_url: '',
    covers: (opus.pics ?? []).map((pic) => pic.src ?? pic.url),
  }
  major.type = 'MAJOR_TYPE_ARTICLE'
  major.opus = null
  return true
}

/** 是否为「专属动态」（对应 DynamicItem.isUnlocked） */
export function isUnlocked(item) {
  const majorType = item?.modules?.module_dynamic?.major?.type
  return majorType !== 'MAJOR_TYPE_BLOCKED' && item?.modules?.module_author?.icon_badge?.text === '专属动态'
}

/** 番剧 seasonId（PGC 订阅匹配用） */
export function pgcSeasonIdOf(item) {
  const major = item?.modules?.module_dynamic?.major
  if (item?.type !== 'DYNAMIC_TYPE_PGC' && item?.type !== 'DYNAMIC_TYPE_PGC_UNION') return null
  return major?.pgc?.season_id ?? null
}

/* ------------------------------------------------------------------ */
/* 模板字段提取（对应 DynamicItem.textContent / dynamicImages / links）    */
/* ------------------------------------------------------------------ */

export function textContent(item) {
  if (isUnlocked(item)) return '此动态为专属动态\n请自行查看详情内容'
  const major = item?.modules?.module_dynamic?.major
  switch (item?.type) {
    case 'DYNAMIC_TYPE_FORWARD':
      return `${item?.modules?.module_dynamic?.desc?.text ?? ''}\n\n 转发 ${item?.orig?.modules?.module_author?.name ?? ''} 的动态:\n${textContent(item.orig)}`
    case 'DYNAMIC_TYPE_WORD':
    case 'DYNAMIC_TYPE_DRAW':
      return (
        item?.modules?.module_dynamic?.desc?.text ??
        major?.blocked?.hint_message ??
        `${major?.opus?.title ?? ''}\n${major?.opus?.summary?.text ?? ''}`
      )
    case 'DYNAMIC_TYPE_ARTICLE':
      return major?.article?.title ?? major?.opus?.title ?? ''
    case 'DYNAMIC_TYPE_AV':
      return major?.archive?.title ?? ''
    case 'DYNAMIC_TYPE_MUSIC':
      return major?.music?.title ?? ''
    case 'DYNAMIC_TYPE_PGC':
    case 'DYNAMIC_TYPE_PGC_UNION':
      return major?.pgc?.title ?? ''
    case 'DYNAMIC_TYPE_UGC_SEASON':
      return major?.ugc_season?.title ?? ''
    case 'DYNAMIC_TYPE_COMMON_VERTICAL':
    case 'DYNAMIC_TYPE_COMMON_SQUARE':
      return major?.common?.title ?? ''
    case 'DYNAMIC_TYPE_LIVE':
      return major?.live?.title ?? ''
    case 'DYNAMIC_TYPE_LIVE_RCMD':
      return liveRcmdInfo(item)?.title ?? ''
    case 'DYNAMIC_TYPE_NONE':
      return major?.none?.tips ?? ''
    default:
      return `未知的动态类型: ${item?.type}`
  }
}

/** 动态中的图片 url 列表（供模板 {images}） */
export function imagesOf(item) {
  if (isUnlocked(item)) return []
  const major = item?.modules?.module_dynamic?.major
  switch (item?.type) {
    case 'DYNAMIC_TYPE_FORWARD':
      return item.orig ? imagesOf(item.orig) : []
    case 'DYNAMIC_TYPE_DRAW':
      switch (major?.type) {
        case 'MAJOR_TYPE_DRAW':
          return (major.draw?.items ?? []).map((it) => it.src)
        case 'MAJOR_TYPE_OPUS':
          return (major.opus?.pics ?? []).map((it) => it.src ?? it.url)
        default:
          return []
      }
    case 'DYNAMIC_TYPE_ARTICLE':
      return major?.article?.covers ?? (major?.opus?.pics ?? []).map((it) => it.src ?? it.url)
    case 'DYNAMIC_TYPE_AV':
      return major?.archive?.cover ? [major.archive.cover] : []
    case 'DYNAMIC_TYPE_MUSIC':
      return major?.music?.cover ? [major.music.cover] : []
    case 'DYNAMIC_TYPE_PGC':
    case 'DYNAMIC_TYPE_PGC_UNION':
      return major?.pgc?.cover ? [major.pgc.cover] : []
    case 'DYNAMIC_TYPE_UGC_SEASON':
      return major?.ugc_season?.cover ? [major.ugc_season.cover] : []
    case 'DYNAMIC_TYPE_COMMON_SQUARE':
      return major?.common?.cover ? [major.common.cover] : []
    case 'DYNAMIC_TYPE_LIVE':
      return major?.live?.cover ? [major.live.cover] : []
    case 'DYNAMIC_TYPE_LIVE_RCMD': {
      const cover = liveRcmdInfo(item)?.cover
      return cover ? [cover] : []
    }
    default:
      return []
  }
}

/** 链接列表 [{ tag, value }]（对应 dynamicLinks） */
export function linksOf(item) {
  const major = item?.modules?.module_dynamic?.major
  const dynamicLink = { tag: '动态', value: `https://t.bilibili.com/${didOf(item)}` }
  switch (item?.type) {
    case 'DYNAMIC_TYPE_FORWARD':
      return [dynamicLink, { tag: '原动态', value: `https://t.bilibili.com/${didOf(item.orig)}` }]
    case 'DYNAMIC_TYPE_ARTICLE':
      return [
        {
          tag: '专栏',
          value:
            major?.type === 'MAJOR_TYPE_OPUS'
              ? `https://www.bilibili.com/opus/${didOf(item)}`
              : `https://www.bilibili.com/read/cv${major?.article?.id ?? didOf(item)}`,
        },
        dynamicLink,
      ]
    case 'DYNAMIC_TYPE_AV':
      return [{ tag: '视频', value: `https://www.bilibili.com/video/${major?.archive?.bvid ?? `av${major?.archive?.aid ?? ''}`}` }, dynamicLink]
    case 'DYNAMIC_TYPE_MUSIC':
      return [{ tag: '音乐', value: `https://www.bilibili.com/audio/au${major?.music?.id ?? ''}` }, dynamicLink]
    case 'DYNAMIC_TYPE_PGC':
    case 'DYNAMIC_TYPE_PGC_UNION':
      return [{ tag: '番剧', value: `https://www.bilibili.com/bangumi/play/ep${major?.pgc?.epid ?? ''}` }, dynamicLink]
    case 'DYNAMIC_TYPE_LIVE':
      return [{ tag: '直播', value: `https://live.bilibili.com/${major?.live?.id ?? ''}` }, dynamicLink]
    case 'DYNAMIC_TYPE_LIVE_RCMD':
      return [{ tag: '直播', value: `https://live.bilibili.com/${liveRcmdRoomId(item) ?? ''}` }, dynamicLink]
    default:
      return [dynamicLink]
  }
}

/** 视频详情 -> 绘制结构（链接解析用） */
export function videoToArchive(v) {
  return {
    title: v.title,
    desc: v.desc ?? null,
    cover: v.pic,
    badge: { text: '视频', bgColor: '#fb7299', color: '#ffffff' },
    aid: Number(v.aid ?? 0),
    bvid: v.bvid ?? '',
    durationText: formatDuration(v.duration ?? 0, false),
    stat: { play: v.stat?.view ?? '', danmaku: v.stat?.danmaku ?? '' },
  }
}

/** 专栏详情 -> 绘制结构 */
export function articleToMajor(a) {
  return {
    type: 'MAJOR_TYPE_ARTICLE',
    article: {
      title: a.title,
      desc: `${a.summary ?? ''}（${a.words ?? 0} 字）`,
      covers: a.image_urls ?? [],
      id: Number(a.aid ?? a.id ?? 0),
    },
  }
}

/** 直播间详情 -> 绘制结构（链接解析用） */
export function liveToMajor(room) {
  return {
    type: 'MAJOR_TYPE_LIVE',
    live: {
      title: room.title,
      descFirst: String(room.parent_area_name ?? ''),
      descSecond: String(room.area_name ?? ''),
      cover: room.user_cover || room.keyframe || '',
      badge: { text: room.live_status === 1 ? '直播中' : room.live_status === 2 ? '轮播中' : '未开播' },
      id: room.room_id,
    },
  }
}

/** 番剧信息 -> 绘制结构（链接解析用），兼容 PgcSeason / PgcMedia */
export function pgcToMajor(info) {
  if (info?.season_id != null && info?.title != null) {
    return {
      type: 'MAJOR_TYPE_PGC',
      pgc: {
        title: info.title,
        stat: { play: info.stat?.views ?? '', danmaku: info.stat?.danmakus ?? '' },
        cover: info.cover ?? info.square_cover ?? '',
        badge: { text: pgcTypeText(info.type) },
        epid: 0,
      },
      author: { mid: 0, name: info.title, face: info.cover ?? info.square_cover ?? '' },
    }
  }
  const media = info?.media
  if (media) {
    return {
      type: 'MAJOR_TYPE_PGC',
      pgc: {
        title: media.title,
        stat: { play: '', danmaku: '' },
        cover: media.horizontal_picture || media.cover || '',
        badge: { text: media.type_name ?? '番剧' },
        epid: 0,
      },
      author: { mid: 0, name: media.title, face: media.horizontal_picture || media.cover || '' },
    }
  }
  return null
}

export function pgcTypeText(type) {
  return { 1: '番剧', 2: '电影', 3: '纪录片', 4: '国创', 5: '电视剧', 7: '综艺' }[type] ?? '未知'
}
