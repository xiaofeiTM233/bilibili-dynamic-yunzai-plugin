/**
 * B 站订阅指令
 */
import plugin from '../../../lib/plugins/plugin.js'
import { getData, saveData } from '../model/Config.js'
import * as Data from '../model/Data.js'
import * as Api from '../model/Api.js'
import * as Push from '../model/Push.js'
import { canManage, resolveTarget, matchUid, subscribeUser, replyError, splitArgs } from './helpers.js'

const HELP_TEXT = `【B站动态订阅】
#bili订阅 <UID/用户名> [群号]    添加订阅
#bili取订 <UID/用户名> [群号]    取消订阅
#bili删除全部订阅 [群号]         清空目标的订阅
#bili订阅列表 [群号]             查看目标订阅列表
#bili追番 <ss/md/ep+ID> [群号]   订阅番剧（如 ss12345）
#bili弃番 <ss/md+ID> [群号]      取消追番
─── 查询 ───
#bili动态 <UID/用户名> [数量]    查看最新动态
#bili视频 <UID/用户名>           查看最新视频
#bili动态详情 <动态ID>           查看指定动态
#bili查找用户 <关键词>           搜索B站用户
─── 配置 ───
#bili颜色 <UID> <#hex颜色>       设置该UP推送卡片主题色
#bili模板 <d/l/c> <模板名>       设置推送模板
#biliat全体 <类型> [UID]         设置@全体（群管理）
#bili取消at全体 <类型> [UID]     取消@全体
#biliat全体列表 [UID]            查看@全体设置
─── 过滤器 ───
#bili类型过滤 <类型> [UID]       类型黑/白名单
#bili正则过滤 <正则> [UID]       内容正则过滤
#bili过滤模式 <t/r> <w/b> [UID]  切换过滤模式
#bili过滤列表 [UID]              查看过滤器
#bili过滤删除 <索引> [UID]       删除过滤器
─── 管理（仅主人）───
#bili登录                        扫码登录B站账号
#bili全部订阅                    查看全部订阅
#bili用户列表 [UID]              查看订阅目标
#bili状态                        插件运行状态
─── 说明 ───
过滤器类型: 动态/转发动态/视频/音乐/专栏/直播
at全体类型: 全部/全部动态/视频/音乐/专栏/直播`

export class BiliSubscribe extends plugin {
  constructor() {
    super({
      name: 'B站动态订阅',
      dsc: 'B站动态/直播订阅与推送',
      event: 'message',
      priority: 500,
      rule: [
        { reg: '^#bili(帮助|help|菜单)$', fnc: 'help' },
        { reg: '^#bili(订阅|添加|add)\\s*(.*)$', fnc: 'subscribe' },
        { reg: '^#bili(取订|删除订阅|取消订阅|del)\\s*(.*)$', fnc: 'unsubscribe' },
        { reg: '^#bili删除全部订阅\\s*(\\d*)$', fnc: 'removeAll' },
        { reg: '^#bili(订阅列表|列表|list)\\s*(\\d*)$', fnc: 'list' },
        { reg: '^#bili(全部订阅列表|全部订阅|订阅总数)$', fnc: 'listAll', permission: 'master' },
        { reg: '^#bili(用户列表|谁订阅了)\\s*(.*)$', fnc: 'listUser', permission: 'master' },
        { reg: '^#bili(追番|订阅番剧)\\s*(ss|md|ep)?(\\d+)\\s*(\\d*)$', fnc: 'bangumiSubscribe' },
        { reg: '^#bili(弃番|取消追番)\\s*(ss|md|ep)?(\\d+)\\s*(\\d*)$', fnc: 'bangumiUnsubscribe' },
      ],
    })
  }

  help(e) {
    e.reply(HELP_TEXT)
    return true
  }

  async subscribe(e) {
    const args = splitArgs(e.msg.replace(/^#bili(订阅|添加|add)\s*/, ''))
    if (!args[0]) return e.reply('用法：#bili订阅 <UID/用户名> [群号]')
    const contact = resolveTarget(e, args[1])
    if (contact === null) return e.reply('只有主人可以为其他目标设置订阅')

    const matched = matchUid(args[0])
    if (matched === null) return e.reply('未匹配到用户哦，可先使用 #bili查找用户 <关键词> 搜索')
    if (matched.ambiguous) {
      const lines = matched.ambiguous.slice(0, 10).map((m) => `${m.name}(${m.uid}) 匹配度:${(m.rate * 100).toFixed(0)}%`)
      return e.reply(`有多个匹配项：\n${lines.join('\n')}\n请使用 UID 重试`)
    }

    try {
      const err = await subscribeUser(matched.uid, contact)
      if (err) return e.reply(err)
      const name = getData().dynamic[String(matched.uid)]?.name ?? matched.name
      e.reply(
        contact === Data.contactOf(e)
          ? `订阅 ${name} 成功!`
          : `为${Data.contactLabel(contact)}订阅 ${name} 成功!`,
      )
    } catch (err) {
      replyError(e, err)
    }
    return true
  }

  async unsubscribe(e) {
    const args = splitArgs(e.msg.replace(/^#bili(取订|删除订阅|取消订阅|del)\s*/, ''))
    if (!args[0]) return e.reply('用法：#bili取订 <UID/用户名> [群号]')
    const contact = resolveTarget(e, args[1])
    if (contact === null) return e.reply('只有主人可以为其他目标设置订阅')

    const matched = matchUid(args[0])
    if (matched === null) return e.reply('未匹配到用户哦')
    if (matched.ambiguous) {
      const lines = matched.ambiguous.slice(0, 10).map((m) => `${m.name}(${m.uid})`)
      return e.reply(`有多个匹配项：\n${lines.join('\n')}\n请使用 UID 重试`)
    }
    if (!Data.isFollow(matched.uid, contact)) return e.reply('还未订阅此人哦')

    const name = getData().dynamic[String(matched.uid)]?.name
    Data.removeSubscribe(matched.uid, contact)
    e.reply(
      contact === Data.contactOf(e)
        ? `取消订阅 ${name} 成功`
        : `为${Data.contactLabel(contact)}取消订阅 ${name} 成功`,
    )
    return true
  }

  async removeAll(e) {
    const contact = resolveTarget(e, e.msg.replace(/^#bili删除全部订阅\s*/, ''))
    if (contact === null) return e.reply('只有主人可以操作其他目标')
    Data.removeAllSubscribe(contact)
    e.reply(`已删除${Data.contactLabel(contact)}的全部订阅数据`)
    return true
  }

  list(e) {
    const contact = resolveTarget(e, e.msg.replace(/^#bili(订阅列表|列表|list)\s*/, ''))
    if (contact === null) return e.reply('只有主人可以查看其他目标')
    e.reply(Data.listSubscribe(contact))
    return true
  }

  listAll(e) {
    e.reply(Data.listAllSubscribe())
    return true
  }

  listUser(e) {
    const arg = e.msg.replace(/^#bili(用户列表|谁订阅了)\s*/, '').trim()
    let target = null
    if (arg) {
      const matched = matchUid(arg)
      if (matched?.ambiguous) return e.reply('匹配到多个用户，请使用 UID')
      target = matched?.uid ?? null
    }
    e.reply(Data.listUser(target))
    return true
  }

  async bangumiSubscribe(e) {
    const m = /^#bili(追番|订阅番剧)\s*(ss|md|ep)?(\d+)\s*(\d*)$/.exec(e.msg)
    const id = `${m[2] ?? 'ss'}${m[3]}`
    const contact = resolveTarget(e, m[4])
    if (contact === null) return e.reply('只有主人可以为其他目标设置订阅')
    try {
      e.reply(await subscribeBangumi(id, contact))
    } catch (err) {
      replyError(e, err)
    }
    return true
  }

  async bangumiUnsubscribe(e) {
    const m = /^#bili(弃番|取消追番)\s*(ss|md|ep)?(\d+)\s*(\d*)$/.exec(e.msg)
    const id = `${m[2] ?? 'ss'}${m[3]}`
    const contact = resolveTarget(e, m[4])
    if (contact === null) return e.reply('只有主人可以为其他目标设置订阅')
    e.reply(unsubscribeBangumi(id, contact))
    return true
  }
}

/** 追番（对应 PgcService.followPgc） */
const PGC_TYPE = { 1: '番剧', 2: '电影', 3: '纪录片', 4: '国创', 5: '电视剧', 7: '综艺' }

export async function subscribeBangumi(id, contact) {
  const m = /^(ss|md|ep)(\d{4,12})$/.exec(id)
  if (!m) return 'ID 格式错误，例：ss11111 / md22222 / ep33333'
  const [, type, num] = m
  const data = getData()

  let ssid, title, mediaId, typeName
  try {
    if (type === 'ss') {
      const season = await Api.getSeasonInfo(num)
      ssid = season.season_id
      title = season.title
      mediaId = season.media_id
      typeName = PGC_TYPE[season.type] ?? '未知'
      try {
        await Api.followPgc(ssid)
      } catch (err) {
        if (!/已经关注过|已关注/.test(err.message)) logger.warn(`[bilibili-dynamic] 追番失败: ${err.message}`)
      }
    } else if (type === 'md') {
      const media = await Api.getMediaInfo(num)
      if (!media?.media) return '获取番剧信息失败，港澳台番剧请用 media id (md11111) 订阅'
      ssid = media.media.season_id
      title = media.media.title
      mediaId = media.media.media_id
      typeName = media.media.type_name ?? '未知'
      try {
        await Api.followPgc(ssid)
      } catch (err) {
        if (!/已经关注过|已关注/.test(err.message)) logger.warn(`[bilibili-dynamic] 追番失败: ${err.message}`)
      }
    } else {
      const season = await Api.getEpisodeInfo(num)
      if (!season) return '获取番剧信息失败，港澳台番剧请用 media id (md11111) 订阅'
      ssid = season.season_id
      title = season.title
      mediaId = season.media_id
      typeName = PGC_TYPE[season.type] ?? '未知'
      try {
        await Api.followPgc(ssid)
      } catch (err) {
        if (!/已经关注过|已关注/.test(err.message)) logger.warn(`[bilibili-dynamic] 追番失败: ${err.message}`)
      }
    }
  } catch (err) {
    return `获取番剧信息失败: ${err.message}`
  }

  const bangumi = data.bangumi[String(ssid)] ?? { title, mediaId, type: typeName, color: null, contacts: [] }
  if (!bangumi.contacts.includes(contact)) bangumi.contacts.push(contact)
  data.bangumi[String(ssid)] = bangumi
  saveData()
  return `追番成功( •̀ ω •́ )✧ [${title}]`
}

/** 弃番（对应 PgcService.delPgc） */
export function unsubscribeBangumi(id, contact) {
  const m = /^(ss|md)(\d{4,12})$/.exec(id)
  if (!m) return 'ID 格式错误，例：ss11111 / md22222（ep 无法用于删除）'
  const data = getData()
  const key = m[1] === 'ss' ? m[2] : Object.keys(data.bangumi).find((k) => data.bangumi[k].mediaId === Number(m[2]))
  const bangumi = key != null ? data.bangumi[String(key)] : null
  if (!bangumi) return '没有订阅这个番剧哦'
  bangumi.contacts = bangumi.contacts.filter((c) => c !== contact)
  if (bangumi.contacts.length === 0) delete data.bangumi[String(key)]
  saveData()
  return '删除成功'
}

export default BiliSubscribe
