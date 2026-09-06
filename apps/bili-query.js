/**
 * B 站查询/登录指令
 */
import plugin from '../../../lib/plugins/plugin.js'
import { getData } from '../model/Config.js'
import * as Data from '../model/Data.js'
import * as Api from '../model/Api.js'
import * as Dynamic from '../model/Dynamic.js'
import { renderDynamic, renderLoginQrcode, renderSearchCard } from '../model/Render.js'
import { startPush, stats } from '../model/Push.js'
import { matchUid, replyError, splitArgs } from '../model/helpers.js'
import { sleep } from '../model/Utils.js'

const logger = global.logger ?? console

export class BiliQuery extends plugin {
  constructor() {
    super({
      name: 'B站动态查询',
      dsc: 'B站动态/视频查询与扫码登录',
      event: 'message',
      priority: 500,
      rule: [
        { reg: '^#bili(登录|login)$', fnc: 'login', permission: 'master' },
        { reg: '^#bili(动态|最新动态)\\s*(.*)$', fnc: 'queryDynamic' },
        { reg: '^#bili(视频|最新视频)\\s*(.*)$', fnc: 'queryVideo' },
        { reg: '^#bili(动态详情|搜动态)\\s*(\\d{5,})$', fnc: 'queryDynamicDetail' },
        { reg: '^#bili(查找用户|搜索用户)\\s+(.+)$', fnc: 'searchUser' },
        { reg: '^#bili状态$', fnc: 'status', permission: 'master' },
      ],
    })
    // 启动推送任务（插件加载时执行一次）
    if (!globalThis.__biliPushStarted) {
      globalThis.__biliPushStarted = true
      try {
        startPush()
      } catch (err) {
        logger.error(`[bilibili-dynamic] 推送任务启动失败: ${err.message}`)
      }
    }
  }

  /** 扫码登录（对应 LoginService.login） */
  async login(e) {
    try {
      const loginData = await Api.getLoginQrcode()
      const qrBuffer = await renderLoginQrcode(loginData.url)

      const sent = await e.reply([`请使用BiliBili手机APP扫码登录（3分钟有效）\n`, global.segment.image(qrBuffer)])
      const recallIds = Array.isArray(sent) ? sent.filter(Boolean) : [sent].filter(Boolean)

      const deadline = Date.now() + 180_000
      while (Date.now() < deadline) {
        await sleep(3000)
        const info = await Api.pollLoginInfo(loginData.qrcode_key)
        if (info.code === 0 && info.url) {
          const uid = Api.saveLoginCookie(info.url)
          await Api.initFollowGroup()
          e.reply(`登录成功! 账号 UID: ${uid}`)
          this.recall(e, recallIds)
          return true
        }
        if (info.code === 86038) break // 二维码已失效
      }
      e.reply('登录失败或二维码已过期，请重试')
      this.recall(e, recallIds)
    } catch (err) {
      replyError(e, err)
    }
    return true
  }

  recall(e, ids) {
    if (!e.group?.recallMsg) return
    for (const id of ids) {
      try {
        e.group.recallMsg(id)
      } catch {}
    }
  }

  /** 获取用户最新动态（对应 /bili new） */
  async queryDynamic(e) {
    const args = splitArgs(e.msg.replace(/^#bili(动态|最新动态)\s*/, ''))
    if (!args[0]) return e.reply('用法：#bili动态 <UID/用户名> [数量]')
    const matched = matchUid(args[0])
    if (matched === null) return e.reply('未匹配到用户哦，可先使用 #bili查找用户 <关键词> 搜索')
    if (matched.ambiguous) return e.reply('匹配到多个用户，请使用 UID 重试')

    const count = Math.min(5, Math.max(1, Number(args[1]) || 1))
    try {
      e.reply('加载中...', true)
      const list = await Api.getUserNewDynamic(matched.uid, true)
      const items = (list?.items ?? []).filter((item) => item.type !== 'DYNAMIC_TYPE_FORWARD').slice(0, count)
      if (items.length === 0) return e.reply('没有查询到动态')

      for (const item of items) {
        try {
          Dynamic.convertArticle(item)
          const { buffer } = await renderDynamic(item)
          e.reply([global.segment.image(buffer)])
        } catch (err) {
          logger.warn(`[bilibili-dynamic] 绘制动态失败: ${err.message}`)
          e.reply(`动态 ${Dynamic.didOf(item)} 绘制失败: ${err.message}`)
        }
      }
    } catch (err) {
      replyError(e, err)
    }
    return true
  }

  /** 获取用户最新视频（对应 /bili video） */
  async queryVideo(e) {
    const args = splitArgs(e.msg.replace(/^#bili(视频|最新视频)\s*/, ''))
    if (!args[0]) return e.reply('用法：#bili视频 <UID/用户名>')
    const matched = matchUid(args[0])
    if (matched === null) return e.reply('未匹配到用户哦，可先使用 #bili查找用户 <关键词> 搜索')
    if (matched.ambiguous) return e.reply('匹配到多个用户，请使用 UID 重试')

    try {
      e.reply('加载中...', true)
      const list = await Api.searchUserVideo(matched.uid, 5)
      const videos = list?.list?.vlist ?? []
      if (videos.length === 0) return e.reply('没有查询到视频')

      for (const video of videos.slice(0, 3)) {
        try {
          const { buffer } = await renderSearchCard({
            id: video.bvid,
            tag: '视频',
            time: '',
            author: Dynamic.plainAuthor({ mid: video.mid, name: video.author }),
            major: {
              type: 'MAJOR_TYPE_ARCHIVE',
              archive: {
                title: video.title,
                desc: video.description ?? null,
                cover: video.pic,
                badge: { text: '视频', bgColor: '#fb7299', color: '#ffffff' },
                aid: video.aid,
                bvid: video.bvid,
                durationText: video.length ?? '',
                stat: { play: video.play ?? '', danmaku: video.video_review ?? '' },
              },
            },
            link: `https://www.bilibili.com/video/${video.bvid}`,
          })
          e.reply([global.segment.image(buffer)])
        } catch (err) {
          logger.warn(`[bilibili-dynamic] 绘制视频失败: ${err.message}`)
        }
      }
    } catch (err) {
      replyError(e, err)
    }
    return true
  }

  /** 通过 ID 查询动态（对应 /bili search） */
  async queryDynamicDetail(e) {
    const did = e.msg.replace(/^#bili(动态详情|搜动态)\s*/, '')
    try {
      e.reply('加载中...', true)
      const item = await Api.getDynamicDetail(did)
      if (!item) return e.reply('没有查询到该动态')
      Dynamic.convertArticle(item)
      const { buffer } = await renderDynamic(item)
      e.reply([global.segment.image(buffer)])
    } catch (err) {
      replyError(e, err)
    }
    return true
  }

  /** 搜索 B 站用户 */
  async searchUser(e) {
    const keyword = e.msg.replace(/^#bili(查找用户|搜索用户)\s+/, '').trim()
    try {
      e.reply('加载中...', true)
      const result = await Api.searchUser(keyword, 1, 10)
      const users = result?.result ?? []
      if (users.length === 0) return e.reply('没有找到相关用户')
      const lines = users.map((u, i) => `${i + 1}. ${u.uname} (${u.mid})  粉丝:${u.fans ?? 0}`)
      e.reply(`搜索到以下用户：\n${lines.join('\n')}\n\n使用 UID 即可 #bili订阅`)
    } catch (err) {
      replyError(e, err)
    }
    return true
  }

  /** 插件运行状态 */
  async status(e) {
    const data = getData()
    const subCount = Object.keys(data.dynamic).filter((k) => k !== '0').length
    const bangumiCount = Object.keys(data.bangumi).length
    const contacts = Data.allContacts().length
    e.reply(
      `【B站动态插件状态】\n` +
      `B站账号: ${data.uid || '未登录'}${data.cookie ? '' : '（无 cookie）'}\n` +
      `订阅: ${subCount} 个UP主 / ${bangumiCount} 个番剧\n` +
      `推送目标: ${contacts} 个\n` +
      `检测次数: 动态 ${stats.dynamicChecks} / 直播 ${stats.liveChecks}\n` +
      `已推送: ${stats.pushed} 条\n` +
      `队列长度: ${Push.queueLength()}\n` +
      `最近错误: ${stats.lastError || '无'}`,
    )
    return true
  }
}

export default BiliQuery
