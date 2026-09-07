/**
 * 订阅数据操作 —— 移植自 DynamicService.kt / BiliData.kt
 *
 * 联系人表示与 mirai 一致："-<群号>"（群聊）/ "<QQ号>"（好友），分组名为普通名称。
 */
import { getData, saveData } from './Config.js'
import { fuzzySearch } from './Utils.js'

export const logger = global.logger ?? console

/* ------------------------------------------------------------------ */
/* 联系人                                                               */
/* ------------------------------------------------------------------ */

/** e -> "-<群号>" / "<QQ号>"（对应 Contact.delegate） */
export function contactOf(e) {
  return e.isGroup ? `-${e.group_id}` : `${e.user_id}`
}

/** 解析联系人字符串（兼容旧 g/f 前缀写法） */
export function parseContact(contact) {
  const s = String(contact)
  if (s.startsWith('-')) return { type: 'group', id: s.slice(1) }
  if (s.startsWith('g')) return { type: 'group', id: s.slice(1) }
  if (s.startsWith('f')) return { type: 'friend', id: s.slice(1) }
  return { type: 'friend', id: s }
}

/** 推送目标文本（日志用） */
export function contactLabel(contact) {
  const { type, id } = parseContact(contact)
  return type === 'group' ? `群 ${id}` : `好友 ${id}`
}

/* ------------------------------------------------------------------ */
/* 订阅基本操作                                                          */
/* ------------------------------------------------------------------ */

export function isFollow(uid, contact) {
  const sub = getData().dynamic[String(uid)]
  return !!sub && sub.contacts.includes(contact)
}

/** 所有已订阅且联系人非空的 uid */
export function subscribedUids() {
  const dynamic = getData().dynamic
  return Object.keys(dynamic)
    .filter((k) => k !== '0' && dynamic[k].contacts.length > 0)
    .map(Number)
}

export function allContacts() {
  const set = new Set()
  const add = (contact) => {
    const expanded = expandGroupContact(contact)
    if (expanded) for (const c of expanded) set.add(c)
    else set.add(contact)
  }
  for (const sub of Object.values(getData().dynamic)) {
    for (const c of sub.contacts) add(c)
  }
  for (const bangumi of Object.values(getData().bangumi)) {
    for (const c of bangumi.contacts) add(c)
  }
  return [...set]
}

export function setSubName(uid, name) {
  const sub = getData().dynamic[String(uid)]
  if (sub && sub.name !== name) {
    sub.name = name
    saveData()
  }
}

export function addSubscribe(uid, name, contact) {
  const data = getData()
  uid = String(uid)
  const all = data.dynamic[0]
  if (all) all.contacts = all.contacts.filter((c) => c !== contact)
  if (!data.dynamic[uid]) {
    data.dynamic[uid] = { name, color: null, last: 0, lastLive: 0, contacts: [], banList: {} }
  }
  if (!isFollow(uid, contact)) data.dynamic[uid].contacts.push(contact)
  saveData()
}

export function removeSubscribe(uid, contact) {
  const data = getData()
  uid = String(uid)
  const sub = data.dynamic[uid]
  if (!sub || !sub.contacts.includes(contact)) return false
  sub.contacts = sub.contacts.filter((c) => c !== contact)
  if (sub.contacts.length === 0) delete data.dynamic[uid]
  cleanContactUid(contact, uid)
  saveData()
  return true
}

/** 从全部推送模板映射中移除某联系人（模板形状：模板名 -> 联系人列表） */
export function removeTemplateContact(contact) {
  const data = getData()
  for (const key of ['dynamicPushTemplate', 'livePushTemplate', 'liveCloseTemplate']) {
    for (const list of Object.values(data[key] ?? {})) {
      const i = list.indexOf(contact)
      if (i !== -1) list.splice(i, 1)
    }
  }
}

/** 删除某个目标的全部订阅（对应 removeAllSubscribe） */
export function removeAllSubscribe(contact) {
  const data = getData()
  for (const sub of Object.values(data.dynamic)) {
    sub.contacts = sub.contacts.filter((c) => c !== contact)
  }
  for (const [ssid, bangumi] of Object.entries(data.bangumi)) {
    bangumi.contacts = bangumi.contacts.filter((c) => c !== contact)
    if (bangumi.contacts.length === 0) delete data.bangumi[ssid]
  }
  delete data.filter[contact]
  delete data.atAll[contact]
  removeTemplateContact(contact)
  saveData()
}

function cleanContactUid(contact, uid) {
  const data = getData()
  const filter = data.filter[contact]
  if (filter) {
    delete filter[uid]
    delete filter[0]
    if (Object.keys(filter).length === 0) delete data.filter[contact]
  }
  const atAll = data.atAll[contact]
  if (atAll) {
    delete atAll[uid]
    delete atAll[0]
    if (Object.keys(atAll).length === 0) delete data.atAll[contact]
  }
}

/* ------------------------------------------------------------------ */
/* 分组（对应 GroupService.kt）                                          */
/* 分组名可作为订阅联系人：推送时展开为分组内所有 g/f 目标                  */
/* ------------------------------------------------------------------ */

function groupData() {
  const data = getData()
  if (!data.group) data.group = {}
  return data.group
}

/** 联系人参数解析："-123" / "g123" / "f123" / 纯数字（默认为群） */
function parseContactArg(arg) {
  const s = String(arg).trim()
  if (!s) return null
  if (/^-?\d+$/.test(s)) return s
  if (/^g\d+$/.test(s)) return `-${s.slice(1)}`
  if (/^f\d+$/.test(s)) return s.slice(1)
  return null
}

export function createGroup(name, creator) {
  const group = groupData()
  if (group[name]) return '分组名称重复'
  if (/^\d+$/.test(name)) return '分组名不能全为数字'
  group[name] = { name, creator, admin: [], contacts: [] }
  saveData()
  return '创建成功'
}

export function delGroup(name, operator) {
  const group = groupData()
  const g = group[name]
  if (!g) return `没有此分组 [${name}]`
  if (g.creator !== operator && operator !== 'master') return '无权删除'
  const data = getData()
  for (const sub of Object.values(data.dynamic)) {
    sub.contacts = sub.contacts.filter((c) => c !== name)
  }
  for (const bangumi of Object.values(data.bangumi)) {
    bangumi.contacts = bangumi.contacts.filter((c) => c !== name)
  }
  delete data.filter[name]
  delete data.atAll[name]
  removeTemplateContact(name)
  delete group[name]
  saveData()
  return '删除成功'
}

export function listGroup(name, operator) {
  const group = groupData()
  if (name) {
    const g = group[name]
    if (!g) return '没有此分组哦'
    return [
      `分组: ${g.name}`,
      `创建者: ${g.creator}`,
      `管理员: ${g.admin.join(', ') || '无'}`,
      `推送目标: ${g.contacts.join(', ') || '无'}`,
    ].join('\n')
  }
  const lines = Object.values(group)
    .filter((g) => operator === 'master' || g.creator === operator || g.admin.includes(operator))
    .map((g) => `${g.name}@${g.creator}`)
  return lines.length === 0 ? '没有创建或管理任何分组哦' : lines.join('\n')
}

export function setGroupAdmin(name, contacts, operator) {
  const group = groupData()
  const g = group[name]
  if (!g) return `没有此分组 [${name}]`
  if (g.creator !== operator && operator !== 'master') return '无权添加'
  let failMsg = ''
  for (const c of contacts.split(/[,，]/)) {
    if (/^\d+$/.test(c.trim())) {
      if (!g.admin.includes(c.trim())) g.admin.push(c.trim())
    } else {
      failMsg += `${c}, `
    }
  }
  saveData()
  return failMsg ? `[${failMsg}] 添加失败` : '添加成功'
}

export function banGroupAdmin(name, contacts, operator) {
  const group = groupData()
  const g = group[name]
  if (!g) return `没有此分组 [${name}]`
  if (g.creator !== operator && operator !== 'master') return '无权删除'
  let failMsg = ''
  for (const c of contacts.split(/[,，]/)) {
    const removed = g.admin.filter((a) => a !== c.trim())
    if (removed.length === g.admin.length) failMsg += `${c}, `
    g.admin = removed
  }
  saveData()
  return failMsg ? `[${failMsg}] 删除失败` : '删除成功'
}

export function checkGroupPerm(name, operator) {
  const g = groupData()[name]
  if (!g) return false
  return g.creator === operator || operator === 'master' || g.admin.includes(String(operator))
}

export function pushGroupContact(name, contacts, operator) {
  const group = groupData()
  const g = group[name]
  if (!g) return `没有此分组 [${name}]`
  if (!checkGroupPerm(name, operator)) return '无权添加'
  let failMsg = ''
  for (const c of contacts.split(/[,，]/)) {
    const parsed = parseContactArg(c)
    if (parsed) {
      if (!g.contacts.includes(parsed)) g.contacts.push(parsed)
    } else {
      failMsg += `${c}, `
    }
  }
  saveData()
  return failMsg ? `[${failMsg}] 添加失败` : '添加成功'
}

export function delGroupContact(name, contacts, operator) {
  const group = groupData()
  const g = group[name]
  if (!g) return `没有此分组 [${name}]`
  if (!checkGroupPerm(name, operator)) return '无权删除'
  let failMsg = ''
  for (const c of contacts.split(/[,，]/)) {
    const parsed = parseContactArg(c)
    if (parsed && g.contacts.includes(parsed)) {
      g.contacts = g.contacts.filter((x) => x !== parsed)
    } else {
      failMsg += `${c}, `
    }
  }
  saveData()
  return failMsg ? `[${failMsg}] 删除失败` : '删除成功'
}

/** 分组名 -> 组内推送目标（订阅联系人中出现分组名时展开） */
export function expandGroupContact(contact) {
  const g = getData().group?.[contact]
  return g?.contacts?.length ? g.contacts : null
}



/**
 * 通过 uid 数字或用户名匹配订阅中的用户
 * @returns { uid, name } | null | { ambiguous: [...]}
 */
export function matchUser(target) {
  if (/^\d+$/.test(target)) {
    const sub = getData().dynamic[target]
    return { uid: target, name: sub?.name ?? String(target) }
  }
  const list = Object.entries(getData().dynamic)
    .filter(([k]) => k !== '0')
    .map(([uid, sub]) => ({ uid, name: sub.name }))
  const matched = fuzzySearch(list, target)
  if (matched.length === 0) return null
  if (matched.length === 1) {
    const uid = matched[0].uid
    return { uid, name: getData().dynamic[uid]?.name ?? String(uid) }
  }
  return { ambiguous: matched.map((m) => ({ uid: m.uid, name: getData().dynamic[m.uid]?.name, rate: m.rate })) }
}

/* ------------------------------------------------------------------ */
/* 过滤器（对应 FilterService / SendTasker.toFilterType）                */
/* ------------------------------------------------------------------ */

export const FILTER_TYPES = {
  动态: 'DYNAMIC',
  转发动态: 'FORWARD',
  视频: 'VIDEO',
  音乐: 'MUSIC',
  专栏: 'ARTICLE',
  直播: 'LIVE',
}

export const FILTER_TYPE_NAMES = Object.fromEntries(
  Object.entries(FILTER_TYPES).map(([name, key]) => [key, name]),
)

export const AT_ALL_TYPES = {
  全部: 'ALL', all: 'ALL', a: 'ALL',
  全部动态: 'DYNAMIC', dynamic: 'DYNAMIC', d: 'DYNAMIC',
  视频: 'VIDEO', video: 'VIDEO', v: 'VIDEO',
  音乐: 'MUSIC', music: 'MUSIC', m: 'MUSIC',
  专栏: 'ARTICLE', article: 'ARTICLE',
  直播: 'LIVE', live: 'LIVE', l: 'LIVE',
}

export const AT_ALL_NAMES = {
  ALL: '全部', DYNAMIC: '全部动态', VIDEO: '视频', MUSIC: '音乐', ARTICLE: '专栏', LIVE: '直播',
}

/** 动态类型 -> 过滤器分类（对应 DynamicType.toFilterType） */
export function filterCategoryOf(type) {
  switch (type) {
    case 'DYNAMIC_TYPE_WORD':
    case 'DYNAMIC_TYPE_DRAW':
    case 'DYNAMIC_TYPE_COMMON_SQUARE':
    case 'DYNAMIC_TYPE_COMMON_VERTICAL':
    case 'DYNAMIC_TYPE_UNKNOWN':
    case 'DYNAMIC_TYPE_NONE':
      return 'DYNAMIC'
    case 'DYNAMIC_TYPE_FORWARD':
      return 'FORWARD'
    case 'DYNAMIC_TYPE_AV':
    case 'DYNAMIC_TYPE_UGC_SEASON':
    case 'DYNAMIC_TYPE_PGC':
    case 'DYNAMIC_TYPE_PGC_UNION':
      return 'VIDEO'
    case 'DYNAMIC_TYPE_MUSIC':
      return 'MUSIC'
    case 'DYNAMIC_TYPE_ARTICLE':
      return 'ARTICLE'
    case 'DYNAMIC_TYPE_LIVE':
    case 'DYNAMIC_TYPE_LIVE_RCMD':
      return 'LIVE'
    default:
      return 'DYNAMIC'
  }
}

/** 动态类型 -> AtAll 分类（对应 DynamicType.toAtAllType） */
export function atAllCategoryOf(type) {
  switch (type) {
    case 'DYNAMIC_TYPE_AV':
      return 'VIDEO'
    case 'DYNAMIC_TYPE_MUSIC':
      return 'MUSIC'
    case 'DYNAMIC_TYPE_ARTICLE':
      return 'ARTICLE'
    default:
      return 'DYNAMIC'
  }
}

function ensureFilter(contact, uid) {
  const data = getData()
  if (!data.filter[contact]) data.filter[contact] = {}
  if (!data.filter[contact][uid]) {
    data.filter[contact][uid] = {
      typeSelect: { mode: 'BLACK_LIST', list: [] },
      regularSelect: { mode: 'BLACK_LIST', list: [] },
    }
  }
  return data.filter[contact][uid]
}

export function addTypeFilter(typeName, uid, contact, mode) {
  const key = FILTER_TYPES[typeName]
  if (!key) return `没有这个类型 ${typeName}`
  const filter = ensureFilter(contact, uid)
  if (mode) filter.typeSelect.mode = mode
  if (!filter.typeSelect.list.includes(key)) filter.typeSelect.list.push(key)
  saveData()
  return '设置成功'
}

export function addRegularFilter(regex, uid, contact, mode) {
  try {
    new RegExp(regex)
  } catch (err) {
    return `正则表达式错误: ${err.message}`
  }
  const filter = ensureFilter(contact, uid)
  if (mode) filter.regularSelect.mode = mode
  if (!filter.regularSelect.list.includes(regex)) filter.regularSelect.list.push(regex)
  saveData()
  return '设置成功'
}

export function setFilterMode(type, mode, uid, contact) {
  const filter = ensureFilter(contact, uid)
  if (type === 't') filter.typeSelect.mode = mode
  else if (type === 'r') filter.regularSelect.mode = mode
  else return '过滤器类型错误，请使用 t(类型) 或 r(正则)'
  saveData()
  return '设置成功'
}

export function listFilter(uid, contact) {
  const filter = getData().filter[contact]?.[uid]
  if (!filter) return '目标没有过滤器'
  let out = ''
  if (filter.typeSelect.list.length > 0) {
    out += `动态类型过滤器: ${filter.typeSelect.mode === 'WHITE_LIST' ? '白名单' : '黑名单'}\n`
    filter.typeSelect.list.forEach((t, i) => {
      out += `  t${i}: ${FILTER_TYPE_NAMES[t] ?? t}\n`
    })
    out += '\n'
  }
  if (filter.regularSelect.list.length > 0) {
    out += `正则过滤器: ${filter.regularSelect.mode === 'WHITE_LIST' ? '白名单' : '黑名单'}\n`
    filter.regularSelect.list.forEach((r, i) => {
      out += `  r${i}: ${r}\n`
    })
  }
  return out.trim() || '目标没有过滤器'
}

export function delFilter(index, uid, contact) {
  const filter = getData().filter[contact]?.[uid]
  if (!filter) return '当前目标没有过滤器'
  const m = /^([tr])(\d+)$/.exec(index)
  if (!m) return '索引错误'
  const list = m[1] === 't' ? filter.typeSelect.list : filter.regularSelect.list
  const i = Number(m[2])
  if (i >= list.length) return '索引超出范围'
  const removed = list.splice(i, 1)[0]
  saveData()
  return m[1] === 't' ? `已删除 ${FILTER_TYPE_NAMES[removed] ?? removed} 类型过滤` : `已删除 ${removed} 正则过滤`
}

/* ------------------------------------------------------------------ */
/* At 全体                                                              */
/* ------------------------------------------------------------------ */

function ensureAtAll(contact, uid) {
  const data = getData()
  if (!data.atAll[contact]) data.atAll[contact] = {}
  if (!data.atAll[contact][uid]) data.atAll[contact][uid] = []
  return data.atAll[contact][uid]
}

export function addAtAll(typeKey, uid, contact) {
  const list = ensureAtAll(contact, uid)
  if (!list.includes(typeKey)) list.push(typeKey)
  saveData()
  return '设置成功'
}

export function delAtAll(typeKey, uid, contact) {
  const list = getData().atAll[contact]?.[uid]
  if (!list || !list.includes(typeKey)) return '没有设置过这个 At全体'
  getData().atAll[contact][uid] = list.filter((t) => t !== typeKey)
  if (getData().atAll[contact][uid].length === 0) delete getData().atAll[contact][uid]
  saveData()
  return '取消成功'
}

export function listAtAll(uid, contact) {
  const atAll = getData().atAll[contact]?.[uid]
  if (!atAll || atAll.length === 0) return '目标没有设置 At全体'
  return atAll.map((t) => AT_ALL_NAMES[t] ?? t).join('、')
}

/** 查询目标+uid 是否需要 @全体（对应 SendTasker.checkAtAll） */
export function checkAtAll(contact, uid, type) {
  const atAll = getData().atAll[contact]
  if (!atAll) return false
  const list = atAll[String(uid)] ?? atAll[0]
  if (!list || list.length === 0) return false
  if (list.includes('ALL')) return true
  if (atAllCategoryOf(type) === 'LIVE' && list.includes('LIVE')) return true
  return list.includes(atAllCategoryOf(type))
}

/* ------------------------------------------------------------------ */
/* 颜色 / 模板                                                          */
/* ------------------------------------------------------------------ */

export function setSubColor(uid, color) {
  const parts = color.split(/[;；]/)
  for (const part of parts) {
    if (!/^#[0-9a-fA-F]{6}$/.test(part.trim())) {
      return '格式错误，请输入16进制颜色，如: #d3edfa，多色用分号分隔'
    }
  }
  const data = getData()
  const sub = data.dynamic[String(uid)]
  if (sub) sub.color = color
  const bangumi = data.bangumi[String(uid)]
  if (bangumi) bangumi.color = color
  if (!sub && !bangumi) return '没有这个订阅'
  saveData()
  return '设置完成'
}

export function subColor(uid) {
  const data = getData()
  return data.dynamic[String(uid)]?.color ?? data.bangumi[String(uid)]?.color ?? null
}

const TEMPLATE_KINDS = { d: 'dynamicPushTemplate', l: 'livePushTemplate', c: 'liveCloseTemplate' }

export function setTemplate(kind, name, contact) {
  const key = TEMPLATE_KINDS[kind]
  if (!key) return '模板类型错误，请使用 d(动态) / l(直播) / c(下播)'
  const data = getData()
  const map = data[key]
  // 先把该联系人从其他模板中移除（每个联系人仅归属一个模板）
  for (const list of Object.values(map)) {
    const i = list.indexOf(contact)
    if (i !== -1) list.splice(i, 1)
  }
  if (!map[name]) map[name] = []
  if (!map[name].includes(contact)) map[name].push(contact)
  saveData()
  return '设置成功'
}

export function templateOf(kind, contact) {
  const map = getData()[TEMPLATE_KINDS[kind]]
  for (const [name, list] of Object.entries(map ?? {})) {
    if (list.includes(contact)) return name
  }
  return null
}

/* ------------------------------------------------------------------ */
/* 列表                                                                 */
/* ------------------------------------------------------------------ */

/** 目标订阅列表（对应 DynamicService.list） */
export function listSubscribe(contact) {
  const data = getData()
  const lines = []
  let count = 0
  for (const [uid, sub] of Object.entries(data.dynamic)) {
    if (uid === '0' || !sub.contacts.includes(contact)) continue
    lines.push(`${sub.name}(${uid})`)
    count++
  }
  for (const [ssid, bangumi] of Object.entries(data.bangumi)) {
    if (!bangumi.contacts.includes(contact)) continue
    lines.push(`${bangumi.title}(ss${ssid})`)
    count++
  }
  return lines.length === 0
    ? '当前目标还没有订阅哦'
    : `当前订阅列表：\n${lines.join('\n')}\n共 ${count} 个订阅`
}

/** 全部订阅列表（对应 DynamicService.listAll） */
export function listAllSubscribe() {
  const data = getData()
  const lines = ['名称@UID#订阅人数', '']
  let count = 0
  for (const [uid, sub] of Object.entries(data.dynamic)) {
    if (uid === '0') continue
    lines.push(`${sub.name}@${uid}#${sub.contacts.length}`)
    count++
  }
  for (const [ssid, bangumi] of Object.entries(data.bangumi)) {
    lines.push(`${bangumi.title}@ss${ssid}#${bangumi.contacts.length}`)
    count++
  }
  return `${lines.join('\n')}\n共 ${count} 个订阅`
}

/** 用户列表：某个订阅被哪些目标订阅（对应 DynamicService.listUser） */
export function listUser(target) {
  const data = getData()
  const contacts = new Set()
  if (target == null) {
    for (const sub of Object.values(data.dynamic)) {
      for (const c of sub.contacts) contacts.add(c)
    }
  } else {
    const sub = data.dynamic[String(target)]
    if (!sub) return `没有这个用户哦 [${target}]`
    for (const c of sub.contacts) contacts.add(c)
  }
  const groups = []
  const friends = []
  for (const c of contacts) {
    const { type, id } = parseContact(c)
    ;(type === 'group' ? groups : friends).push(id)
  }
  const lines = ['====群====', groups.join('\n') || '无', '====好友====', friends.join('\n') || '无', '', `共 ${contacts.size} 个目标`]
  return lines.join('\n')
}
