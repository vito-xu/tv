#!/usr/bin/env node
/**
 * TVBox QuickJS 爬虫本地测试 harness
 *
 * 用 Node vm 加载 spider 文件（export default spider → globalThis.__SPIDER__），
 * mock 同步的 globalThis._http（与 Android QuickJS 运行时同语义），
 * 支持实网抓取（curl，可走代理）与本地样本回放两种模式。
 *
 * 用法:
 *   node test_spider.js <spider.js> <command> [args...] [选项]
 *
 * 命令:
 *   home                      测试 home()
 *   homeVod                   测试 homeVod()
 *   category <tid> <pg>       测试 category(tid, pg)
 *   detail <id>               测试 detail(id)
 *   search <keyword>          测试(keyword)
 *   play <flag> <id>          测试 play(flag, id)
 *   all <tid> <pg> <keyword>  依次跑 home/category/detail/search/play 冒烟
 *
 * 选项:
 *   --proxy <url>             HTTP 代理（实网模式），如 http://127.0.0.1:7890
 *   --sample <regex=path>     样本回放：请求 URL 命中正则时读本地文件（可重复）
 *   --timeout <ms>            单请求超时，默认 15000
 *   --raw                    结果不 pretty print，原样输出
 *   --list N                 列表最多显示 N 条，默认 5
 *
 * 环境变量: HTTP_PROXY / HTTPS_PROXY 作为默认代理（--proxy 优先）
 *
 * 示例:
 *   node test_spider.js js/xxx.js category dm 1 --proxy http://127.0.0.1:7890
 *   node test_spider.js js/xxx.js all dm 1 测试 --sample 'bad\.news=./samples/bad_p1.html'
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ---------- 参数解析 ----------
function parseArgs(argv) {
  const opts = { samples: [], proxy: process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '', timeout: 15000, raw: false, listN: 5 };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--proxy') opts.proxy = argv[++i];
    else if (a === '--sample') opts.samples.push(argv[++i]);
    else if (a === '--timeout') opts.timeout = Number(argv[++i]);
    else if (a === '--raw') opts.raw = true;
    else if (a === '--list') opts.listN = Number(argv[++i]);
    else positional.push(a);
  }
  opts.samples = opts.samples.map(s => {
    const idx = s.indexOf('=');
    if (idx < 0) throw new Error('--sample 格式应为 regex=path: ' + s);
    return { re: new RegExp(s.slice(0, idx)), file: s.slice(idx + 1) };
  });
  return { opts, positional };
}

// ---------- mock globalThis._http（同步，语义同 QuickJS） ----------
function makeHttp(opts) {
  const fileCache = {};
  return function (url, options = {}) {
    const headers = options.headers || {};
    const timeout = options.timeout || opts.timeout;

    // 样本回放优先：不发起网络请求
    for (const s of opts.samples) {
      if (s.re.test(url)) {
        if (!fileCache[s.file]) {
          if (!fs.existsSync(s.file)) return { ok: false, status: 0, url, content: '', error: '样本不存在: ' + s.file };
          fileCache[s.file] = fs.readFileSync(s.file, 'utf-8');
        }
        return { ok: true, status: 200, url, content: fileCache[s.file], replayed: true };
      }
    }

    // 实网模式：execSync curl
    let cmd = `curl -s -m ${Math.ceil(timeout / 1000)} -w '\\n__STATUS__%{http_code}'`;
    if (opts.proxy) cmd += ` -x '${opts.proxy}'`;
    for (const [k, v] of Object.entries(headers)) {
      cmd += ` -H '${k}: ${String(v).replace(/'/g, "'\\''")}'`;
    }
    cmd += ` '${url.replace(/'/g, "'\\''")}'`;
    try {
      const out = execSync(cmd, { encoding: 'utf-8', timeout: timeout + 3000, maxBuffer: 32 * 1024 * 1024 });
      const m = out.match(/\n__STATUS__(\d+)\s*$/);
      const status = m ? Number(m[1]) : 200;
      const content = m ? out.slice(0, m.index) : out;
      return { ok: status >= 200 && status < 300, status, url, content };
    } catch (err) {
      // curl 非零退出：仍尝试从 stdout 取状态码（如 403 时 -s 不报错，仅超时/连接失败会抛）
      const out = err.stdout ? err.stdout.toString() : '';
      const m = out.match(/\n__STATUS__(\d+)\s*$/);
      if (m) {
        const status = Number(m[1]);
        return { ok: false, status, url, content: out.slice(0, m.index) };
      }
      return { ok: false, status: 0, url, content: '', error: String(err.message || err) };
    }
  };
}

// ---------- 加载 spider ----------
function loadSpider(filePath, http) {
  const code = fs.readFileSync(path.resolve(filePath), 'utf-8');
  const wrapped = code
    .replace(/export default spider;?/, 'globalThis.__SPIDER__ = spider;')
    .replace(/export default (\w+);?/, 'globalThis.__SPIDER__ = $1;');
  const ctx = vm.createContext({
    module: { exports: {} }, exports: {}, require, console,
    Buffer, setTimeout, setInterval, clearTimeout, clearInterval,
    _http: http,
  });
  vm.runInContext(wrapped, ctx, { filename: filePath });
  if (!ctx.__SPIDER__) throw new Error('未找到 spider 对象（检查 export default）');
  return ctx.__SPIDER__;
}

// ---------- 结果展示 ----------
function showResult(cmd, result, opts) {
  if (typeof result !== 'string') {
    console.log('📦 非字符串结果:', JSON.stringify(result).slice(0, 500));
    return;
  }
  if (opts.raw) { console.log(result); return; }
  let d;
  try { d = JSON.parse(result); } catch {
    console.log('📦 原始输出（非 JSON）:', result.slice(0, 500));
    return;
  }
  if (d.class) {
    console.log(`分类 ${d.class.length} 个: ${d.class.map(c => c.type_name || c.name).join(' / ')}`);
  }
  if (Array.isArray(d.list)) {
    const n = d.list.length;
    console.log(`列表 ${n} 条${d.pagecount !== undefined ? '，pagecount=' + d.pagecount : ''}${d.page !== undefined ? '，page=' + d.page : ''}`);
    d.list.slice(0, opts.listN).forEach((v, i) => {
      console.log(`  [${i}] ${v.vod_name || '(无标题)'}`);
      console.log(`      id:  ${v.vod_id || ''}`);
      if (v.vod_pic) console.log(`      pic: ${String(v.vod_pic).slice(0, 100)}`);
      if (v.vod_remarks) console.log(`      rem: ${v.vod_remarks}`);
    });
    if (n > opts.listN) console.log(`  ... 其余 ${n - opts.listN} 条省略（--list 调整）`);
    // 唯一性检查
    const ids = d.list.map(v => v.vod_id).filter(Boolean);
    const dup = ids.length - new Set(ids).size;
    if (dup > 0) console.log(`⚠️  vod_id 重复 ${dup} 个`);
    // 播放线路
    const v0 = d.list[0];
    if (v0 && v0.vod_play_url) {
      const lines = String(v0.vod_play_url).split('#').filter(Boolean);
      console.log(`首条播放线路 ${lines.length} 个:`);
      lines.slice(0, 5).forEach((u, i) => console.log(`  <${i}> ${u.slice(0, 150)}`));
    }
    if (n === 0) console.log('⚠️  列表为空 —— 检查解析逻辑或样本/页面是否正确');
  }
  if (d.url !== undefined) {
    console.log(`播放: parse=${d.parse} url=${String(d.url).slice(0, 150)}`);
    if (d.header) console.log(`header: ${JSON.stringify(d.header).slice(0, 150)}`);
  }
}

// ---------- 主流程 ----------
function main() {
  const { opts, positional } = parseArgs(process.argv.slice(2));
  if (positional.length < 2) {
    console.log('用法: node test_spider.js <spider.js> <command> [args...] [--proxy URL] [--sample regex=path]');
    console.log('命令: home | homeVod | category <tid> <pg> | detail <id> | search <key> | play <flag> <id> | all <tid> <pg> <key>');
    process.exit(1);
  }
  const [file, cmd, ...rest] = positional;
  console.log(`🔍 ${file} | ${cmd} ${rest.join(' ')}${opts.proxy ? ' | proxy=' + opts.proxy : ''}${opts.samples.length ? ' | 样本回放 x' + opts.samples.length : ''}`);

  let spider;
  try {
    spider = loadSpider(file, makeHttp(opts));
  } catch (e) {
    console.error('❌ 加载失败:', e.message);
    process.exit(1);
  }

  const run = (c, args) => {
    console.log(`\n===== ${c} ${args.join(' ')} =====`);
    let r;
    const t0 = Date.now();
    try {
      switch (c) {
        case 'home': r = spider.home(); break;
        case 'homeVod': r = spider.homeVod(); break;
        case 'category': r = spider.category(args[0], args[1]); break;
        case 'detail': r = spider.detail(args[0]); break;
        case 'search': r = spider.search(args[0]); break;
        case 'play': r = spider.play(args[0], args[1]); break;
        default: throw new Error('未知命令: ' + c);
      }
    } catch (e) {
      console.error(`❌ ${c} 执行异常: ${e.message}`);
      return null;
    }
    console.log(`(${Date.now() - t0}ms)`);
    showResult(c, r, opts);
    return r;
  };

  let failed = false;
  if (cmd === 'all') {
    const [tid, pg, key] = [rest[0] || '1', rest[1] || '1', rest[2] || 'a'];
    run('home', []);
    const cat = run('category', [tid, pg]);
    let vid = '';
    try { vid = (JSON.parse(cat).list || [])[0]?.vod_id || ''; } catch {}
    if (vid) {
      const det = run('detail', [vid]);
      let purl = '';
      try {
        const v = (JSON.parse(det).list || [])[0];
        purl = String(v?.vod_play_url || '').split('#')[0]?.split('$')[1] || '';
      } catch {}
      if (purl) run('play', ['', purl]);
    }
    if (key) run('search', [key]);
    if (!cat) failed = true;
  } else {
    if (!run(cmd, rest)) failed = true;
  }
  process.exit(failed ? 1 : 0);
}

main();
