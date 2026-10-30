#!/usr/bin/env python3
"""
TVBox 站点通路与封锁分级探测（stdlib only，无第三方依赖）

用法:
    python3 probe_site.py <url> [--proxy http://127.0.0.1:7890] [--timeout 12] [--json]

输出封锁分级:
    OK                 无防护，爬虫可直连
    GFW_BLOCKED        直连超时/DNS 异常（国内访问海外站常见），必须走海外代理
    CF_JS_CHALLENGE    Cloudflare JS 挑战，cloudscraper 通常可解
    CF_MANAGED         Cloudflare 托管挑战，cloudscraper 无效，需 stealth 浏览器
    IP_BANNED          "Sorry, you have been blocked"，换 IP
    SITE_DOWN          连接被拒/404/5xx 且无 CF 特征，站点下线或路径错
"""

import argparse
import json
import re
import socket
import ssl
import sys
import urllib.error
import urllib.request

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

CHALLENGE_MARKERS = ("Just a moment", "cf_chl_opt", "challenges.cloudflare.com",
                     "Attention Required", "請稍候")
BAN_MARKERS = ("you have been blocked", "cf-error-diagnosis", "Access denied")


def resolve(host):
    """返回本地解析的 IP 列表（不判断污染，只报告）。"""
    try:
        infos = socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)
        return sorted({i[4][0] for i in infos})
    except Exception as e:
        return ["<解析失败: %s>" % e]


def classify(status, headers, body):
    body_head = body[:60000] if body else ""
    # 特征串优先于状态码：CF 的封禁页/挑战页也返回 403/503
    if any(m in body_head for m in BAN_MARKERS):
        return "IP_BANNED"
    if re.search(r"cType:\s*'managed'", body_head):
        return "CF_MANAGED"
    if any(m in body_head for m in CHALLENGE_MARKERS):
        return "CF_JS_CHALLENGE"
    return "OK" if status == 200 else "SITE_DOWN"


def probe(url, proxy=None, timeout=12):
    from urllib.parse import urlparse
    host = urlparse(url).hostname or ""
    result = {"url": url, "host": host, "dns": resolve(host)}

    handlers = []
    if proxy:
        handlers.append(urllib.request.ProxyHandler({"http": proxy, "https": proxy}))
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    handlers.append(urllib.request.HTTPSHandler(context=ctx))
    opener = urllib.request.build_opener(*handlers)

    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
    })
    try:
        resp = opener.open(req, timeout=timeout)
        body = resp.read(400000).decode("utf-8", "replace")
        result.update(status=resp.status, headers=dict(resp.headers),
                      body_size=len(body), verdict=classify(resp.status, resp.headers, body))
    except urllib.error.HTTPError as e:
        body = e.read(200000).decode("utf-8", "replace") if e.fp else ""
        result.update(status=e.code, headers=dict(e.headers or {}),
                      body_size=len(body), verdict=classify(e.code, e.headers or {}, body))
    except (socket.timeout, TimeoutError):
        result.update(status=0, verdict="GFW_BLOCKED", note="连接超时")
    except urllib.error.URLError as e:
        reason = str(e.reason)
        verdict = "GFW_BLOCKED" if ("timed out" in reason or "timeout" in reason.lower()) else "SITE_DOWN"
        result.update(status=0, verdict=verdict, note=reason)
    except Exception as e:
        result.update(status=0, verdict="SITE_DOWN", note=str(e))

    h = result.get("headers", {})
    result["server"] = h.get("server", h.get("Server", ""))
    result["cf_mitigated"] = h.get("cf-mitigated", h.get("Cf-Mitigated", ""))
    return result


ADVICE = {
    "OK": "无防护。爬虫直连，HEADERS 带 UA/Referer 即可。",
    "GFW_BLOCKED": "GFW 封锁。抓取基建必须放海外（VPS 跑 proxy，爬虫 PROXY 常量指向它）；手机端访问不到本机 proxy。",
    "CF_JS_CHALLENGE": "Cloudflare JS 挑战。cloudscraper 通常可解；自建 proxy 时优先试它。",
    "CF_MANAGED": "Cloudflare 托管挑战。cloudscraper/无头浏览器均无效；需 stealth 浏览器（patchright 等）或 FlareSolverr；同时评估直连站点的数据 API 绕过 HTML 挑战。",
    "IP_BANNED": "IP 被封禁。更换出口 IP（代理节点/VPS）。",
    "SITE_DOWN": "站点不可达或路径错误。确认域名与路径，或站点已下线。",
}


def main():
    ap = argparse.ArgumentParser(description="TVBox 站点通路与封锁分级探测")
    ap.add_argument("url")
    ap.add_argument("--proxy", default=None, help="如 http://127.0.0.1:7890")
    ap.add_argument("--timeout", type=int, default=12)
    ap.add_argument("--json", action="store_true", help="输出 JSON")
    args = ap.parse_args()

    r = probe(args.url, proxy=args.proxy, timeout=args.timeout)
    if args.json:
        r.pop("headers", None)
        print(json.dumps(r, ensure_ascii=False, indent=2))
        return

    print("URL:    %s" % r["url"])
    print("DNS:    %s" % ", ".join(r.get("dns", [])))
    print("状态:   %s" % r.get("status", "-"))
    print("Server: %s%s" % (r.get("server") or "-",
          "  cf-mitigated=%s" % r["cf_mitigated"] if r.get("cf_mitigated") else ""))
    print("大小:   %s bytes" % r.get("body_size", 0))
    if r.get("note"):
        print("备注:   %s" % r["note"])
    print("结论:   %s" % r["verdict"])
    print("建议:   %s" % ADVICE.get(r["verdict"], ""))


if __name__ == "__main__":
    sys.exit(main())
