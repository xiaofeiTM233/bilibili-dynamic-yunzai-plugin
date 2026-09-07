/**
 * 订阅数据操作 —— 移植自 DynamicService.kt / BiliData.kt
 *
 * 联系人表示：g<群号>（群聊）/ f<QQ号>（好友），uid 为字符串。
 */
import { getData, saveData } from './Config.js'
import { fuzzySearch } from './Utils.js'

export const logger = global.logger ?? console

/* ------------------------------------------------------------------ */
/* 联系人                                                               */
/* ------------------------------------------------------------------ */

/** e -> "g<群号>" / "f<QQ号>"（对应 Contact.delegate） */
export function contactOf(e) {
  return e.isGroup ? `g${e.group_id}` : `f${e.user_id}`
}

/** 解析联系人字符串 */
export function parseContact(contact) {
  if (contact.startsWith('g')) return { type: 'group', id: contact.slice(1) }
  if (contact.startsWith('f')) return { type: 'friend', id: contact.slice(1) }
  return { type: 'group', id: contact }
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
  if (!data.dynamic[uid]) data.dynamic[uid] = { name, color: null, contacts: [] }
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
  delete data.dynamicTemplate[contact]
  delete data.liveTemplate[contact]
  delete data.liveCloseTemplate[contact]
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

/** 联系人参数解析："f123" / "g123" / 纯数字（默认为群） */
function parseContactArg(arg) {
  const s = String(arg).trim()
  if (!s) return null
  if (/^f\d+$/.test(s)) return s
  if (/^g\d+$/.test(s)) return s
  if (/^\d+$/.test(s)) return `g${s}`
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
  delete data.dynamicTemplate[name]
  delete data.liveTemplate[name]
  delete data.liveCloseTemplate[name]
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
  动态: 'dynamic',
  转发动态: 'forward',
  视频: 'video',
  音乐: 'music',
  专栏: 'article',
  直播: 'live',
}

export const FILTER_TYPE_NAMES = Object.fromEntries(
  Object.entries(FILTER_TYPES).map(([name, key]) => [key, name]),
)

export const AT_ALL_TYPES = {
  全部: 'all', all: 'all', a: 'all',
  全部动态: 'dynamic', dynamic: 'dynamic', d: 'dynamic',
  视频: 'video', video: 'video', v: 'video',
  音乐: 'music', music: 'music', m: 'music',
  专栏: 'article', article: 'article',
  直播: 'live', live: 'live', l: 'live',
}

export const AT_ALL_NAMES = {
  all: '全部', dynamic: '全部动态', video: '视频', music: '音乐', article: '专栏', live: '直播',
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
      return 'dynamic'
    case 'DYNAMIC_TYPE_FORWARD':
      return 'forward'
    case 'DYNAMIC_TYPE_AV':
    case 'DYNAMIC_TYPE_UGC_SEASON':
    case 'DYNAMIC_TYPE_PGC':
    case 'DYNAMIC_TYPE_PGC_UNION':
      return 'video'
    case 'DYNAMIC_TYPE_MUSIC':
      return 'music'
    case 'DYNAMIC_TYPE_ARTICLE':
      return 'article'
    case 'DYNAMIC_TYPE_LIVE':
    case 'DYNAMIC_TYPE_LIVE_RCMD':
      return 'live'
    default:
      return 'dynamic'
  }
}

/** 动态类型 -> AtAll 分类（对应 DynamicType.toAtAllType） */
export function atAllCategoryOf(type) {
  switch (type) {
    case 'DYNAMIC_TYPE_AV':
      return 'video'
    case 'DYNAMIC_TYPE_MUSIC':
      return 'music'
    case 'DYNAMIC_TYPE_ARTICLE':
      return 'article'
    default:
      return 'dynamic'
  }
}

function ensureFilter(contact, uid) {
  const data = getData()
  if (!data.filter[contact]) data.filter[contact] = {}
  if (!data.filter[contact][uid]) {
    data.filter[contact][uid] = {
      typeSelect: { mode: 'black', list: [] },
      regularSelect: { mode: 'black', list: [] },
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
    out += `动态类型过滤器: ${filter.typeSelect.mode === 'white' ? '白名单' : '黑名单'}\n`
    filter.typeSelect.list.forEach((t, i) => {
      out += `  t${i}: ${FILTER_TYPE_NAMES[t] ?? t}\n`
    })
    out += '\n'
  }
  if (filter.regularSelect.list.length > 0) {
    out += `正则过滤器: ${filter.regularSelect.mode === 'white' ? '白名单' : '黑名单'}\n`
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
  if (list.includes('all')) return true
  if (atAllCategoryOf(type) === 'live' && list.includes('live')) return true
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

export function setTemplate(kind, name, contact) {
  const data = getData()
  const key = kind === 'd' ? 'dynamicTemplate' : kind === 'l' ? 'liveTemplate' : 'liveCloseTemplate'
  data[key][contact] = name
  saveData()
  return '设置成功'
}

export function templateOf(kind, contact) {
  const data = getData()
  const key = kind === 'd' ? 'dynamicTemplate' : kind === 'l' ? 'liveTemplate' : 'liveCloseTemplate'
  return data[key][contact] ?? null
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
