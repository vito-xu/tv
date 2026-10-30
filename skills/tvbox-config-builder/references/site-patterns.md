# 站点数据模式库：识别 → 解析策略

> 八种常见模式，按优先级排列。分析时从上往下匹配，命中即用对应策略。案例来自真实项目（FongMi/TV fork 的 bad.news / hanime1 / missav / koolearn 爬虫）。

## 模式 1：苹果CMS 开放 API（type=1，零代码）

**识别**：`GET /api.php/provide/vod/?ac=list&pg=1` 返回 JSON；网页搜 `var maccms`；URL 多横杠 `/show/1-----------.html`。

**接入**：config 里 `type:1, api:"https://域名/api.php/provide/vod/"`。搜索 `?ac=detail&wd=关键词`，分类 `?ac=detail&t=ID&pg=N`。

**注意**：ewave 模板与 module 模板的选择器不同，但 API 通用——先试 API 再考虑任何爬虫。

## 模式 2：SSR HTML 卡片（正则解析）

**识别**：curl 直接拿到的列表页 HTML 就含完整卡片（标题+图+链接）。

**解析策略**：
- 定位卡片容器（`<article>`、`div.horizontal-card`、`div.video-item-container` 等），提取 `href` / 图片属性（`data-src`/`data-echo`/`src`）/ 标题（`alt`/子 div）
- **第一屏常混广告卡片**（如 Erolabs 赞助位链接到外域）：先按链接域名甄别，非本站域名的丢弃
- 站点常有 2~3 套卡片结构（桌面/移动/搜索页各一套）：写多套正则，结果合并去重（按 vod_id）
- 分页：`?page=N` 或 `/page-N`；pagecount 从分页控件解析最大页码，解析不到给 1

**案例**：bad.news（`<article>` 块 + `data-echo` 图 + `a.title`）、hanime1（`horizontal-card` + `watch?v=` 锚文本 + `home-rows-videos-div` 备选结构）。

## 模式 3：客户端渲染 + JSON API（API 优先）

**识别**：`domcontentloaded` 与 `networkidle` 的 HTML 长度差异大；HTML 里有 Alpine.js（`x-data`）/ React / Vue 空壳；XHR 拦截看到 recombee、`/api/`、graphql 请求。

**解析策略**：
1. Playwright 拦截 XHR/fetch，记录 URL、method、请求头（token/userId）
2. 能用固定 header 复现 → 爬虫直连 API（**最稳，首选**）；不能 → 退回模式 2 + 基建升级
3. 列表项从 API 响应的字段映射（`dvd_id`/`title`/封面 CDN 规则可自行拼装）

**案例**：missav.ws 列表由 Recombee 推荐 API 驱动，封面 CDN 为 fourhoi.com；这是它被 Cloudflare managed challenge 拦住后的正解。

## 模式 4：og meta（详情页第一提取点）

**识别**：详情页 `<meta property="og:title|og:image">`、`<meta name="description">`。

**策略**：先无脑拿这三个（标题/海报/简介），再找播放地址。几乎所有站都有，零成本。

## 模式 5：专用下载页/直链表格

**识别**：站点有 `/download?v=` 之类的页面，内含 `<table>` 或带 `download` 属性的 `<a>`。

**策略**：详情解析时**再发一次请求**拿下载页，正则抽 `href` + `download` 属性；清晰度从 URL 提取（`(\d{3,4}p)`）。 hanime1 的 720p/480p/1080p 三线路即来自此。

## 模式 6：自定义属性藏 URL

**识别**：详情页有 `data-source='...'`、`data-url` 等非标准属性。

**策略**：直接抽属性值。注意签名 URL 带 `expires`/`md5` 参数的不要长期缓存。bad.news 即此模式（`data-source` + `md5&expires` 签名）。

## 模式 7：eval packed JS（p,a,c,k,e,d）

**识别**：详情页含 `eval(function(p,a,c,k,e,e,d){...}('...',radix,count,'w1|w2|...'.split('|'),0,{}))`。

**策略**：用模板内置的修复版 unpacker（`decodeEval` + `packerKey`），然后从解码结果正则抽 `\.m3u8|\.mp4`。

**unpacker 三个坑（必须按模板写法）**：
1. radix > 36 时 `j.toString(radix)` 抛 RangeError → 用 base-N 自定义编码（0-9→a-z→A-Z）
2. 逐 key 循环替换有顺序依赖（先换的短 key 会破坏后换的长 key；替换值中含其他 key 文本会被二次替换）→ 单次正则，key 按长度降序构成交替
3. 取参时要数括号找 eval 结尾（encoded 字符串里可能含括号），别用 `indexOf('))')`

## 模式 8：JSONP 分页/数据

**识别**：响应形如 `callback({...})`；翻页参数 `page_num`、`callback=cb`。

**策略**：取内容首尾括号间 JSON.parse；HTML 片段型 JSONP（返回 HTML 字符串）直接当 HTML 喂 parseList。koolearn 的分类翻页即此模式（第一页 HTML，后续 JSONP）。

## 模式 9：签名 API 站（Next.js/自建后端 + 匿名 API + 请求签名）

**识别**：站点无 maccms、无开放 API；但 XHR 拦截发现 `/api/xxx/anonymous/...` 内部 JSON API；直接 curl 调 API 返回 `{"code":122012,"msg":"应用签名不可为空"}` 之类——说明有请求签名。

**逆向步骤**（按序）：
1. Playwright 拦截 **request**（不是 response）头，找签名相关头：常见为 `sign`（40位hex=SHA1 或 32位=MD5）、`t`（毫秒时间戳）、`deviceId`、`client-type`
2. 下载站点 JS bundle（首页 HTML 里 `/_next/static/chunks/*.js` 全量下拉），grep `signKey` / `sign:` / `deviceId` 定位签名函数
3. 常见算法形态：`sign = SHA1(MD5(排序参数&key=<硬编码signKey>&t=<时间戳>))`——signKey 硬编码在 JS 里（案例：`cb808529bae6b6be45ecfab29a4889bc`）
4. **用浏览器捕获的真实 sign 值复算验证**（拿 t 和参数拼串，本地算 SHA1(MD5(...)) 对比），至少两个样本（带参/不带参）都中方可相信
5. QuickJS 无 crypto： spider 内置纯 JS MD5+SHA1（约 120 行），**必须与 Node crypto 交叉验证**（含中文 UTF-8 用例；SHA1 长度字段是大端序、MD5 是小端序，写反必错）

**端点发现技巧**：grep JS 里 `anonymous/[a-zA-Z/]*` 拿全端点清单；播放端点常藏在 `v2/...` 路径下（案例：`v2/video/episode/url?id&nid`）。

**架构要点**：详情 API 的剧集 `playUrl` 常为 `null`，真实地址按 `id+nid` 单独端点现取。爬虫用**懒解析**：vod_play_url 里放 `/play/{id}/sid/{nid}` 页面地址，`play()` 里解析出 id+nid 再调 API——避免 N 集 N 次请求。

**案例**：0bv77aw.com（金牌影院，Next.js App Router，无 `__NEXT_DATA__`，RSC 流数据）。

**两个容易踩的认知坑**：
- **签名 ≠ 封锁**：签名站往往没有任何 CF（案例 0bv77aw 直连 200）——先 probe_site.py 探测再决定基建，别默认要代理。
- **Next.js App Router 没有 `__NEXT_DATA__`**（数据在 RSC 流 `self.__next_f.push` 里）——别浪费时间解析 RSC，直接用 analyze_page.js 拦 XHR 找背后的 API。

## 模式选择速查

```
有开放 JSON API? ──yes--> 模式1（type=1）或模式3（type:3 直连 API）
      │no
curl 列表页有数据? ──yes--> 模式2（SSR 正则）
      │no（客户端渲染）
XHR 有 JSON? ──yes--> 模式3
      │no --> 基建升级后重试模式2
详情页提取点: og meta(4) → 下载页(5) → data-source(6) → packed JS(7)
分页: query / path / JSONP(8)
```
