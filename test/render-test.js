/**
 * 渲染管线与模板构建测试（独立于 Yunzai 运行）
 *
 * 用法：node test/render-test.js
 * 输出：test/output/*.png
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const testDir = path.dirname(fileURLToPath(import.meta.url))
const outDir = path.join(testDir, 'output')
fs.mkdirSync(outDir, { recursive: true })

// Yunzai 环境桩
global.logger = {
  info: (...a) => console.log('[info]', ...a),
  warn: (...a) => console.warn('[warn]', ...a),
  error: (...a) => console.error('[error]', ...a),
}
global.segment = {
  image: (b) => ({ type: 'image', buffer: typeof b === 'string' ? b : `<image ${b?.length ?? 0}B>` }),
  at: (q) => ({ type: 'at', qq: q }),
}

const { renderDynamic, renderLive } = await import('../model/Render.js')
const Push = await import('../model/Push.js')
const Dynamic = await import('../model/Dynamic.js')

const PIX_BASE = 'https://i0.hdslb.com/bfs/example'
let failed = 0
const check = (name, ok, extra = '') => {
  console.log(`${ok ? '✅' : '❌'} ${name} ${extra}`)
  if (!ok) failed++
}

/* ------------------------------------------------------------------ */
/* 1. 图片动态                                                          */
/* ------------------------------------------------------------------ */
const drawItem = {
  type: 'DYNAMIC_TYPE_DRAW',
  id_str: '1047599195862683648',
  basic: { comment_id_str: '1', comment_type: 17, rid_str: '1' },
  modules: {
    module_author: {
      mid: 2, name: '测试UP主', face: `${PIX_BASE}/face.jpg`,
      pub_ts: Math.floor(Date.now() / 1000) - 3600,
      official_verify: { type: 0, desc: '' },
      pendant: null,
      decorate: { id: 1, type: 3, name: '粉丝装', card_url: `${PIX_BASE}/fan.png`, jump_url: '', fan: { color: '#FFDE6B20', num_str: '1024', number: 1024 } },
    },
    module_dynamic: {
      topic: { id: 1, name: '测试话题', jump_url: '' },
      desc: {
        text: '这是一条测试动态，包含链接与表情。',
        rich_text_nodes: [
          { type: 'RICH_TEXT_NODE_TYPE_TEXT', orig_text: '这是一条测试动态，', text: '这是一条测试动态，' },
          { type: 'RICH_TEXT_NODE_TYPE_EMOJI', orig_text: '[妙啊]', text: '[妙啊]', emoji: { type: 1, icon_url: `${PIX_BASE}/emoji.png`, size: 1, text: '[妙啊]' } },
          { type: 'RICH_TEXT_NODE_TYPE_TEXT', orig_text: '包含链接与表情。', text: '包含链接与表情。' },
        ],
      },
      major: {
        type: 'MAJOR_TYPE_DRAW',
        draw: {
          id: 1,
          items: [
            { width: 800, height: 800, src: `${PIX_BASE}/pic1.jpg` },
            { width: 1920, height: 1080, src: `${PIX_BASE}/pic2.jpg` },
          ],
        },
      },
      additional: {
        type: 'ADDITIONAL_TYPE_RESERVE',
        reserve: {
          rid: 1, up_mid: 2, title: '预约标题', reserve_total: 100, state: 1, stype: 1,
          desc1: { text: '预约描述1', style: 0 }, desc2: { text: '预约描述2', style: 0 },
          jump_url: '', button: { type: 1, status: 1 },
        },
      },
    },
  },
}

/* ------------------------------------------------------------------ */
/* 2. 视频动态                                                          */
/* ------------------------------------------------------------------ */
const avItem = {
  type: 'DYNAMIC_TYPE_AV',
  id_str: '1047600000000000001',
  basic: { comment_id_str: '1', comment_type: 1, rid_str: '1' },
  modules: {
    module_author: { mid: 3, name: '视频UP主', face: `${PIX_BASE}/face2.jpg`, pub_ts: Math.floor(Date.now() / 1000) - 7200 },
    module_dynamic: {
      desc: null,
      major: {
        type: 'MAJOR_TYPE_ARCHIVE',
        archive: {
          type: 1, aid: '123', bvid: 'BV1xx411c7XX', title: '【测试】视频标题',
          cover: `${PIX_BASE}/cover.jpg`, desc: '视频简介',
          duration_text: '10:24', jump_url: 'https://www.bilibili.com/video/BV1xx411c7XX',
          stat: { danmaku: '233', play: '1.2万' },
          badge: { bg_color: '#FB7299', color: '#FFFFFF', text: '投稿视频' },
        },
      },
    },
  },
}

/* ------------------------------------------------------------------ */
/* 3. 转发动态                                                          */
/* ------------------------------------------------------------------ */
const forwardItem = {
  type: 'DYNAMIC_TYPE_FORWARD',
  id_str: '1047600000000000002',
  basic: { comment_id_str: '1', comment_type: 17, rid_str: '1' },
  modules: {
    module_author: { mid: 4, name: '转发者', face: `${PIX_BASE}/face3.jpg`, pub_ts: Math.floor(Date.now() / 1000) - 600 },
    module_dynamic: { desc: { text: '转发的理由', rich_text_nodes: [{ type: 'RICH_TEXT_NODE_TYPE_TEXT', orig_text: '转发的理由', text: '转发的理由' }] }, major: null },
  },
  orig: avItem,
}

/* ------------------------------------------------------------------ */
/* 4. 直播                                                              */
/* ------------------------------------------------------------------ */
const live = {
  uid: 2, uname: '测试UP主', roomId: 12345,
  title: '测试直播标题', face: `${PIX_BASE}/face.jpg`,
  cover: `${PIX_BASE}/live_cover.jpg`, liveTime: Math.floor(Date.now() / 1000) - 1800,
  area: '虚拟主播',
}

async function main() {
  const { getConfig } = await import('../model/Config.js')
  console.log('配置:', JSON.stringify({ quality: getConfig().quality, theme: getConfig().theme }))

  // 模板构建测试（不依赖网络）
  const msg = {
    kind: 'dynamic', did: '123', mid: 2, name: '测试UP主', type: 'DYNAMIC_TYPE_DRAW',
    time: '2026年09月06日 20:00:00', timestamp: 1000,
    content: '动态内容', images: ['http://example.com/a.jpg'],
    links: [{ tag: '动态', value: 'https://t.bilibili.com/123' }],
    draw: { buffer: Buffer.alloc(10), path: null },
  }
  const messages = Push.buildMessages(msg, '{draw}\n{name}@{type}\n{link}\r{content}\r{images}', [])
  check('模板构建 OneMsg/多消息拆分', messages.length === 3, `共 ${messages.length} 条消息`)
  check('模板文本替换', messages[0].some((s) => typeof s === 'string' && s.includes('测试UP主@动态')))

  const fwd = Push.buildMessages(msg, '{draw}{>>}作者：{name}\r{content}{<<}', [])
  check('转发消息构建', fwd.length === 2, `共 ${fwd.length} 条消息`)

  // 文本提取测试
  check('动态文本提取', Dynamic.textContent(drawItem).includes('测试动态'))
  check('动态图片提取', Dynamic.imagesOf(drawItem).length === 2)
  check('动态链接提取', Dynamic.linksOf(avItem)[0].value.includes('BV1xx411c7XX'))
  check('专栏 opus 转换', Dynamic.convertArticle({
    type: 'DYNAMIC_TYPE_ARTICLE', id_str: '111', basic: { rid_str: 'cv1' },
    modules: { module_author: {}, module_dynamic: { major: { type: 'MAJOR_TYPE_OPUS', opus: { title: '专栏标题', summary: { text: '专栏摘要', rich_text_nodes: [] }, pics: [{ src: 'a.jpg' }] } } } },
  }) === true)

  // 渲染测试（离线时走占位图降级）
  try {
    const { buffer } = await renderDynamic(drawItem)
    fs.writeFileSync(path.join(outDir, 'dynamic-draw.png'), buffer)
    check('图片动态渲染', buffer.length > 1000, `${(buffer.length / 1024).toFixed(0)} KB`)
  } catch (err) {
    check('图片动态渲染', false, err.message)
  }

  try {
    const { buffer } = await renderDynamic(avItem)
    fs.writeFileSync(path.join(outDir, 'dynamic-av.png'), buffer)
    check('视频动态渲染', buffer.length > 1000, `${(buffer.length / 1024).toFixed(0)} KB`)
  } catch (err) {
    check('视频动态渲染', false, err.message)
  }

  try {
    const { buffer } = await renderDynamic(forwardItem)
    fs.writeFileSync(path.join(outDir, 'dynamic-forward.png'), buffer)
    check('转发动态渲染', buffer.length > 1000, `${(buffer.length / 1024).toFixed(0)} KB`)
  } catch (err) {
    check('转发动态渲染', false, err.message)
  }

  try {
    const { buffer } = await renderLive(live)
    fs.writeFileSync(path.join(outDir, 'live.png'), buffer)
    check('直播卡片渲染', buffer.length > 1000, `${(buffer.length / 1024).toFixed(0)} KB`)
  } catch (err) {
    check('直播卡片渲染', false, err.message)
  }

  console.log(failed === 0 ? '\n全部通过 ✔' : `\n${failed} 项失败 ✘`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
