/**
 * 群聊 B 站链接/分享卡片自动解析 —— 移植自 ListenerTasker.kt
 *
 * 群消息包含 B 站链接（含 QQ 分享卡片 JSON 内的 URL）时自动绘制卡片图回复。
 * 触发模式（config.linkResolve.triggerMode）：At（@机器人时）/ Always / Never
 * returnLink：回复时是否附加原链接
 */
import plugin from '../../../lib/plugins/plugin.js'
import { getConfig } from '../model/Config.js'
import { drawGeneral, getLink, matchingRegular } from '../model/ResolveLink.js'

const logger = global.logger ?? console

/** 触发模式判断（对应 TriggerMode） */
function triggered(e, mode) {
  if (mode === 'Always') return true
  if (mode === 'Never') return false
  // 默认 At：消息中 @ 了任意已连接 Bot
  if (e.atBot) return true
  const at = e.at
  if (!at) return false
  const uins = [].concat(global.Bot?.uin ?? []).map(String)
  return uins.includes(String(at))
}

/** 提取消息文本（含 JSON/XML 卡片内容，对应 message.content） */
function messageContent(e) {
  let content = typeof e.msg === 'string' ? e.msg : ''
  if (Array.isArray(e.message)) {
    for (const seg of e.message) {
      if (seg.type === 'json' || seg.type === 'xml') {
        content += ' ' + (typeof seg.data === 'string' ? seg.data : JSON.stringify(seg.data ?? ''))
      }
    }
  }
  return content
}

export class BiliListener extends plugin {
  constructor() {
    super({
      name: 'B站链接解析',
      dsc: '群聊 B 站链接/分享卡片自动解析绘图',
      event: 'message',
      priority: 1000,
      // rule: [{ reg: '', fnc: 'resolveLink', log: false }],
      rule: [],
    })
  }

  async resolveLink(e) {
    try {
      const cfg = getConfig().linkResolve
      if (!cfg || cfg.triggerMode === 'Never') return false
      if (!e.isGroup) return false
      if (!triggered(e, cfg.triggerMode)) return false

      // 跳过指令与其他机器人消息
      const raw = typeof e.msg === 'string' ? e.msg : ''
      if (/^[#/]/.test(raw.trim())) return false
      if (e.user_id && [].concat(global.Bot?.uin ?? []).map(Number).includes(Number(e.user_id))) return false

      const content = messageContent(e)
      const resolved = matchingRegular(content)
      if (!resolved) return false

      logger.info(`[bilibili-dynamic] 开始解析链接 -> ${content.trim()}`)

      let loading = null
      if (getConfig().showLoadingMessage !== false) {
        loading = await e.group?.sendMsg?.('加载中...')
      }

      try {
        const img = await drawGeneral(resolved.type, resolved.id)
        if (!img) {
          await this.recall(e, loading)
          e.reply('解析失败')
          return true
        }
        const segments = [global.segment.image(img.buffer)]
        if (cfg.returnLink) segments.push(getLink(resolved.type, resolved.id))
        await this.recall(e, loading)
        e.reply(segments)
      } catch (err) {
        logger.error(`[bilibili-dynamic] 链接解析失败: ${err.stack ?? err.message}`)
        await this.recall(e, loading)
        e.reply('解析失败')
      }
      return true
    } catch (err) {
      logger.error(`[bilibili-dynamic] 链接监听异常: ${err.stack ?? err.message}`)
      return false
    }
  }

  async recall(e, sent) {
    if (!sent || !e.group?.recallMsg) return
    const ids = Array.isArray(sent) ? sent.filter(Boolean) : [sent]
    for (const id of ids) {
      try {
        e.group.recallMsg(id?.message_id ?? id)
      } catch {}
    }
  }
}

export default BiliListener
