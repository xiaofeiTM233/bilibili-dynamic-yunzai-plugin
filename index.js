/**
 * bilibili-dynamic-yunzai-plugin
 *
 * 云崽 Yunzai-Bot V3 的 B 站动态/直播订阅推送插件。
 * 绘图基于 bilibili-dynamic-canvaskit（Skia/CanvasKit），
 * 功能参考 bilibili-dynamic-mirai-plugin 实现。
 */
import BiliSubscribe from './apps/bili-sub.js'
import BiliQuery from './apps/bili-query.js'
import BiliManage from './apps/bili-manage.js'

export default {
  BiliSubscribe,
  BiliQuery,
  BiliManage,
}
