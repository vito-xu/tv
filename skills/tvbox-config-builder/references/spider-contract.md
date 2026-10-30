# Spider 契约与配置字段速查

> FongMi/TV（及 TVBoxOSC 等兼容实现）的 type=3 爬虫契约。完整官方文档见 TV 仓库 `docs/SPIDER.md` / `docs/CONFIG.md`。

## 1. 爬虫类型（site.type）

| type | api 格式 | 引擎 | 说明 |
|---|---|---|---|
| 0 | HTTP URL | 内置 XML | GET 请求，`ac=videolist`，回传 XML |
| 1 | HTTP URL | 内置 JSON | GET 请求，回传 JSON，Filter 用 `f=` 传（苹果CMS 标准） |
| 3 | `csp_ClassName` / `xxx.js` / `xxx.py` | JAR（DexClassLoader）/ QuickJS / Chaquopy | 爬虫直接呼叫 |
| 4 | HTTP URL | 内置 JSON+Base64 | 同 1，ext 以 Base64 传递 |

**优先 type=1**（苹果CMS 站点零代码接入）；只有 API 不存在或反爬复杂时才写 type=3。

## 2. JS 爬虫运行时约束（QuickJS）

- 模块格式：`export default spider;`（ES module）
- 网络：`globalThis._http(url, { headers, timeout })` —— **同步阻塞**，返回 `{ok, status, url, content}`（不同实现字段略有差异，取 `content` 判空最稳）
- **无 DOM/BOM**：不能 document.querySelector，只能正则/字符串处理
- 无 `fetch`/`XMLHttpRequest`/`Promise` 依赖（同步模型）
- 字符串方法可用；`JSON.parse/stringify` 可用
- 谨慎使用 ES2020+ 语法（QuickJS 版本随 APK 而定，模板只用 ES2017 安全集）

## 3. Spider 方法签名与返回

所有方法返回 **JSON 字符串**（`proxy` 除外，返回 `Object[]`）。

| JS 方法 | 触发时机 | 返回要点 |
|---|---|---|
| `init()` | 实例创建后一次 | 可空；`ext` 参数经 site.ext 传入 |
| `home()` | 进首页 | `{class:[{type_id,type_name}]}`，可选 `filters` |
| `homeVod()` | 首页推荐 | `{list:[Vod]}` |
| `category(tid,pg)` | 点分类/翻页 | `{page,pagecount,limit,total,list:[Vod]}` |
| `detail(id)` | 点影片卡片 | `{list:[Vod]}`，Vod 含 `vod_play_from`+`vod_play_url` |
| `search(key)` | 搜索 | `{list:[Vod]}` |
| `play(flag,id)` | 选集数播放 | `{parse:0,url,header}` |
| `live()` | 直播源 | 频列原始文本（TXT/M3U/JSON） |
| `sniffer()` | 嗅探开关 | 布尔 |
| `isVideo(url)` | 格式判断 | 布尔，`/\.(mp4\|m3u8)(\?\|\$)/i` |
| `proxy()` | 本地代理 | `[404,'text/plain','']` 或实际响应 |
| `action()` | 自定义动作 | 可空 |
| `destroy()` | 配置重载 | 清理 |

## 4. Vod 对象字段（按重要性）

| 字段 | 必填 | 说明 |
|---|---|---|
| `vod_id` | ✅ | 唯一键，回传 `detail(ids)`。**用完整绝对 URL**，相对路径会拼错 base |
| `vod_name` | ✅ | 显示名（支持 HTML 实体） |
| `vod_pic` | ✅ | 缩略图 URL |
| `vod_remarks` | | 角标（"HD"、"更新至12集"） |
| `vod_content` | | 简介 |
| `vod_play_from` | 详情必填 | 线路名，多线路 `$$$` 分隔 |
| `vod_play_url` | 详情必填 | 见下 |

## 5. 播放串格式（最容易错）

```
线路名$URL#集名$URL#集名$URL$$$线路名2$URL
```

- `$$$` 分隔多线路；`#` 分隔同线路多集；`$` 分隔名称与 URL
- **集数名/线路名不能含 `$` 或 `#`**（先 replace 掉）
- 无多集时：`正片$https://...m3u8`
- `play(flag,id)` 的 `id` 即某集的 URL 部分

## 6. play() 返回字段

| 字段 | 说明 |
|---|---|
| `parse` | `0`=直接播（直链时必须）；`1`=送解析器 |
| `url` | 媒体 URL 或待解析页面 URL |
| `header` | 播放请求头。防盗链站必须带对 `Referer`+`User-Agent`；**Origin 慎用**（部分 CDN 校验 Origin 会 403） |
| `format` | 指定 MIME（如 `application/x-mpegURL`）跳过嗅探 |
| `subs`/`danmaku`/`drm` | 字幕/弹幕/DRM |

## 7. site 配置字段

| 字段 | 说明 |
|---|---|
| `key` | 全局唯一 |
| `type` | 见上表 |
| `api` | URL 或 `./js/x.js`（相对路径） |
| `ext` | 传入 `init()` 的扩展串 |
| `jar` | 覆盖全局 spider jar |
| `searchable`/`quickSearch` | 搜索开关；quickSearch 要求 search <3s |
| `filterable` | 筛选开关（需 filters 定义） |
| `style` | `{type:"rect",ratio:1.33}`；横版缩略图 ratio 1.33~1.78，直式海报省略 |
| `header` | 该站点附加请求头 |
| `timeout` | 覆盖默认超时 |

## 8. 相对路径解析规则（部署关键）

`api`/`jar`/`ext` 的相对路径相对 **config 文件自身的 URL** 解析：

```
config: https://raw.githubusercontent.com/u/r/main/config.json
api:    ./js/xxx.js
实际:   https://raw.githubusercontent.com/u/r/main/js/xxx.js
```

推论：js 爬虫文件必须与 config.json 同仓库、保持相对位置；改目录结构会连带改 config 内路径。

## 9. 高级能力（按需）

- `proxy://?do=js` 本地代理 URL：播放 URL 可指向 App 内嵌 NanoHTTPD（9978 起），由 `proxy()` 方法中转（用于加签/换 header）
- `vod_tag:"folder"`：文件夹型分类（点进去再调 category）
- `rules`（嗅探正则）/`headers`（注入响应头）/`hosts`（DNS 覆盖）/`ads`（拦截域名）/`doh`/`proxy`（网络层配置，见 CONFIG.md）
