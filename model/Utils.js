/**
 * 通用工具 —— 移植自 utils/General.kt（时间格式化、模糊匹配、MD5 等）
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export function pad2(n) {
  return n >= 1 && n <= 9 ? `0${n}` : String(n)
}

/** 秒级时间戳 -> "yyyy年MM月dd日 HH:mm:ss"（对应 Long.formatTime） */
export function formatTime(sec, template = 'yyyy年MM月dd日 HH:mm:ss') {
  if (!sec) sec = Math.floor(Date.now() / 1000)
  const d = new Date(sec * 1000)
  const map = {
    yyyy: d.getFullYear(),
    MM: pad2(d.getMonth() + 1),
    dd: pad2(d.getDate()),
    HH: pad2(d.getHours()),
    mm: pad2(d.getMinutes()),
    ss: pad2(d.getSeconds()),
  }
  return template.replace(/yyyy|MM|dd|HH|mm|ss/g, (k) => map[k])
}

/** 秒 -> "x天 x小时 x分钟 x秒"（对应 Long.formatDuration） */
export function formatDuration(sec, isText = true) {
  const day = Math.floor(sec / 86400)
  const hour = Math.floor((sec % 86400) / 3600)
  const minute = Math.floor((sec % 3600) / 60)
  const second = sec % 60
  if (isText) {
    let out = ''
    if (day > 0) out += `${day}天 `
    if (hour > 0) out += `${hour}小时 `
    if (minute > 0) out += `${minute}分钟 `
    if (second > 0) out += `${second}秒`
    return out || '0秒'
  }
  let out = ''
  if (day > 0) out += `${pad2(day)}:`
  if (hour > 0) out += `${pad2(hour)}:`
  out += `${pad2(minute)}:${pad2(second)}`
  return out
}

export function md5(str) {
  return crypto.createHash('md5').update(str, 'utf8').digest('hex')
}

/** B 站图片处理接口（canvaskit 也导出同名函数，这里给 API 层复用） */
export function imgApi(imgUrl, width, height) {
  return `${imgUrl}@${width}w_${height}h_1e_1c.png`
}

/* ------------------------------------------------------------------ */
/* 本地模糊搜索（对应 findLocalIdOrName / fuzzySearch）                  */
/* ------------------------------------------------------------------ */

/** 对应 String.fuzzyMatchWith：按字符顺序匹配打分 */
export function fuzzyMatchWith(name, target) {
  if (name === target) return 1
  let match = 0
  for (let i = 0; i <= Math.max(name.length, target.length); i++) {
    const t = target[match]
    if (t == null) break
    if (t === name[i]) match++
  }
  const longer = Math.max(name.length, target.length)
  const shorter = Math.min(name.length, target.length)
  return match / (longer + (shorter - match))
}

/**
 * 模糊搜索，对应 fuzzySearch
 * @param list [{ uid, name }]
 * @returns [{ uid, rate }]
 */
export function fuzzySearch(list, target, minRate = 0.2, matchRate = 0.6, disambiguationRate = 0.1) {
  const candidates = list
    .map((it) => ({ uid: it.uid, name: it.name, rate: fuzzyMatchWith(it.name, target) }))
    .filter((it) => it.rate >= minRate)
    .sort((a, b) => b.rate - a.rate)

  const best = candidates.filter((it) => it.rate >= matchRate)
  if (best.length === 0) return candidates.map(({ uid, rate }) => ({ uid, rate }))
  if (best.length === 1) return [{ uid: best[0].uid, rate: 1 }]
  if (best[0].rate - best[best.length - 1].rate <= disambiguationRate) {
    return candidates.map(({ uid, rate }) => ({ uid, rate }))
  }
  return [{ uid: best[0].uid, rate: 1 }]
}

/* ------------------------------------------------------------------ */
/* 文件/目录                                                            */
/* ------------------------------------------------------------------ */

export function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}

/** 递归遍历目录，回调文件绝对路径 */
export function walkFiles(dir, cb) {
  let entries = []
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) walkFiles(p, cb)
    else cb(p)
  }
}

/** 深合并（配置读取用），b 覆盖 a */
export function deepMerge(a, b) {
  const out = Array.isArray(a) ? [...a] : { ...a }
  for (const key of Object.keys(b || {})) {
    const bv = b[key]
    if (bv && typeof bv === 'object' && !Array.isArray(bv)) {
      out[key] = deepMerge(a?.[key] && typeof a[key] === 'object' ? a[key] : {}, bv)
    } else if (bv !== undefined) {
      out[key] = bv
    }
  }
  return out
}

/** 解析 "#指令 参数1 参数2..." 的参数，支持引号包裹的正则 */
export function splitArgs(str) {
  const out = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  let m
  while ((m = re.exec(str))) {
    out.push(m[1] ?? m[2] ?? m[3])
  }
  return out
}

export function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
