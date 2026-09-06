/**
 * 指令层公共辅助
 */
import { getData } from './Config.js'
import * as Data from './Data.js'
import * as Api from './Api.js'
import { splitArgs } from './Utils.js'
import { LoginExpiredError } from './Api.js'

const logger = global.logger ?? console

/** 是否为群管理员或主人 */
export function canManage(e) {
  if (e.isMaster) return true
  if (e.isGroup && (e.group?.isOwner || e.group?.isAdmin)) return true
  return false
}

/**
 * 解析指令参数中的目标联系人（跨目标操作仅限主人）
 * @returns contact 字符串，或 null（无权限/非法）
 */
export function resolveTarget(e, targetArg) {
  if (!targetArg) return Data.contactOf(e)
  if (!e.isMaster) return null
  return /^\d+$/.test(targetArg) ? `g${targetArg}` : targetArg
}

/** 解析 uid/用户名 参数（对应 matchUser） */
export function matchUid(target) {
  return Data.matchUser(target)
}

/** 订阅用户（含自动关注与昵称获取），返回错误信息或 null */
export async function subscribeUser(uid, contact) {
  const data = getData()
  const known = data.dynamic[String(uid)]
  if (!Data.isFollow(uid, contact) && !known) {
    // 本地没有该用户信息：先自动关注再拉取昵称
    const err = await Api.autoFollow(uid)
    if (err) return err
  }
  let name = known?.name
  if (!name) {
    try {
      const user = await Api.userInfo(uid)
      name = user?.name ?? String(uid)
    } catch {
      name = String(uid)
    }
  }
  Data.addSubscribe(uid, name, contact)
  return null
}

/** 统一处理 API 错误回复 */
export function replyError(e, err) {
  if (err instanceof LoginExpiredError) {
    e.reply('B 站账号登录失效，请管理员使用 #bili登录 重新登录')
  } else {
    logger.warn(`[bilibili-dynamic] 指令执行失败: ${err.stack ?? err.message}`)
    e.reply(`操作失败: ${err.message}`)
  }
}

export { splitArgs }
