/**
 * 金牌影院 (0bv77aw.com) — Next.js 自建站，匿名 API 驱动
 *
 * 站点架构（2026-10-21 逆向）:
 *   列表/详情/播放全部走 /api/mw-movie/anonymous/* JSON API
 *   签名算法（从站点 JS 2844 chunk 逆向，双样本验证过）:
 *     h = "排序参数k=v&...&key=<SIGN_KEY>&t=<毫秒时间戳>"
 *     sign = SHA1(MD5(h))
 *     请求头: sign / t / deviceId(任意UUID) / client-type: 1
 *
 * API:
 *   get/filer/type                          分类树 [{typeId,typeName}]
 *   video/list?type1&pageNum&pageSize       分类列表 {totalCount,totalPage,list[]}
 *   video/searchByWordPageable?keyword&..   搜索 {list[]}
 *   video/detail?id                         详情（episodeList:[{nid,name,playUrl:null}]）
 *   v2/video/episode/url?id&nid&clientType  播放地址 {list:[{resolutionName,url}]}
 *
 * 播放链路: detail 只拿集数(nid) → play() 按 id+nid 现取真实地址（避免 N 集 N 次请求）
 */

console.log('SPIDER MODULE LOADED v2');
const HOST = 'https://0bv77aw.com';
const API_BASE = HOST + '/api/mw-movie/anonymous';
const SIGN_KEY = 'cb808529bae6b6be45ecfab29a4889bc';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const DEVICE_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'; // 匿名接口不校验，固定即可

// ==================== 纯 JS MD5 / SHA1（QuickJS 无 crypto） ====================

function utf8Bytes(str) {
  const bytes = [];
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i);
    if (c < 0x80) {
      bytes.push(c);
    } else if (c < 0x800) {
      bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
      const c2 = str.charCodeAt(++i);
      const cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
      bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else {
      bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
  }
  return bytes;
}

function md5(str) {
  const x = utf8Bytes(String(str));
  const len = x.length;
  x.push(0x80);
  while (x.length % 64 !== 56) x.push(0);
  const bitLen = len * 8;
  for (let i = 0; i < 4; i++) x.push((bitLen >>> (i * 8)) & 0xff);
  // 高位 32 位（本实现按 32位长度处理，URL 签名串远低于 512MB，安全）
  for (let i = 0; i < 4; i++) x.push(0);

  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  const K = [], S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
  for (let i = 0; i < 64; i++) K.push(Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296));

  for (let chunk = 0; chunk < x.length; chunk += 64) {
    const M = [];
    for (let i = 0; i < 16; i++) {
      M.push(x[chunk + i * 4] | (x[chunk + i * 4 + 1] << 8) | (x[chunk + i * 4 + 2] << 16) | (x[chunk + i * 4 + 3] << 24));
    }
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      F = (F + A + K[i] + M[g]) | 0;
      A = D; D = C; C = B;
      B = (B + ((F << S[i]) | (F >>> (32 - S[i])))) | 0;
    }
    a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
  }

  const toHex = (n) => {
    let s = '';
    for (let i = 0; i < 4; i++) s += ('0' + ((n >>> (i * 8)) & 0xff).toString(16)).slice(-2);
    return s;
  };
  return toHex(a0) + toHex(b0) + toHex(c0) + toHex(d0);
}

function sha1(str) {
  const x = utf8Bytes(String(str));
  const len = x.length;
  x.push(0x80);
  while (x.length % 64 !== 56) x.push(0);
  const bitLen = len * 8;
  // SHA1 长度字段为大端序 64 位：高 32 位补零，低 32 位按从高字节到低字节push
  for (let i = 0; i < 4; i++) x.push(0);
  for (let i = 3; i >= 0; i--) x.push((bitLen >>> (i * 8)) & 0xff);

  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  const W = new Array(80);
  for (let chunk = 0; chunk < x.length; chunk += 64) {
    for (let i = 0; i < 16; i++) {
      W[i] = (x[chunk + i * 4] << 24) | (x[chunk + i * 4 + 1] << 16) | (x[chunk + i * 4 + 2] << 8) | x[chunk + i * 4 + 3];
    }
    for (let i = 16; i < 80; i++) {
      W[i] = ((W[i - 3] ^ W[i - 8] ^ W[i - 14] ^ W[i - 16]) << 1) | ((W[i - 3] ^ W[i - 8] ^ W[i - 14] ^ W[i - 16]) >>> 31);
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let i = 0; i < 80; i++) {
      let f, k;
      if (i < 20) { f = (b & c) | (~b & d); k = 0x5a827999; }
      else if (i < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
      else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
      else { f = b ^ c ^ d; k = 0xca62c1d6; }
      const t = (((a << 5) | (a >>> 27)) + f + e + k + W[i]) | 0;
      e = d; d = c; c = (b << 30) | (b >>> 2); b = a; a = t;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0; h4 = (h4 + e) | 0;
  }
  const toHex = (n) => ('00000000' + (n >>> 0).toString(16)).slice(-8);
  return toHex(h0) + toHex(h1) + toHex(h2) + toHex(h3) + toHex(h4);
}

// ==================== API 客户端 ====================

function apiGet(path, params) {
  const p = {};
  for (const k in (params || {})) {
    const v = params[k];
    if (v !== '' && v !== null && v !== undefined) p[k] = v;
  }
  const t = String(Date.now());
  let h = 'key=' + SIGN_KEY + '&t=' + t;
  const keys = Object.keys(p).sort();
  if (keys.length) h = keys.map((k) => k + '=' + p[k]).join('&') + '&' + h;
  const sign = sha1(md5(h));

  let url = API_BASE + '/' + path;
  const qs = keys.map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(p[k])).join('&');
  if (qs) url += '?' + qs;

  const res = globalThis._http(url, {
    headers: {
      'User-Agent': UA,
      'Accept': 'application/json',
      'client-type': '1',
      'deviceId': DEVICE_ID,
      'sign': sign,
      't': t,
      'Referer': HOST + '/',
    },
    timeout: 15000,
  });
  console.log('apiGet: ' + path + ' status=' + (res ? res.status : 'null') + ' len=' + (res && res.content ? res.content.length : 0));
  if (!res || !res.content) { console.log('apiGet: 空响应'); return null; }
  try {
    return JSON.parse(res.content);
  } catch (e) {
    console.log('apiGet: JSON解析失败 ' + e);
    return null;
  }
}

// ==================== 工具 ====================

function stripHtml(s) {
  return String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function playPageUrl(vodId, nid) {
  return HOST + '/vod/play/' + vodId + '/sid/' + nid;
}

// ==================== Spider ====================

const spider = {
  init() {},

  home() {
    const d = apiGet('get/filer/type', {});
    const classes = [];
    const list = (d && d.data) || [];
    for (const item of list) {
      if (item && item.typeId) classes.push({ type_id: String(item.typeId), type_name: item.typeName || '' });
    }
    return JSON.stringify({ class: classes });
  },

  homeVod() {
    return this.category('2', '1');
  },

  category(tid, pg) {
    const page = Number(pg || 1);
    const d = apiGet('video/list', { type1: tid, pageNum: String(page), pageSize: '24' });
    const data = (d && d.data) || {};
    const list = [];
    for (const v of data.list || []) {
      if (!v || !v.vodId) continue;
      list.push({
        vod_id: String(v.vodId),
        vod_name: v.vodName || '',
        vod_pic: v.vodPic || '',
        vod_remarks: v.vodRemarks || (v.vodSerial ? '更新至' + v.vodSerial + '集' : ''),
      });
    }
    return JSON.stringify({
      page: page,
      pagecount: data.totalPage || 1,
      limit: 24,
      total: data.totalCount || list.length,
      list: list,
    });
  },

  detail(id) {
    const d = apiGet('video/detail', { id: id });
    const v = (d && d.data) || null;
    if (!v) return JSON.stringify({ list: [] });

    const episodes = (v.episodeList || []).filter((e) => e && e.nid);
    const urls = episodes.map((e) => {
      const name = (e.name || '').replace(/[$#]/g, ' ') || ('第' + e.sort + '集');
      return name + '$' + playPageUrl(v.vodId, e.nid);
    }).join('#');

    // 电影类可能没有分集：episodeList 为空时用 sid=nid 兜底不了就返回空
    return JSON.stringify({
      list: [{
        vod_id: String(v.vodId),
        vod_name: v.vodName || '',
        vod_pic: v.vodPic || '',
        vod_content: stripHtml(v.vodContent),
        vod_remarks: v.vodRemarks || '',
        vod_year: v.vodYear || '',
        vod_area: v.vodArea || '',
        vod_actor: v.vodActor || '',
        vod_director: v.vodDirector || '',
        vod_play_from: '金牌影院',
        vod_play_url: urls,
      }],
    });
  },

  play(flag, id) {
    // id 形如 https://0bv77aw.com/vod/play/147455/sid/1323435
    console.log('play: id=' + id);
    const m = String(id).match(/\/vod\/play\/(\d+)\/sid\/(\d+)/);
    if (!m) { console.log('play: id 不匹配播放页格式'); return JSON.stringify({ parse: 0, url: id }); }
    const d = apiGet('v2/video/episode/url', { id: m[1], nid: m[2], clientType: '1' });
    console.log('play: api 返回 ' + (d ? JSON.stringify(d).slice(0, 200) : 'null'));
    const list = (d && d.data && d.data.list) || [];
    if (!list.length) { console.log('play: 无可用线路'); return JSON.stringify({ parse: 0, url: '' }); }
    // 第一条为最高清晰度（蓝光1080 > 高清720 > 标清480）
    const best = list[0];
    return JSON.stringify({
      parse: 0,
      url: best.url,
      header: {
        'User-Agent': UA,
        'Referer': HOST + '/',
      },
    });
  },

  search(key) {
    const d = apiGet('video/searchByWordPageable', { keyword: key, pageNum: '1', pageSize: '24' });
    const data = (d && d.data) || {};
    const list = [];
    for (const v of data.list || []) {
      if (!v || !v.vodId) continue;
      list.push({
        vod_id: String(v.vodId),
        vod_name: v.vodName || '',
        vod_pic: v.vodPic || '',
        vod_remarks: v.vodRemarks || '',
      });
    }
    return JSON.stringify({ list: list });
  },

  live() { return ''; },
  sniffer() { return false; },
  isVideo(url) { return /\.(mp4|m3u8)(\?|$)/i.test(url); },
  proxy() { return [404, 'text/plain', '']; },
  action() { return ''; },
  destroy() {},
};

export default spider;
