/**
 * B 站订阅指令
 */
import plugin from '../../../lib/plugins/plugin.js'
import { getData, saveData } from '../model/Config.js'
import * as Data from '../model/Data.js'
import * as Api from '../model/Api.js'
import * as Push from '../model/Push.js'
import { canManage, resolveTarget, matchUid, subscribeUser, replyError, splitArgs } from '../model/helpers.js'

const logger = global.logger ?? console

const HELP_TEXT = `【B站动态订阅】
#bili(订阅/add) <UID/用户名> [群号]      添加订阅
#bili(取订/del) <UID/用户名> [群号]      取消订阅
#bili(删除全部订阅/delAll) [群号]        清空目标的订阅
#bili(订阅列表/list) [群号]              查看目标订阅列表
#bili(全部订阅/listAll/la)               全部订阅列表（主人）
#bili(用户列表/listUser/lu) [UID]        查看订阅目标（主人）
#bili(追番/弃番) <ss/md/ep+ID> [群号]    订阅/取消番剧
─── 查询 ───
#bili(动态/new) <UID/用户名> [数量]      查看最新动态
#bili(视频/video) <UID/用户名>           查看最新视频
#bili(动态详情/search/s) <动态ID>        查看指定动态
#bili(直播/live)                         随机直播卡片
#bili查找用户 <关键词>                   搜索B站用户
─── 配置 ───
#bili(颜色/color) <UID> <#hex颜色>       设置该UP推送卡片主题色
#bili(模板/t) <d/l/c/le> <模板名>        设置推送模板
#bili(模板列表/tl) [类型]                查看模板变量
#bili配置 [UID] [群号]                   交互式配置
#bili(at全体/aa) <类型> [UID]            设置@全体（群管理）
#bili(取消at全体/daa) <类型> [UID]       取消@全体
#bili(at全体列表/laa) [UID]              查看@全体设置
─── 过滤器 ───
#bili(类型过滤/ft) <类型> [UID]          类型黑/白名单
#bili(正则过滤/fr) <正则> [UID]          内容正则过滤
#bili(过滤模式/fm) <t/r> <w/b> [UID]     切换过滤模式
#bili(过滤列表/fl) [UID]                 查看过滤器
#bili(过滤删除/fd) <索引> [UID]          删除过滤器
─── 分组 ───
#bili(创建分组/create) <分组名>          创建推送分组
#bili(分组列表/lg) [分组名]              分组列表/详情
#bili(删除分组/dg) <分组名>              删除分组
#bili(添加分组/push) <分组名> <目标>     添加推送目标
#bili ban <分组名> <目标>                移除推送目标
#bili(添加分组管理员/aga) <分组名> <QQ>  设置分组管理员
#bili(删除分组管理员/bga) <分组名> <QQ>  移除分组管理员
─── 管理（仅主人）───
#bili(登录/login)                        扫码登录B站账号
#bili(reload/重载)                       重载配置
#bili(clear/清理失效订阅)                清理失效群/好友订阅
#bili状态                                插件运行状态
─── 说明 ───
过滤器类型: 动态/转发动态/视频/音乐/专栏/直播
at全体类型: 全部/全部动态/视频/音乐/专栏/直播
mirai 风格英文子命令均可使用，如: #bili add 487550002
群聊发送B站链接/分享卡片可自动解析绘图（At机器人触发）`

export class BiliSubscribe extends plugin {
  constructor() {
    super({
      name: 'B站动态订阅',
      dsc: 'B站动态/直播订阅与推送',
      event: 'message',
      priority: 500,
      rule: [
        { reg: '^#bili\\s*(帮助|help|菜单|menu|h)$', fnc: 'help' },
        { reg: '^#bili\\s*(删除全部订阅|delAll)\\s*(\\d*)$', fnc: 'removeAll' },
        { reg: '^#bili\\s*(订阅|添加|add|follow)\\s*(.*)$', fnc: 'subscribe' },
        { reg: '^#bili\\s*(取订|删除订阅|取消订阅|del|unfollow)\\s*(.*)$', fnc: 'unsubscribe' },
        { reg: '^#bili\\s*(订阅列表|列表|list)\\s*(\\d*)$', fnc: 'list' },
        { reg: '^#bili\\s*(全部订阅列表|全部订阅|订阅总数|listAll|la)$', fnc: 'listAll', permission: 'master' },
        { reg: '^#bili\\s*(用户列表|谁订阅了|listUser|lu)\\s*(.*)$', fnc: 'listUser', permission: 'master' },
        { reg: '^#bili\\s*(追番|订阅番剧)\\s*(ss|md|ep)?(\\d+)\\s*(\\d*)$', fnc: 'bangumiSubscribe' },
        { reg: '^#bili\\s*(弃番|取消追番)\\s*(ss|md|ep)?(\\d+)\\s*(\\d*)$', fnc: 'bangumiUnsubscribe' },
      ],
    })
  }

  help(e) {
    e.reply(HELP_TEXT)
    return true
  }

  async subscribe(e) {
    const args = splitArgs(e.msg.replace(/^#bili(订阅|添加|add)\s*/, ''))
    if (!args[0]) return e.reply('用法：#bili订阅/add <UID/用户名> [群号]')
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
    const args = splitArgs(e.msg.replace(/^#bili\s*(取订|删除订阅|取消订阅|del|unfollow)\s*/, ''))
    if (!args[0]) return e.reply('用法：#bili取订/del <UID/用户名> [群号]')
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
    const contact = resolveTarget(e, e.msg.replace(/^#bili\s*(删除全部订阅|delAll)\s*/, ''))
    if (contact === null) return e.reply('只有主人可以操作其他目标')
    Data.removeAllSubscribe(contact)
    e.reply(`已删除${Data.contactLabel(contact)}的全部订阅数据`)
    return true
  }

  list(e) {
    const contact = resolveTarget(e, e.msg.replace(/^#bili\s*(订阅列表|列表|list)\s*/, ''))
    if (contact === null) return e.reply('只有主人可以查看其他目标')
    e.reply(Data.listSubscribe(contact))
    return true
  }

  listAll(e) {
    e.reply(Data.listAllSubscribe())
    return true
  }

  listUser(e) {
    const arg = e.msg.replace(/^#bili\s*(用户列表|谁订阅了|listUser|lu)\s*/, '').trim()
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
    const m = /^#bili\s*(追番|订阅番剧)\s*(ss|md|ep)?(\d+)\s*(\d*)$/.exec(e.msg)
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

/** 尝试关注番剧，忽略"已关注"类错误 */
async function followPgcSafe(ssid) {
  try {
    await Api.followPgc(ssid)
  } catch (err) {
    if (!/已经关注过|已关注/.test(err.message)) logger.warn(`[bilibili-dynamic] 追番失败: ${err.message}`)
  }
}

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
      await followPgcSafe(ssid)
    } else if (type === 'md') {
      const media = await Api.getMediaInfo(num)
      if (!media?.media) return '获取番剧信息失败，港澳台番剧请用 media id (md11111) 订阅'
      ssid = media.media.season_id
      title = media.media.title
      mediaId = media.media.media_id
      typeName = media.media.type_name ?? '未知'
      await followPgcSafe(ssid)
    } else {
      const season = await Api.getEpisodeInfo(num)
      if (!season) return '获取番剧信息失败，港澳台番剧请用 media id (md11111) 订阅'
      ssid = season.season_id
      title = season.title
      mediaId = season.media_id
      typeName = PGC_TYPE[season.type] ?? '未知'
      await followPgcSafe(ssid)
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
