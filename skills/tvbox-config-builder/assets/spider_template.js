/**
 * TVBox QuickJS 爬虫骨架模板
 * 用法: 拷贝到项目 js/ 目录改名，按 TODO 填空。
 * 内置: CF 挑战检测的 request()、修复版 decode()（HTML 实体）、
 *       修复版 decodeEval()+packerKey()（radix≤62、单次替换）。
 * 语法约束: 仅用 ES2017 安全集（不用 ?. / ??），适配旧版 QuickJS。
 * 真机调试: console.log 会打进 logcat（tag: quickjs），adb logcat -s quickjs 查看。
 */

// ==================== 配置区（按站点改） ====================
const HOST = 'https://example.com';           // TODO: 站点域名
const PROXY = '';                             // TODO: 留空=直连；填 'http://VPS:9876/' 走代理（注意末尾斜杠）
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
  'Referer': HOST + '/',
};

// TODO: 分类表 [type_id, type_name]；type_id 直接映射 URL 参数/路径
const CLASSES = [
  ['全部', '全部'],
  // ['分类2', '分类2'],
];

// ==================== 基础工具 ====================
function headers(referer) {
  const items = {};
  for (const key in HEADERS) items[key] = HEADERS[key];
  if (referer) items.Referer = referer;
  return items;
}

/**
 * 同步请求。PROXY 非空时经代理的 /raw?url= 透传；
 * 识别 CF 挑战页并返回空串（让上层按失败处理，不要把挑战页当数据）。
 */
function request(url, referer) {
  try {
    if (PROXY) {
      const proxyUrl = PROXY + 'raw?url=' + encodeURIComponent(url);
      const res = globalThis._http(proxyUrl, { headers: headers(referer), timeout: 30000 });
      if (res && res.content) return res.content;
    }
    const res = globalThis._http(url, { headers: headers(referer), timeout: 15000 });
    if (res && res.content) {
      const bad = ['Attention Required', 'Cloudflare', 'Just a moment', 'cf_chl', '請稍候'];
      for (const b of bad) {
        if (res.content.indexOf(b) !== -1) return '';
      }
      return res.content;
    }
  } catch (e) {}
  return '';
}

/** HTML 实体解码（实体名别丢，丢了就是 no-op） */
function decode(value) {
  return (value || '')
    .replace(/\\\//g, '/')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function text(value) {
  return decode(value).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function abs(url) {
  if (!url) return '';
  if (url.startsWith('//')) return 'https:' + url;
  if (url.startsWith('/')) return HOST + url;
  return url;
}

/** 播放集数名净化：不能含 $ 和 # */
function safeName(name, fallback, index) {
  const n = String(name || '').replace(/[$#]/g, ' ').replace(/\s+/g, ' ').trim();
  return n || (fallback + (index + 1));
}

// ==================== packer unpacker（修复版） ====================
/**
 * packer 的 key 编码，与 eval 内 e=function(c){...} 等价：
 * (c<a?'':e(parseInt(c/a)))+((c=c%a)>35?String.fromCharCode(c+29):c.toString(36))
 * 即 0-9 → a-z → A-Z 顺序，radix 可到 62+。
 * 直接 j.toString(radix) 在 radix>36 时会抛 RangeError。
 */
function packerKey(j, radix) {
  if (radix <= 36) return j.toString(radix);
  return (j < radix ? '' : packerKey(Math.floor(j / radix), radix)) +
    ((j % radix) > 35 ? String.fromCharCode((j % radix) + 29) : (j % radix).toString(36));
}

/**
 * 解码 eval(function(p,a,c,k,e,d){...}('...',radix,count,'w1|w2|...'.split('|'),0,{}))
 * 注意: 数括号定位 eval 结尾，不用 indexOf('))')。
 */
function decodeEval(html) {
  if (!html) return '';
  const evalIdx = html.indexOf('eval(function(p,a,c,k,e,d)');
  if (evalIdx === -1) return '';

  let depth = 0;
  let end = evalIdx;
  for (let i = evalIdx; i < html.length; i++) {
    if (html[i] === '(') depth++;
    else if (html[i] === ')') {
      depth--;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  const evalStr = html.substring(evalIdx, end);

  const argsStart = evalStr.indexOf('return p}(') + 'return p}('.length;
  const args = evalStr.substring(argsStart, evalStr.length - 2); // 去掉结尾 ))

  // 逐个解析参数: 'encoded', radix, count, 'words'.split('|'), 0, {}
  let i = 0;
  const skipSep = () => { while (i < args.length && (args[i] === ' ' || args[i] === ',')) i++; };

  skipSep();
  if (args[i] !== "'") return '';
  i++;
  let encoded = '';
  while (i < args.length) {
    if (args[i] === '\\' && i + 1 < args.length) { encoded += args[i + 1]; i += 2; }
    else if (args[i] === "'") { i++; break; }
    else { encoded += args[i]; i++; }
  }

  skipSep();
  let radixStr = '';
  while (i < args.length && /\d/.test(args[i])) radixStr += args[i++];
  const radix = parseInt(radixStr) || 10;

  skipSep();
  let countStr = '';
  while (i < args.length && /\d/.test(args[i])) countStr += args[i++];
  const count = parseInt(countStr) || 0;

  skipSep();
  if (args[i] !== "'") return '';
  i++;
  let wordsStr = '';
  while (i < args.length && args[i] !== "'") wordsStr += args[i++];
  const words = wordsStr.split('|');

  // 建词典
  const dict = {};
  for (let j = 0; j < count && j < words.length; j++) {
    dict[packerKey(j, radix)] = words[j];
  }

  // 单次替换: key 按长度降序构成交替，避免
  // 1) 短 key 先替换破坏长 key  2) 替换值中含其他 key 文本被二次替换
  const keys = Object.keys(dict).sort((a, b) => b.length - a.length);
  if (keys.length === 0) return encoded;
  return encoded.replace(new RegExp('\\b(' + keys.join('|') + ')\\b', 'g'), (m) => dict[m]);
}

/** 从解码后的 JS 里抽 m3u8/mp4 直链，清晰度入名 */
function extractVideoUrls(decoded) {
  const urls = [];
  if (!decoded) return urls;
  const re = /['"](https?:\/\/[^'"]+\.(?:m3u8|mp4)[^'"]*)['"]/g;
  let m;
  while ((m = re.exec(decoded)) !== null) {
    const url = m[1];
    if (urls.some((u) => u.url === url)) continue;
    const q = url.match(/(?:^|[-_/])(\d{3,4}p)(?:[-_.?/#]|$)/i);
    urls.push({ name: q ? q[1] : '', url: url });
  }
  return urls;
}

// ==================== 列表解析（按站点结构改） ====================
/**
 * TODO: 按 analyze_page.js 的产出写。通用套路:
 * 1. 主正则匹配卡片容器，抽 href / 图片 / 标题
 * 2. 过滤非视频链接（导航、分类页、外域广告）
 * 3. 按 vod_id 去重
 * 4. 站点常有多套结构 → 多套正则依次尝试，结果合并
 */
function parseList(html) {
  const list = [];
  if (!html) return list;

  // —— 示例：SSR 卡片（按实际结构替换）——
  // const cardRe = /<a\s+href="([^"]+)"[^>]*>\s*<img[^>]*(?:data-src|src)="([^"]+)"[^>]*alt="([^"]*)"/g;
  // let m;
  // while ((m = cardRe.exec(html)) !== null) {
  //   const vodId = abs(decode(m[1]));
  //   const vodName = text(m[3]);
  //   if (!vodId || !vodName || vodId.indexOf(HOST) !== 0) continue; // 滤外域广告
  //   if (list.some((v) => v.vod_id === vodId)) continue;
  //   list.push({ vod_id: vodId, vod_name: vodName, vod_pic: abs(decode(m[2])) });
  // }
  return list;
}

/** 从分页控件解析最大页码；解析不到返回 1（别返回 999） */
function parsePageCount(html) {
  if (!html) return 1;
  const matches = html.match(/[?&]page=(\d+)/g) || [];
  let max = 1;
  for (const m of matches) {
    const n = parseInt(m.match(/(\d+)/)[1]);
    if (n > max) max = n;
  }
  return max;
}

// ==================== Spider 主体 ====================
const spider = {
  init() {},

  home() {
    return JSON.stringify({
      class: CLASSES.map((c) => ({ type_id: c[0], type_name: c[1] })),
    });
  },

  homeVod() {
    return this.category(CLASSES[0][0], '1');
  },

  category(tid, pg) {
    const page = Number(pg || 1);
    // TODO: 按站点分页规则拼 URL（注意 filter 参数下翻页用 &page=）
    let url = HOST + '/list';
    if (tid && tid !== '全部') url += '?filter=' + encodeURIComponent(tid);
    url += (url.indexOf('?') === -1 ? '?' : '&') + 'page=' + page;

    const html = request(url);
    const list = parseList(html);
    const pagecount = parsePageCount(html);
    return JSON.stringify({
      page: page,
      pagecount: pagecount,
      limit: list.length || 24,
      total: list.length * pagecount,
      list: list,
    });
  },

  detail(id) {
    const pageUrl = abs(id);
    let html = '';
    try {
      html = request(pageUrl);
    } catch (e) {
      return JSON.stringify({ list: [] });
    }
    if (!html) return JSON.stringify({ list: [] });

    // —— 提取点按优先级: og meta → 下载页 → data-source → 内联 → packed JS ——
    const ogTitle = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"/);
    const name = ogTitle ? decode(ogTitle[1]) : '';
    const ogImage = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/);
    const pic = ogImage ? ogImage[1] : '';
    const descMatch = html.match(/<meta[^>]*name="description"[^>]*content="([^"]*)"/);
    const desc = descMatch ? decode(descMatch[1]) : '';

    // TODO: 按站点选一种或多种提取方式
    let playItems = [];
    // 方式A: packed JS
    // playItems = extractVideoUrls(decodeEval(html));
    // 方式B: 专用下载页
    // const dl = request(HOST + '/download?v=' + id); playItems = parseDownloadPage(dl);
    // 方式C: data-source 属性
    // const ds = html.match(/data-source='([^']+)'/); if (ds) playItems = [{name:'播放', url: ds[1]}];

    // 解析失败返回空播放串，不要把详情页 URL 当播放源兜底
    const playUrls = playItems
      .map((item, index) => safeName(item.name, '播放', index) + '$' + item.url)
      .join('#');

    return JSON.stringify({
      list: [{
        vod_id: pageUrl,
        vod_name: name,
        vod_pic: pic,
        vod_content: desc,
        vod_play_from: '默认线路',
        vod_play_url: playUrls,
      }],
    });
  },

  search(key) {
    // TODO: 按站点搜索 URL 规则拼（多数是 /search/关键词）
    const url = HOST + '/search/' + encodeURIComponent(key);
    return JSON.stringify({ list: parseList(request(url)) });
  },

  play(flag, id) {
    return JSON.stringify({
      parse: 0,
      url: id,
      header: {
        'User-Agent': HEADERS['User-Agent'],
        'Referer': HOST + '/',
        // 注意: Origin 慎用，部分 CDN 校验 Origin 会 403
      },
    });
  },

  live() { return ''; },
  sniffer() { return false; },
  isVideo(url) { return /\.(mp4|m3u8)(\?|$)/i.test(url); },
  proxy() { return [404, 'text/plain', '']; },
  action() { return ''; },
  destroy() {},
};

export default spider;
