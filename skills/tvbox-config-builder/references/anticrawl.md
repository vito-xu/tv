# 封锁分级与抓取基建选型

## 1. 分级总表

| 级别 | 现象 | 探测特征 | 基建 |
|---|---|---|---|
| L0 无防护 | 直连 200 | 无 CF 头 | 爬虫直连，UA/Referer 即可 |
| L1 GFW | 直连超时 | 连接超时；DNS 解析结果异常 | 海外代理（VPS）。**基建必须放海外**，详见 §3 |
| L2 CF JS 挑战 | 403 + 挑战页 | `cf_chl_opt`、`Just a moment`、无 `cType:'managed'` | cloudscraper 通常可解 |
| L3 CF 托管挑战 | 403 + 挑战页 | `Cf-Mitigated: challenge` + `cType: 'managed'` | **cloudscraper 已无效**；stealth 浏览器（patchright 等）或 FlareSolverr；同时评估直连数据 API 绕过 HTML 挑战 |
| L4 IP 封禁 | 403 + 封禁页 | "Sorry, you have been blocked" | 换出口 IP |

## 2. 各级基建的实现方式

### L0/L1：代理
- 开发期：本机 Clash 等（`http://127.0.0.1:7890`），`probe_site.py --proxy`、`test_spider.js --proxy`、Playwright `proxy` 选项都支持
- 生产：爬虫内 `PROXY` 常量指向海外 VPS 上跑的转发服务（如 missav_proxy.py：cloudscraper + `/raw?url=` 透传 HTML）。**解析逻辑留在 JS 爬虫，基建只是 HTTP 通道**——换基建不动爬虫

### L2：cloudscraper
```python
scraper = cloudscraper.create_scraper(browser={'browser':'chrome','platform':'windows','desktop':True})
resp = scraper.get(url, headers={...}, proxies={'http':..., 'https':...}, timeout=30)
```
- 判定成功：`status==200` 且 body 不含 `Just a moment`/`cf_chl`/`Attention Required`
- 注意：cloudscraper 只解决 TLS 指纹 + 旧式 JS 挑战；对 managed challenge 无能为力（2024 年后大量站点升级）

### L3：stealth 浏览器 / FlareSolverr
- **stealth 浏览器**：patchright（playwright 的 stealth 分支，改进了 CDP 检测）或 playwright + `--disable-blink-features=AutomationControlled` + `navigator.webdriver` 抹除 + 真实 UA + 等待挑战自动完成（轮询 title，中英文挑战页都要判：`Just a moment` / `請稍候`）
- **FlareSolverr**：自托管挑战求解服务，HTTP 接口返回 clearance cookie + HTML；适合非 Python 技术栈
- **优先尝试绕开 HTML**：客户端渲染站点的数据 API（Recombee 等）通常不受 HTML 挑战保护——`assets/analyze_page.js` 的 XHR 拦截就是为这个目的

### L4：换 IP
代理节点/VPS 更换；住宅 IP 对高防护站点更有效但成本高。

## 3. GFW 部署现实（国内开发者必读）

- 目标站（missav/hanime1 类海外站）国内直连超时，**Clash 代理只在开发期有用**
- 手机上的 TVBox 访问不到你 Mac 上的本地 proxy → 生产链路必须是：海外 VPS 跑 proxy（cloudscraper/stealth 浏览器）→ JS 爬虫 `PROXY` 常量填 VPS 地址 → TVBox 经公网访问 VPS
- VPS 自身 IP 也可能被 CF 挑战（datacenter IP 信誉低）→ 多节点轮换或选声誉好的机房
- 签名播放 URL（`md5`+`expires`）的校验以**播放器出口 IP** 为准，proxy 只管详情页抓取的话不影响直链播放；若 CDN 绑定抓取 IP 则播放也要走 proxy（`proxy://?do=js`）

## 4. 检测清单（分析脚本已自动化）

`scripts/probe_site.py` 输出 verdict + 建议。手工 curl 判定要点：
```bash
# 看状态码 + server + cf-mitigated 头
curl -sI --max-time 10 -A '<浏览器UA>' https://目标/
# 403 时看 body：cType:'managed' = 托管挑战；cf_chl_opt 无 managed = JS 挑战；
# "you have been blocked" = IP 封禁
```

## 5. 反爬对抗的演进认知

- **不要对单一基建过度投资**：CF 挑战每季度升级（2024 年起 managed challenge 成为主流，cloudscraper 类工具链整体没落）。爬虫与基建分离的架构才能低成本换血
- **HTML 解析是最脆弱的一层**：站点改版频率远高于 API 变更。能接 API 就不解析 HTML
- **UA/Referer/Accept-Language 三件套**先带上再谈高级对抗，很多"被封"只是缺头
