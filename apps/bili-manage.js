/**
 * B 站配置指令（颜色 / 模板 / At全体 / 过滤器）
 */
import plugin from '../../../lib/plugins/plugin.js'
import * as Data from '../model/Data.js'
import { canManage, resolveTarget, matchUid, replyError, splitArgs } from '../model/helpers.js'

/** 解析可选 uid 参数（默认 0 = 该目标订阅的所有用户） */
function parseUidArg(arg) {
  if (!arg) return 0
  const matched = matchUid(arg)
  if (matched === null) return null
  if (matched.ambiguous) return undefined
  return matched.uid
}

export class BiliManage extends plugin {
  constructor() {
    super({
      name: 'B站推送配置',
      dsc: 'B站推送颜色/模板/At全体/过滤器配置',
      event: 'message',
      priority: 500,
      rule: [
        { reg: '^#bili(颜色|主题色)\\s*(.*)$', fnc: 'color' },
        { reg: '^#bili(模板|推送模板)\\s*(.*)$', fnc: 'template' },
        { reg: '^#bili(模板列表|模板效果)\\s*(.*)$', fnc: 'templateList' },
        { reg: '^#bili(at全体|atall|aa)\\s*(.*)$', fnc: 'atAll' },
        { reg: '^#bili(取消at全体|delAtall|daa)\\s*(.*)$', fnc: 'delAtAll' },
        { reg: '^#bili(at全体列表|atall列表|laa)\\s*(.*)$', fnc: 'listAtAll' },
        { reg: '^#bili(类型过滤|ft)\\s*(.*)$', fnc: 'filterType' },
        { reg: '^#bili(正则过滤|fr)\\s*([\\s\\S]+)$', fnc: 'filterReg' },
        { reg: '^#bili(过滤模式|fm)\\s*(.*)$', fnc: 'filterMode' },
        { reg: '^#bili(过滤列表|fl)\\s*(.*)$', fnc: 'filterList' },
        { reg: '^#bili(过滤删除|fd)\\s*(.*)$', fnc: 'filterDel' },
      ],
    })
  }

  /** #bili颜色 <UID/用户名> <#hex> */
  async color(e) {
    const args = splitArgs(e.msg.replace(/^#bili(颜色|主题色)\s*/, ''))
    if (args.length < 2) return e.reply('用法：#bili颜色 <UID/用户名> <#颜色>（多色用分号分隔，如 #fde8ed;#d3edfa）')
    const uid = parseUidArg(args[0])
    if (uid === null) return e.reply('未匹配到用户哦')
    if (uid === undefined) return e.reply('匹配到多个用户，请使用 UID 重试')
    e.reply(Data.setSubColor(uid, args[1]))
    return true
  }

  /** #bili模板 <d/l/c> <模板名> */
  async template(e) {
    const args = splitArgs(e.msg.replace(/^#bili(模板|推送模板)\s*/, ''))
    if (args.length < 2 || !/^[dlc]$/.test(args[0])) {
      return e.reply('用法：#bili模板 <d/l/c> <模板名>\nd=动态推送 l=直播推送 c=直播结束')
    }
    const kind = args[0]
    e.reply(Data.setTemplate(kind, args[1], Data.contactOf(e)))
    return true
  }

  /** #bili模板列表 [d/l/c] */
  templateList(e) {
    const kind = (e.msg.replace(/^#bili(模板列表|模板效果)\s*/, '').trim() || 'd').toLowerCase()
    if (!/^[dlc]$/.test(kind)) return e.reply('模板类型请使用 d(动态) / l(直播) / c(直播结束)')
    const names =
      kind === 'd'
        ? '{draw}=动态图 {name}=名称 {uid}=UID {did}=动态ID {type}=类型 {time}=时间\n{content}=内容 {images}=图片 {link}=链接 {links}=全部链接\n\\r=分割多条消息 {>>}...{<<}=包装成转发消息'
        : kind === 'l'
          ? '{draw}=直播图 {name}=名称 {uid}=UID {rid}=房间号 {title}=标题 {area}=分区 {time}=开播时间 {cover}=封面 {link}=链接'
          : '{name}=名称 {uid}=UID {rid}=房间号 {title}=标题 {area}=分区 {startTime}=开播时间 {endTime}=结束时间 {duration}=时长 {link}=链接'
    return e.reply(`【${kind === 'd' ? '动态' : kind === 'l' ? '直播' : '直播结束'}模板变量】\n${names}\n\n内置模板: DrawOnly / TextOnly / OneMsg / TwoMsg${kind === 'd' ? ' / ForwardMsg' : ''}\n模板效果请自行在配置文件中查看，使用 #bili模板 <d/l/c> <模板名> 设置`)
  }

  /** #biliat全体 <类型> [UID] [群号] */
  async atAll(e) {
    const args = splitArgs(e.msg.replace(/^#bili(at全体|atall|aa)\s*/, ''))
    if (args.length < 1) return e.reply('用法：#biliat全体 <类型> [UID]（类型: 全部/全部动态/视频/音乐/专栏/直播）')
    const typeKey = Data.AT_ALL_TYPES[args[0]]
    if (!typeKey) return e.reply(`没有这个类型 ${args[0]}`)
    const uid = parseUidArg(args[1] ?? '')
    if (uid === null) return e.reply('未匹配到用户哦')
    if (uid === undefined) return e.reply('匹配到多个用户，请使用 UID 重试')
    const contact = resolveTarget(e, args[2])
    if (contact === null) return e.reply('只有主人可以为其他目标设置')
    e.reply(Data.addAtAll(typeKey, uid, contact))
    return true
  }

  /** #bili取消at全体 <类型> [UID] [群号] */
  async delAtAll(e) {
    const args = splitArgs(e.msg.replace(/^#bili(取消at全体|delAtall|daa)\s*/, ''))
    if (args.length < 1) return e.reply('用法：#bili取消at全体 <类型> [UID]')
    const typeKey = Data.AT_ALL_TYPES[args[0]]
    if (!typeKey) return e.reply(`没有这个类型 ${args[0]}`)
    const uid = parseUidArg(args[1] ?? '')
    if (uid === null) return e.reply('未匹配到用户哦')
    if (uid === undefined) return e.reply('匹配到多个用户，请使用 UID 重试')
    const contact = resolveTarget(e, args[2])
    if (contact === null) return e.reply('只有主人可以为其他目标设置')
    e.reply(Data.delAtAll(typeKey, uid, contact))
    return true
  }

  /** #biliat全体列表 [UID] [群号] */
  async listAtAll(e) {
    const args = splitArgs(e.msg.replace(/^#bili(at全体列表|atall列表|laa)\s*/, ''))
    const uid = parseUidArg(args[0] ?? '')
    if (uid === null) return e.reply('未匹配到用户哦')
    if (uid === undefined) return e.reply('匹配到多个用户，请使用 UID 重试')
    const contact = resolveTarget(e, args[1])
    if (contact === null) return e.reply('只有主人可以查看其他目标')
    e.reply(Data.listAtAll(uid, contact))
    return true
  }

  /** #bili类型过滤 <类型> [UID] [群号] */
  async filterType(e) {
    if (!canManage(e)) return e.reply('仅群管理员或主人可以设置过滤器')
    const args = splitArgs(e.msg.replace(/^#bili(类型过滤|ft)\s*/, ''))
    if (args.length < 1) return e.reply('用法：#bili类型过滤 <类型> [UID]（类型: 动态/转发动态/视频/音乐/专栏/直播）')
    const uid = parseUidArg(args[1] ?? '')
    if (uid === null) return e.reply('未匹配到用户哦')
    if (uid === undefined) return e.reply('匹配到多个用户，请使用 UID 重试')
    const contact = resolveTarget(e, args[2])
    if (contact === null) return e.reply('只有主人可以为其他目标设置')
    e.reply(Data.addTypeFilter(args[0], uid, contact))
    return true
  }

  /** #bili正则过滤 <正则> [UID] [群号] */
  async filterReg(e) {
    if (!canManage(e)) return e.reply('仅群管理员或主人可以设置过滤器')
    const args = splitArgs(e.msg.replace(/^#bili(正则过滤|fr)\s*/, ''))
    if (args.length < 1) return e.reply('用法：#bili正则过滤 <正则表达式> [UID]（含空格或特殊字符请用引号包裹）')
    const uid = parseUidArg(args[1] ?? '')
    if (uid === null) return e.reply('未匹配到用户哦')
    if (uid === undefined) return e.reply('匹配到多个用户，请使用 UID 重试')
    const contact = resolveTarget(e, args[2])
    if (contact === null) return e.reply('只有主人可以为其他目标设置')
    e.reply(Data.addRegularFilter(args[0], uid, contact))
    return true
  }

  /** #bili过滤模式 <t/r> <w/b> [UID] [群号] */
  async filterMode(e) {
    if (!canManage(e)) return e.reply('仅群管理员或主人可以设置过滤器')
    const args = splitArgs(e.msg.replace(/^#bili(过滤模式|fm)\s*/, ''))
    if (args.length < 2) return e.reply('用法：#bili过滤模式 <t/r> <w/b> [UID]\nt=类型过滤器 r=正则过滤器 w=白名单 b=黑名单')
    const mode = args[1] === 'w' || args[1] === '白' ? 'white' : args[1] === 'b' || args[1] === '黑' ? 'black' : null
    if (!mode) return e.reply('过滤器模式请使用 w(白名单) 或 b(黑名单)')
    const uid = parseUidArg(args[2] ?? '')
    if (uid === null) return e.reply('未匹配到用户哦')
    if (uid === undefined) return e.reply('匹配到多个用户，请使用 UID 重试')
    const contact = resolveTarget(e, args[3])
    if (contact === null) return e.reply('只有主人可以为其他目标设置')
    e.reply(Data.setFilterMode(args[0], mode, uid, contact))
    return true
  }

  /** #bili过滤列表 [UID] [群号] */
  async filterList(e) {
    const args = splitArgs(e.msg.replace(/^#bili(过滤列表|fl)\s*/, ''))
    const uid = parseUidArg(args[0] ?? '')
    if (uid === null) return e.reply('未匹配到用户哦')
    if (uid === undefined) return e.reply('匹配到多个用户，请使用 UID 重试')
    const contact = resolveTarget(e, args[1])
    if (contact === null) return e.reply('只有主人可以查看其他目标')
    e.reply(Data.listFilter(uid, contact))
    return true
  }

  /** #bili过滤删除 <索引> [UID] [群号] */
  async filterDel(e) {
    if (!canManage(e)) return e.reply('仅群管理员或主人可以设置过滤器')
    const args = splitArgs(e.msg.replace(/^#bili(过滤删除|fd)\s*/, ''))
    if (args.length < 1) return e.reply('用法：#bili过滤删除 <索引>（如 t0 / r1，见 #bili过滤列表）')
    const uid = parseUidArg(args[1] ?? '')
    if (uid === null) return e.reply('未匹配到用户哦')
    if (uid === undefined) return e.reply('匹配到多个用户，请使用 UID 重试')
    const contact = resolveTarget(e, args[2])
    if (contact === null) return e.reply('只有主人可以为其他目标设置')
    e.reply(Data.delFilter(args[0], uid, contact))
    return true
  }
}

export default BiliManage
