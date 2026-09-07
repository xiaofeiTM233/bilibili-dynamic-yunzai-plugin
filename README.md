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
    └── bilibili-dynamic/    # 运行时数据
        ├── BiliConfig.yml   # 插件配置
        ├── BiliData.yml      # 订阅 / 过滤器 / 模板 / 分组等数据
        ├── ImageQuality.yml  # 图片分辨率
        ├── ImageTheme.yml    # 图片主题
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

指令统一使用 `#bili` 前缀，同时兼容 mirai 插件的英文子命令写法（`#bili add 646195980` 等价于 `#bili订阅 646195980`）。

| 指令 | 说明 |
| --- | --- |
| `#bili帮助` | 指令帮助 |
| `#bili订阅/add <UID/用户名> [群号]` | 添加订阅 |
| `#bili取订/del <UID/用户名> [群号]` | 取消订阅 |
| `#bili删除全部订阅/delAll [群号]` | 清空目标订阅（群管理/主人） |
| `#bili订阅列表/list [群号]` | 查看订阅列表 |
| `#bili全部订阅/listAll` | 全部订阅列表（主人） |
| `#bili用户列表/listUser [UID]` | 查看订阅目标（主人） |
| `#bili追番 <ss/md/ep+ID> [群号]` | 订阅番剧，如 `#bili追番 ss12345` |
| `#bili弃番 <ss/md+ID> [群号]` | 取消追番 |
| `#bili动态/new <UID> [数量]` | 查看最新动态 |
| `#bili视频/video <UID>` | 查看最新视频 |
| `#bili动态详情/search/s <动态ID>` | 查看指定动态 |
| `#bili直播/live` | 随机推荐直播间卡片 |
| `#bili查找用户 <关键词>` | 搜索 B 站用户 |
| `#bili颜色/color <UID> <#hex>` | 设置该 UP 推送卡片主题色（多色 `#a;#b` 自定义渐变） |
| `#bili模板/t <d/l/c/le> <模板名>` | 设置推送模板（d 动态 / l 直播 / c 或 le 下播） |
| `#bili模板列表/tl [类型]` | 查看模板变量 |
| `#bili配置/config [UID] [群号]` | 交互式配置（At全体/主题色/模板/过滤器） |
| `#biliat全体/aa <类型> [UID]` | 设置 @全体（群管理/主人） |
| `#bili取消at全体/daa <类型> [UID]` | 取消 @全体 |
| `#biliat全体列表/laa [UID]` | 查看 @全体设置 |
| `#bili类型过滤/ft <类型> [UID]` | 类型过滤器 |
| `#bili正则过滤/fr <正则> [UID]` | 内容正则过滤器（含空格用引号包裹） |
| `#bili过滤模式/fm <t/r> <w/b> [UID]` | 黑/白名单切换 |
| `#bili过滤列表/fl [UID]` / `#bili过滤删除/fd <索引> [UID]` | 过滤器查看/删除 |
| `#bili创建分组/create <分组名>` | 创建推送分组 |
| `#bili分组列表/lg [分组名]` | 分组列表/详情 |
| `#bili删除分组/dg <分组名>` | 删除分组 |
| `#bili添加分组/push <分组名> <目标>` | 向分组添加推送目标（`群号` 或 `f<QQ>`，逗号分隔） |
| `#bili ban <分组名> <目标>` | 从分组移除推送目标 |
| `#bili添加分组管理员/aga <分组名> <QQ>` | 设置分组管理员 |
| `#bili删除分组管理员/bga <分组名> <QQ>` | 移除分组管理员 |
| `#bili登录/login` | 扫码登录（主人） |
| `#bili重载/reload` | 重载配置（主人） |
| `#bili清理失效订阅/clear` | 清理失效群/好友的订阅（主人） |
| `#bili状态` | 插件运行状态（主人） |

## 链接/卡片解析（当前已停用）

群聊中出现 B 站链接（BV/av/cv/动态/opus/直播间/空间/ss·ep·md/`b23.tv` 短链）或 QQ 分享卡片时，自动绘制对应卡片图回复（与 mirai 插件的 ListenerTasker 行为一致）。

配置项（`BiliConfig.yml`）：

| 配置项 | 默认 | 说明 |
| --- | --- | --- |
| `linkResolve.triggerMode` | `At` | 触发模式：`At`（@机器人时）/ `Always` / `Never` |
| `linkResolve.returnLink` | `false` | 回复图片时是否附加原始链接 |
| `linkResolve.regex` | （内置） | 入口正则门禁，命中后才逐类型解析 |
| `showLoadingMessage` | `true` | 解析/查询时是否发送「加载中...」提示 |

过滤类型：`动态 / 转发动态 / 视频 / 音乐 / 专栏 / 直播`；@全体类型：`全部 / 全部动态 / 视频 / 音乐 / 专栏 / 直播`。
过滤器 uid 填 `0` 或不填表示该目标订阅的所有用户。

## 配置

配置文件为云崽 `data/bilibili-dynamic/` 下的 4 个 YAML 文件，**与 mirai 版插件完全通用**：把 mirai 的 `BiliData.yml`、`BiliConfig.yml`、`ImageQuality.yml`、`ImageTheme.yml` 直接复制进来即可使用。文件缺失时首启会自动从插件自带的 `config/*.default.yml` 复制补齐。

主要配置项：

| 配置项 | 默认 | 说明 |
| --- | --- | --- |
| `admin` | `0` | 管理员 QQ（0 则使用云崽主人） |
| `checkConfig.interval / liveInterval` | `15 / 20` | 动态/直播检测间隔（秒） |
| `checkConfig.lowSpeed` | `0-0x2` | 低频检测，如 `3-8x2` 表示 3 点到 8 点间隔 ×2 |
| `checkConfig.timeout` | `10` | API 超时（秒） |
| `enableConfig.drawEnable` | `true` | 绘图开关 |
| `enableConfig.notifyEnable` | `true` | 操作通知开关 |
| `enableConfig.liveCloseNotifyEnable` | `true` | 下播通知开关 |
| `accountConfig.cookie` | 空 | B 站 cookie（`#bili登录` 也可写入） |
| `accountConfig.autoFollow / followGroup` | `true / Bot关注` | 订阅时自动关注及分组 |
| `imageConfig.quality / theme` | `1000w / v3` | 图片分辨率与主题（被 ImageQuality/ImageTheme 的 customOverload 覆盖） |
| `imageConfig.font / defaultColor / cardOrnament / colorGenerator / badgeEnable` | — | 绘图相关 |
| `templateConfig.defaultDynamicPush / defaultLivePush / defaultLiveClose` | `OneMsg` 等 | 默认推送模板 |
| `templateConfig.dynamicPush / livePush / liveClose` | — | 模板定义（支持自定义新增） |
| `pushConfig.pushInterval / messageInterval / atAllPlus` | `500 / 100 / PLUS_END` | 推送节流与 @全体拼接 |
| `cacheConfig.downloadOriginal / expires.*` | `true / 7` | 原图下载与缓存保留天数（每天 4 点清理） |
| `linkResolveConfig.triggerMode / returnLink` | `At / false` | 链接解析触发模式（功能当前停用） |

`ImageQuality.yml` / `ImageTheme.yml` 与 mirai 完全同构：开启 `customOverload` 后，`customQuality` / `customTheme` 将覆盖 `BiliConfig.imageConfig` 中对应的 quality / theme。

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
│   ├── bili-manage.js       # 颜色 / 模板 / @全体 / 过滤器
│   ├── bili-admin.js        # 直播 / 重载 / 清理 / 分组 / 交互配置
│   └── bili-listener.js     # 群聊链接/分享卡片自动解析
├── model/                   # 业务层
│   ├── Api.js               # B 站 API（WBI 签名 / buvid3 / 登录）
│   ├── Dynamic.js           # 动态数据装配
│   ├── Render.js            # canvaskit 渲染封装（字体 / 主题 / 缓存）
│   ├── Push.js              # 检测循环 / 过滤 / 模板 / 推送
│   ├── ResolveLink.js       # 链接解析（对应 ResolveLinkService）
│   ├── Data.js              # 订阅数据操作
│   ├── Config.js            # 配置与持久化
│   ├── helpers.js           # 指令层公共辅助
│   └── Utils.js             # 工具
├── data/                    # 独立运行（开发/测试）时的数据回退目录
└── test/                    # 测试脚本
```

> 插件入口基于 `import.meta.url` 定位 `apps/` 目录并动态加载其中的插件类，新增指令文件放到 `apps/` 下即可自动加载，无需修改入口；`apps/` 下的普通函数导出会被自动跳过。

运行时数据（BiliConfig.yml / BiliData.yml / ImageQuality.yml / ImageTheme.yml / 图片缓存 cache/ / 字体 font/）存放在云崽根目录的
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
- 需要已登录 B 站账号才能拉取「关注动态流」实现低延迟全量检测：bot 账号未关注的 UP 无法被检测。订阅未关注的 UP 时按 `autoFollow` 配置决定是否自动关注；关闭 `autoFollow` 时该订阅会失败，需先手动用 bot 账号关注

## 📚 说明

本 README 文档由 AI 辅助生成。如有问题，请提交 Issue 或[与我联系](https://github.com/xiaofeiTM233)！
