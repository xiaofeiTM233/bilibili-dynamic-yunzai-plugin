# bilibili-dynamic-yunzai-plugin

用于云崽机器人 [Yunzai-Bot V3](https://github.com/le.nianyu/YunZai-Bot)（兼容 [Miao-Yunzai](https://github.com/yoimiya-kokomi/Miao-Yunzai) / [TRSS-Yunzai](https://github.com/TimeRainStarSky/Yunzai)）的 **B 站动态订阅推送插件**。

- 🎨 **绘图**：基于 [bilibili-dynamic-canvaskit](https://github.com/xiaofeiTM233/bilibili-dynamic-canvaskit)（Skia 官方 CanvasKit WASM 引擎），与 [bilibili-dynamic-mirai-plugin](https://github.com/Colter23/bilibili-dynamic-mirai-plugin) v3 绘图层逐行对齐，纯 CPU 毫秒级出图
- ⚡ **低延迟检测**：一个检测周期通过「账号全部最新动态」接口覆盖所有订阅，最低 10s 间隔
- 📺 全类型动态：九宫格 / 视频 / 专栏 / 音乐 / 番剧 / 合集 / 转发嵌套 / 专属动态 / 附加卡片 / 直播开播与结束通知
- 🔐 扫码登录（B 站小号）、自动关注、关注分组
- 🗂 类型 / 正则过滤器（黑 / 白名单）、@全体、按目标模板、按 UP 主题色

> 本插件是 `bilibili-dynamic-mirai-plugin`（Kotlin + skiko）功能的 Node.js 移植，绘图引擎为其官方移植版 canvaskit。

## 安装

将本目录（或 `git clone`）放到云崽的 `plugins/` 下：

```
YunZai-Bot/
├── plugins/
│   └── bilibili-dynamic/    # 本插件（指令与渲染代码、配置）
└── data/
    └── bilibili-dynamic/    # 运行时数据（自动创建）
        ├── bili_data.json   # 订阅 / 过滤器 / 模板 / cookie 等数据
        ├── cache/           # 推送图片缓存
        └── font/            # 绘图字体
```

安装依赖（TRSS-Yunzai 会自动安装；其他版本手动执行）：

```bash
cd plugins/bilibili-dynamic
npm install   # 或 pnpm install
```

依赖：`bilibili-dynamic-canvaskit`（动态卡片渲染库）、`canvaskit-wasm`（Skia 引擎）、`@resvg/resvg-js`（SVG 图标）、`qrcode`（登录二维码）。需要 Node.js ≥ 18。

## 使用

1. **登录**：机器人主人发送 `#bili登录`，用 B 站 App 扫码。**强烈推荐使用小号**（插件会自动关注订阅的 UP 主，便于通过「关注动态流」一次拉取全部订阅更新）
2. **订阅**：`#bili订阅 487550002`（支持 UID 或已订阅用户的名称模糊匹配，后跟群号可为其他群订阅，仅限主人）
3. 之后该 UP 的动态 / 直播开播 / 下播会自动推送到订阅的群或好友

## 指令

| 指令 | 说明 |
| --- | --- |
| `#bili帮助` | 指令帮助 |
| `#bili订阅 <UID/用户名> [群号]` | 添加订阅 |
| `#bili取订 <UID/用户名> [群号]` | 取消订阅 |
| `#bili删除全部订阅 [群号]` | 清空目标订阅（群管理/主人） |
| `#bili订阅列表 [群号]` | 查看订阅列表 |
| `#bili追番 <ss/md/ep+ID> [群号]` | 订阅番剧，如 `#bili追番 ss12345` |
| `#bili弃番 <ss/md+ID> [群号]` | 取消追番 |
| `#bili动态 <UID> [数量]` | 查看最新动态（最多 5 条） |
| `#bili视频 <UID>` | 查看最新视频 |
| `#bili动态详情 <动态ID>` | 查看指定动态 |
| `#bili查找用户 <关键词>` | 搜索 B 站用户 |
| `#bili颜色 <UID> <#hex>` | 设置该 UP 推送卡片主题色（多色 `#a;#b` 自定义渐变） |
| `#bili模板 <d/l/c> <模板名>` | 设置推送模板（d 动态 / l 直播 / c 下播） |
| `#biliat全体 <类型> [UID]` | 设置 @全体（群管理/主人） |
| `#bili取消at全体 <类型> [UID]` | 取消 @全体 |
| `#biliat全体列表 [UID]` | 查看 @全体设置 |
| `#bili类型过滤 <类型> [UID]` | 类型过滤器 |
| `#bili正则过滤 <正则> [UID]` | 内容正则过滤器（含空格用引号包裹） |
| `#bili过滤模式 <t/r> <w/b> [UID]` | 黑/白名单切换 |
| `#bili过滤列表 [UID]` / `#bili过滤删除 <索引> [UID]` | 过滤器查看/删除 |
| `#bili登录` | 扫码登录（主人） |
| `#bili全部订阅` / `#bili用户列表 [UID]` | 管理查询（主人） |
| `#bili状态` | 插件运行状态（主人） |

过滤类型：`动态 / 转发动态 / 视频 / 音乐 / 专栏 / 直播`；@全体类型：`全部 / 全部动态 / 视频 / 音乐 / 专栏 / 直播`。
过滤器 uid 填 `0` 或不填表示该目标订阅的所有用户。

## 配置

配置文件：`config/config.json`（首次可直接从 `config/default_config.json` 复制修改，未配置项使用默认值）。

| 配置项 | 默认 | 说明 |
| --- | --- | --- |
| `interval` | `15` | 动态检测间隔（秒，最低 10） |
| `liveInterval` | `20` | 直播检测间隔（秒） |
| `lowSpeed` | `0-0x2` | 低频检测，如 `3-8x2` 表示 3 点到 8 点间隔 ×2 |
| `drawEnable` | `true` | 绘图开关 |
| `quality` | `1000w` | 图片分辨率：`800w / 1000w / 1200w / 1500w` |
| `theme` | `v3` | 主题：`v3 / v3RainbowOutline / v2` |
| `defaultColor` | `#d3edfa` | 默认主题色，支持 `#a;#b` 多色渐变 |
| `cardOrnament` | `FanCard` | 卡片装饰：`FanCard / QrCode / None` |
| `downloadOriginal` | `true` | 是否下载原图 |
| `badgeEnable` | `{left:true,right:false}` | 卡片顶部角标开关 |
| `colorGenerator` | — | 单色时自动渐变的 HSB 参数 |
| `template.dynamic/live/liveClose` | `OneMsg` 等 | 默认推送模板 |
| `dynamicTemplates` 等 | — | 模板定义（支持自定义新增） |
| `atAllPlus` | `PLUS_END` | @全体拼接：`PLUS_END` / `SINGLE_MESSAGE` |
| `pushInterval` / `messageInterval` | `500 / 100` | 推送节流（毫秒） |
| `autoFollow` | `true` | 订阅时是否自动关注（需登录账号） |
| `followGroup` | `Bot关注` | 自动关注保存的 B 站关注分组 |
| `liveCloseNotify` | `true` | 下播通知开关 |
| `cacheClearDays` | `7` | 缓存图片保留天数（0 不清理，每天 4 点清理） |
| `font` | 空 | 字体文件名（放 `resources/font/` 下） |
| `timeout` | `10` | API 超时（秒） |
| `admin` | 空 | 管理员 QQ（空则使用云崽主人） |
| `proxy` | 空 | HTTP 代理 |

### 模板变量

动态：`{draw}` 绘制图、`{name}`、`{uid}`、`{did}`、`{type}`、`{time}`、`{content}`、`{images}` 图片、`{link}`、`{links}` 全部链接；
直播：`{draw}`、`{rid}`、`{title}`、`{area}`、`{cover}`；下播：`{startTime}`、`{endTime}`、`{duration}`。
`\r` 分割多条消息；`{>>}...{<<}` 包装成转发消息。

## 字体

首次渲染时若 `<云崽根>/data/bilibili-dynamic/font/` 为空，会自动下载 **霞鹜文楷 Bold**（GitHub Release，失败时回退系统黑体）。
也可手动下载 [LXGW WenKai Bold](https://github.com/lxgw/LxgwWenKai/releases) 或 [HarmonyOS Sans SC Medium](https://developer.harmonyos.com/cn/docs/design/des-resources/general-0000001157315901) 放入该目录。
Emoji 默认走 twemoji CDN；离线环境可配置 `emojiFont` 指向 Noto Color Emoji 字体文件。

> 旧版本把数据存放在插件目录内（`plugins/bilibili-dynamic/data|resources`），新版启动时会自动迁移到云崽的 `data/bilibili-dynamic/`。

## 目录结构

```
bilibili-dynamic/
├── index.js                 # 插件入口
├── apps/                    # 云崽指令层
│   ├── bili-sub.js          # 订阅 / 追番 / 列表
│   ├── bili-query.js        # 查询 / 登录 / 状态
│   └── bili-manage.js       # 颜色 / 模板 / @全体 / 过滤器
├── model/                   # 业务层
│   ├── Api.js               # B 站 API（WBI 签名 / buvid3 / 登录）
│   ├── Dynamic.js           # 动态数据装配
│   ├── Render.js            # canvaskit 渲染封装（字体 / 主题 / 缓存）
│   ├── Push.js              # 检测循环 / 过滤 / 模板 / 推送
│   ├── Data.js              # 订阅数据操作
│   ├── Config.js            # 配置与持久化
│   └── Utils.js             # 工具
├── config/                  # 配置（default_config.json 为默认值；config.json 为用户配置）
├── data/                    # 独立运行（开发/测试）时的数据回退目录
└── test/                    # 测试脚本
```

运行时数据（订阅 bili_data.json / 图片缓存 cache/ / 字体 font/）存放在云崽根目录的
`data/bilibili-dynamic/` 下；仅在插件脱离云崽独立运行时回退到插件目录内的 `data/`。

## 测试

```bash
npm test            # 渲染管线 + 模板构建（离线，输出 test/output/*.png）
node test/load-test.js   # 模块加载（桩替换 Yunzai 基类）
node test/real-api-test.js <动态ID>   # 真实 API 端到端（需网络）
```

## 已知差异 / 说明

- 番剧动态按 `season_id` 匹配订阅（原插件按作者 mid 匹配，存在误配风险）
- 转发消息卡片外观由协议端决定，不可配置（原插件的 forwardCard 模板不适用）
- 未登录时 B 站部分接口有风控（-352），登录后正常
- 需要已登录 B 站账号才能拉取「关注动态流」实现低延迟全量检测；因此订阅时会按 `autoFollow` 自动关注

## 📚 说明

本 README 文档由 AI 辅助生成。如有问题，请提交 Issue 或[与我联系](https://github.com/xiaofeiTM233)！
