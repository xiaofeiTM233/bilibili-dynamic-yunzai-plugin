/**
 * B 站管理指令 —— 对应 DynamicCommand.kt 中的 live/reload/clear/config/分组管理
 */
import plugin from '../../../lib/plugins/plugin.js'
import { getData, saveData, reloadConfig, getConfig } from '../model/Config.js'
import * as Data from '../model/Data.js'
import * as Api from '../model/Api.js'
import * as Dynamic from '../model/Dynamic.js'
import { renderSearchCard, resetRuntime } from '../model/Render.js'
import { matchUid, resolveTarget, replyError } from '../model/helpers.js'
import { formatTime } from '../model/Utils.js'

const logger = global.logger ?? console

/** 校验推送目标是否仍然有效（对应 /bili clear） */
function findInvalidContacts() {
  const invalid = new Set()
  const data = getData()
  const check = (contact) => {
    if (invalid.has(contact) || Data.expandGroupContact(contact)) return
    const { type, id } = Data.parseContact(contact)
    const bot = global.Bot
    if (type === 'group') {
      const gl = bot?.gl
      if (!gl) return
      if (!gl.has(Number(id)) && !gl.has(String(id))) invalid.add(contact)
    } else {
      const fl = bot?.fl
      if (!fl) return
      if (!fl.has(Number(id)) && !fl.has(String(id))) invalid.add(contact)
    }
  }
  for (const sub of Object.values(data.dynamic)) {
    for (const c of sub.contacts) check(c)
  }
  for (const bangumi of Object.values(data.bangumi)) {
    for (const c of bangumi.contacts) check(c)
  }
  return invalid
}

export class BiliAdmin extends plugin {
  constructor() {
    super({
      name: 'B站管理指令',
      dsc: 'B站直播/重载/清理/分组/交互配置',
      event: 'message',
      priority: 500,
      rule: [
        { reg: '^#bili\\s*(live|直播)$', fnc: 'live' },
        { reg: '^#bili\\s*(reload|重载)$', fnc: 'reload', permission: 'master' },
        { reg: '^#bili\\s*(clear|清理失效订阅)$', fnc: 'clear', permission: 'master' },
        { reg: '^#bili\\s*(创建分组|create)\\s+(\\S+)$', fnc: 'createGroup' },
        { reg: '^#bili\\s*(分组列表|listGroup|lg)(?:\\s+(\\S+))?$', fnc: 'listGroup' },
        { reg: '^#bili\\s*(删除分组|delGroup|dg)\\s+(\\S+)$', fnc: 'delGroup' },
        { reg: '^#bili\\s*(添加分组管理员|addGroupAdmin|aga)\\s+(\\S+)\\s+([\\s\\S]+)$', fnc: 'addGroupAdmin' },
        { reg: '^#bili\\s*(删除分组管理员|banGroupAdmin|bga)\\s+(\\S+)\\s+([\\s\\S]+)$', fnc: 'banGroupAdmin' },
        { reg: '^#bili\\s*(添加分组|push)\\s+(\\S+)\\s+([\\s\\S]+)$', fnc: 'pushGroup' },
        { reg: '^#bili\\s*ban\\s+(\\S+)\\s+([\\s\\S]+)$', fnc: 'banGroupContact' },
        { reg: '^#bili\\s*(配置|config)(?:\\s+(\\S+))?(?:\\s+(\\d+))?$', fnc: 'configCmd' },
        { reg: '^#bili配置帮助$', fnc: 'configHelp' },
      ],
    })
  }

  /** /bili live：随机推荐直播间卡片 */
  async live(e) {
    try {
      e.reply('加载中...', true)
      const list = await Api.getLiveList(1, 1)
      const room = list?.rooms?.[0]
      if (!room) return e.reply('当前没有人在直播')
      const user = await Api.userInfo(room.uid).catch(() => null)
      const { buffer } = await renderSearchCard({
        id: room.room_id,
        tag: '直播',
        time: formatTime(Math.floor(Date.now() / 1000)),
        author: Dynamic.plainAuthor({
          mid: user?.mid ?? room.uid,
          name: user?.name ?? room.uname ?? '',
          face: user?.face ?? room.face ?? null,
          verifyType: user?.official?.type ?? null,
        }),
        live: {
          uid: room.uid,
          uname: user?.name ?? room.uname ?? '',
          roomId: room.room_id,
          title: room.title,
          face: user?.face ?? room.face ?? null,
          cover: room.cover_from_user || room.keyframe || room.cover || '',
          area: `${room.parent_area_name ?? ''}·${room.area_name ?? ''}`,
        },
        link: `https://live.bilibili.com/${room.room_id}`,
      })
      e.reply([global.segment.image(buffer)])
    } catch (err) {
      replyError(e, err)
    }
    return true
  }

  /** /bili reload：重载配置 */
  async reload(e) {
    reloadConfig()
    // 图片质量/主题等配置可能已变化，重建渲染运行时
    await resetRuntime()
    e.reply('配置重载成功')
    return true
  }

  /** /bili clear：清理失效群/好友的订阅（需确认） */
  async clear(e) {
    const invalid = findInvalidContacts()
    if (invalid.size === 0) {
      e.reply('未找到失效的群/好友')
      return true
    }
    const contacts = [...invalid]
    const lines = contacts.map((c) => {
      const { type, id } = Data.parseContact(c)
      return type === 'group' ? `${id}（群）` : `${id}（好友）`
    })
    e.reply(`发现以下失效的群/好友：\n\n${lines.join('\n')}\n\n确认删除这些目标的订阅吗\n请回复 '确定' 或 '取消'`)
    this.biliClearContacts = contacts
    this.setContext('clearConfirm')
    return true
  }

  async clearConfirm(e) {
    this.finishContext('clearConfirm')
    const contacts = this.biliClearContacts ?? []
    this.biliClearContacts = null
    if (e.msg?.trim() !== '确定') {
      return e.reply('已取消')
    }
    for (const contact of contacts) {
      for (const uid of Object.keys(getData().dynamic)) {
        if (uid !== '0') Data.removeSubscribe(uid, contact)
      }
      for (const ssid of Object.keys(getData().bangumi)) {
        const bangumi = getData().bangumi[ssid]
        if (bangumi.contacts.includes(contact)) {
          bangumi.contacts = bangumi.contacts.filter((c) => c !== contact)
          if (bangumi.contacts.length === 0) delete getData().bangumi[ssid]
        }
      }
      const data = getData()
      delete data.filter[contact]
      delete data.atAll[contact]
      Data.removeTemplateContact(contact)
    }
    getData().group ??= {}
    const { saveData } = await import('../model/Config.js')
    saveData()
    e.reply('删除成功')
    return true
  }

  /* -------------------- 分组管理（GroupService） -------------------- */

  createGroup(e) {
    const name = /^#bili\s*(创建分组|create)\s+(\S+)$/.exec(e.msg)?.[2]
    e.reply(Data.createGroup(name, e.user_id))
    return true
  }

  listGroup(e) {
    const m = /^#bili\s*(分组列表|listGroup|lg)(?:\s+(\S+))?$/.exec(e.msg)
    const operator = e.isMaster ? 'master' : e.user_id
    e.reply(Data.listGroup(m?.[2] ?? null, operator))
    return true
  }

  delGroup(e) {
    const m = /^#bili\s*(删除分组|delGroup|dg)\s+(\S+)$/.exec(e.msg)
    const operator = e.isMaster ? 'master' : e.user_id
    e.reply(Data.delGroup(m[2], operator))
    return true
  }

  addGroupAdmin(e) {
    const m = /^#bili\s*(添加分组管理员|addGroupAdmin|aga)\s+(\S+)\s+([\s\S]+)$/.exec(e.msg)
    const operator = e.isMaster ? 'master' : e.user_id
    e.reply(Data.setGroupAdmin(m[2], m[3], operator))
    return true
  }

  banGroupAdmin(e) {
    const m = /^#bili\s*(删除分组管理员|banGroupAdmin|bga)\s+(\S+)\s+([\s\S]+)$/.exec(e.msg)
    const operator = e.isMaster ? 'master' : e.user_id
    e.reply(Data.banGroupAdmin(m[2], m[3], operator))
    return true
  }

  pushGroup(e) {
    const m = /^#bili\s*(添加分组|push)\s+(\S+)\s+([\s\S]+)$/.exec(e.msg)
    const operator = e.isMaster ? 'master' : e.user_id
    e.reply(Data.pushGroupContact(m[2], m[3], operator))
    return true
  }

  banGroupContact(e) {
    const m = /^#bili\s*ban\s+(\S+)\s+([\s\S]+)$/.exec(e.msg)
    const operator = e.isMaster ? 'master' : e.user_id
    e.reply(Data.delGroupContact(m[1], m[2], operator))
    return true
  }

  /* -------------------- 交互式配置（ConfigService.config） -------------------- */

  configHelp(e) {
    e.reply(
      '【B站交互配置】\n' +
      '#bili配置 [UID] [群号]\n' +
      '进入交互式配置菜单（At全体/主题色/推送模板/过滤器）\n' +
      'UID 省略表示全局配置，群号仅主人可用\n' +
      '交互中回复 退出 可随时退出',
    )
    return true
  }

  async configCmd(e) {
    const m = /^#bili\s*(配置|config)(?:\s+(\S+))?(?:\s+(\d+))?$/.exec(e.msg)
    let uid = 0
    if (m?.[2]) {
      const matched = matchUid(m[2])
      if (matched?.ambiguous) return e.reply('匹配到多个用户，请使用 UID')
      if (matched) uid = String(matched.uid)
    }
    const contact = resolveTarget(e, m?.[3])
    if (contact === null) return e.reply('只有主人可以配置其他目标')

    if (uid !== '0' && !Data.isFollow(uid, contact)) {
      return e.reply(`没有订阅这个人哦 [${uid}]`)
    }

    const cfg = getConfig()
    const user = uid !== '0' ? getData().dynamic[String(uid)] : null
    const isSelf = contact === Data.contactOf(e)
    const atAll = getData().atAll[contact]?.[uid]?.length > 0
    const filter = getData().filter[contact]?.[uid]
    const modeText = filter
      ? `类型: ${filter.typeSelect.mode === 'WHITE_LIST' ? '白名单' : '黑名单'} | 正则: ${filter.regularSelect.mode === 'WHITE_LIST' ? '白名单' : '黑名单'}`
      : '无过滤器'

    const lines = [
      '配置: ',
      `用户: ${uid === '0' ? '全局' : user?.name ?? uid}`,
      `目标: ${isSelf ? '当前环境' : Data.contactLabel(contact)}`,
      '',
      '当前可配置项:',
    ]
    const isGroup = contact.startsWith('-')
    if (isGroup) {
      lines.push('  1: At全体 [' + atAll + ']', '      1.1: 当前At全体项', '      1.2: 添加At全体', '      1.3: 删除At全体')
    }
    if (uid !== '0') {
      lines.push(`  2: 主题色 [${user?.color ?? cfg.defaultColor ?? '#d3edfa'}]`)
    }
    if (uid === '0') {
      lines.push(
        '  3: 推送模板',
        `      3.1: 动态推送模板 [${Data.templateOf('d', contact) ?? cfg.template?.dynamic ?? 'OneMsg'}]`,
        `      3.2: 直播推送模板 [${Data.templateOf('l', contact) ?? cfg.template?.live ?? 'OneMsg'}]`,
        `      3.3: 直播结束模板 [${Data.templateOf('c', contact) ?? cfg.template?.liveClose ?? 'SimpleMsg'}]`,
      )
    }
    lines.push(
      '  4: 过滤器',
      '      4.1: 过滤器列表',
      '      4.2: 添加类型过滤器',
      '      4.3: 添加正则过滤器',
      `      4.4: 切换过滤模式 [${modeText}]`,
      '      4.5: 删除过滤器',
      '',
      '[中括号]内为当前值\n请输入编号, 2分钟未回复自动退出\n或回复 退出 来主动退出',
    )

    this.biliConfigState = { uid: String(uid), contact }
    this.setContext('configStep')
    this.biliConfigTimer = setTimeout(() => {
      try {
        this.finishContext('configStep')
      } catch {}
      this.biliConfigState = null
    }, 120_000)
    e.reply(lines.join('\n'))
    return true
  }

  async configStep(e) {
    const state = this.biliConfigState
    if (!state) {
      this.finishContext('configStep')
      return true
    }
    const input = (e.msg ?? '').trim()

    if (input === '退出') {
      clearTimeout(this.biliConfigTimer)
      this.biliConfigState = null
      this.finishContext('configStep')
      e.reply('已退出')
      return true
    }

    // 步骤分发：state.step 为空表示等待主菜单编号
    const handled = await this.handleConfigInput(e, state, input)
    if (handled) {
      if (state.done) {
        clearTimeout(this.biliConfigTimer)
        this.biliConfigState = null
        this.finishContext('configStep')
        return true
      }
      if (state.step) {
        e.reply('请按要求回复内容，或回复 退出 退出')
      } else {
        e.reply('输入编号以继续\n不回复或回复 退出 来退出')
      }
    }
    return true
  }

  /** 处理一次配置输入；返回 true 表示输入被消费 */
  async handleConfigInput(e, state, input) {
    const { uid, contact } = state

    if (!state.step) {
      if (/^1(\.\d)?$/.test(input)) {
        const b = input.split('.')[1] ?? ''
        if (!b) return true // 重新输入编号
        if (b === '1') {
          e.reply(Data.listAtAll(uid, contact))
        } else if (b === '2') {
          e.reply('请选择要At全体的内容:\n  全部\n  ├─ 全部动态\n  │   ├─ 视频\n  │   ├─ 音乐\n  │   └─ 专栏\n  └─ 直播')
          state.step = { kind: 'atall-add' }
        } else if (b === '3') {
          const list = Data.listAtAll(uid, contact)
          if (list.includes('没有设置')) {
            e.reply('没有At全体哦')
          } else {
            e.reply(`At全体项:\n${list}\n请回复要删除的项`)
            state.step = { kind: 'atall-del' }
          }
        }
        return true
      }
      if (/^2$/.test(input) && uid !== '0') {
        e.reply('请输入16进制颜色，例如: #d3edfa')
        state.step = { kind: 'color' }
        return true
      }
      if (/^3(\.\d)?$/.test(input) && uid === '0') {
        const b = input.split('.')[1] ?? ''
        if (!b) return true
        const kindMap = { 1: 'd', 2: 'l', 3: 'c' }
        const kind = kindMap[b]
        if (!kind) {
          e.reply('没有这个选项哦')
          return true
        }
        const cfg = getConfig()
        const names = Object.keys(kind === 'd' ? cfg.dynamicTemplates ?? {} : kind === 'l' ? cfg.liveTemplates ?? {} : cfg.liveCloseTemplates ?? {})
        e.reply(`请选择一个推送模板, 回复模板名\n可选: ${names.join(' / ')}`)
        state.step = { kind: 'template', templateKind: kind }
        return true
      }
      if (/^4(\.\d)?$/.test(input)) {
        const b = input.split('.')[1] ?? ''
        if (!b) return true
        if (b === '1') {
          e.reply(Data.listFilter(uid, contact))
        } else if (b === '2') {
          e.reply(`当前过滤器类型: 黑名单\n支持的类型: \n    ${Object.keys(Data.FILTER_TYPES).join('\n    ')}\n请回复要过滤的类型`)
          state.step = { kind: 'filter-type' }
        } else if (b === '3') {
          e.reply('当前过滤器类型: 黑名单\n请回复过滤文本或正则')
          state.step = { kind: 'filter-reg' }
        } else if (b === '4') {
          const filter = getData().filter[contact]?.[uid]
          const typeMode = filter?.typeSelect.mode === 'WHITE_LIST' ? '白名单' : '黑名单'
          const regMode = filter?.regularSelect.mode === 'WHITE_LIST' ? '白名单' : '黑名单'
          e.reply(`类型过滤器: ${typeMode}\n正则过滤器: ${regMode}\n请选择要切换的过滤的类型\nt: 类型过滤器\nr: 正则过滤器`)
          state.step = { kind: 'filter-mode' }
        } else if (b === '5') {
          e.reply(`${Data.listFilter(uid, contact)}\n请回复要删除的索引`)
          state.step = { kind: 'filter-del' }
        }
        return true
      }
      return false // 未消费，提示重新输入
    }

    const step = state.step
    switch (step.kind) {
      case 'atall-add': {
        const key = Data.AT_ALL_TYPES[input]
        if (!key) return true
        e.reply(Data.addAtAll(key, uid, contact))
        state.step = null
        return true
      }
      case 'atall-del': {
        const key = Data.AT_ALL_TYPES[input]
        if (!key) return true
        e.reply(Data.delAtAll(key, uid, contact))
        state.step = null
        return true
      }
      case 'color': {
        if (!/^#[0-9a-fA-F]{6}$/.test(input)) {
          e.reply('格式错误，请输入16进制颜色，例如: #d3edfa')
          return true
        }
        e.reply(Data.setSubColor(uid, input))
        state.step = null
        return true
      }
      case 'template': {
        const templates = step.templateKind === 'd' ? getConfig().dynamicTemplates : step.templateKind === 'l' ? getConfig().liveTemplates : getConfig().liveCloseTemplates
        if (!templates || !Object.keys(templates).includes(input)) return true
        e.reply(Data.setTemplate(step.templateKind, input, contact))
        state.step = null
        return true
      }
      case 'filter-type': {
        if (!Data.FILTER_TYPES[input]) return true
        e.reply(Data.addTypeFilter(input, uid, contact))
        state.step = null
        return true
      }
      case 'filter-reg': {
        if (!input) return true
        e.reply(Data.addRegularFilter(input, uid, contact))
        state.step = null
        return true
      }
      case 'filter-mode': {
        if (input !== 't' && input !== 'r') return true
        const filter = getData().filter[contact]?.[uid]
        const current = input === 't' ? filter?.typeSelect.mode : filter?.regularSelect.mode
        const mode = current === 'WHITE_LIST' ? 'BLACK_LIST' : 'WHITE_LIST'
        e.reply(Data.setFilterMode(input, mode, uid, contact))
        state.step = null
        return true
      }
      case 'filter-del': {
        e.reply(Data.delFilter(input, uid, contact))
        state.step = null
        return true
      }
      default:
        state.step = null
        return true
    }
  }
}

export default BiliAdmin
