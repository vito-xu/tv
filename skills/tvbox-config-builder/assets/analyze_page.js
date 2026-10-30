/**
 * TVBox 网站分析脚本模板（Playwright）
 *
 * 一次运出行内分析: dump HTML + 卡片模式计数 + XHR 拦截 + SSR 判定 + og meta。
 * 用法:
 *   node analyze_page.js <列表页URL> [详情页URL] [--proxy http://127.0.0.1:7890] [--out ./samples]
 *
 * 依赖: npm i playwright（分析目标项目里装一次即可）
 * 输出: <out>/list.html、<out>/detail.html（供 test_spider.js --sample 回放）
 *
 * 判定逻辑:
 *   - domcontentloaded vs networkidle 的 HTML 长度差 >20% → 客户端渲染 → 追 XHR 找 API
 *   - XHR 拦截打印所有 /api/、recombee、graphql、json 响应的 URL 与前 500 字符
 *   - 详情页检查 og:title/og:image/description 与 eval(function(p,a,c,k,e,d
 */

const fs = require('fs');
const path = require('path');

// playwright 解析: ① 脚本所在项目的 node_modules ② cwd 项目的 node_modules
// ③ 环境变量 PLAYWRIGHT_PATH 显式指定；都失败时给出明确指引
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (e) {
  const candidates = [];
  if (process.env.PLAYWRIGHT_PATH) candidates.push(process.env.PLAYWRIGHT_PATH);
  try { candidates.push(require.resolve('playwright', { paths: [process.cwd()] })); } catch (e2) {}
  for (const c of candidates) {
    try {
      ({ chromium } = require(c));
      console.log('（playwright 解析自: ' + c + '）');
      break;
    } catch (e3) { /* 试下一个 */ }
  }
  if (!chromium) {
    console.error('未找到 playwright。三选一:');
    console.error('  1. 在目标项目目录执行: npm i playwright && npx playwright install chromium');
    console.error('  2. 把本脚本拷贝到已装 playwright 的项目里运行');
    console.error('  3. export PLAYWRIGHT_PATH=<playwright模块目录> 后重跑');
    process.exit(1);
  }
}

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

(async () => {
  const positional = process.argv.slice(2).filter((a) => !a.startsWith('--') && a !== arg('proxy') && a !== arg('out'));
  const listUrl = positional[0];
  const detailUrl = positional[1] || '';
  const outDir = arg('out', './samples');
  const proxy = arg('proxy', process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '');
  if (!listUrl) {
    console.log('用法: node analyze_page.js <列表页URL> [详情页URL] [--proxy URL] [--out dir]');
    process.exit(1);
  }
  fs.mkdirSync(outDir, { recursive: true });

  const launchOpts = { headless: true, args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'] };
  if (proxy) launchOpts.proxy = { server: proxy };
  const browser = await chromium.launch(launchOpts);
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: 'zh-TW',
    viewport: { width: 1280, height: 800 },
  });
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  const page = await ctx.newPage();

  // ---------- XHR/fetch 拦截（找数据 API） ----------
  const apiHits = [];
  page.on('response', async (resp) => {
    const url = resp.url();
    const type = resp.request().resourceType();
    if (type === 'xhr' || type === 'fetch' || /\/api\/|recombee|graphql|\.json/i.test(url)) {
      const ct = resp.headers()['content-type'] || '';
      const isJson = /json/i.test(ct) || /\/api\/|recombee|graphql|\.json/i.test(url);
      let body = '';
      if (isJson) {
        try { body = (await resp.text()).slice(0, 500); } catch (e) {}
      }
      apiHits.push({ url, status: resp.status(), body });
      console.log(`[XHR ${resp.status()}] ${url}`);
      if (body) console.log('        ' + body.replace(/\s+/g, ' ').slice(0, 300));
    }
  });

  // ---------- 列表页 ----------
  console.log('\n===== 列表页: ' + listUrl + ' =====');
  try {
    await page.goto(listUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch (e) {
    console.error('❌ 列表页打开失败: ' + e.message.split('\n')[0]);
    console.error('   排查: 目标站是否被墙（GFW）→ 加 --proxy；代理是否在跑 → probe_site.py 探活');
    await browser.close();
    process.exit(1);
  }
  const htmlFast = await page.content();
  await page.waitForTimeout(3000);
  const htmlFull = await page.content();
  fs.writeFileSync(path.join(outDir, 'list.html'), htmlFull);

  const growth = htmlFast.length ? ((htmlFull.length - htmlFast.length) / htmlFast.length * 100).toFixed(1) : 0;
  console.log(`HTML 长度: domcontentloaded=${htmlFast.length} → networkidle后=${htmlFull.length} (增长 ${growth}%)`);
  console.log(growth > 20 ? '判定: 客户端渲染（初始 HTML 是空壳）→ 必须走上面 XHR 里的数据 API' : '判定: SSR（HTML 直出）→ 可正则解析');

  // 卡片模式计数
  const patterns = ['horizontal-card', 'video-item', 'thumbnail', 'data-src', 'data-echo', '<article', 'watch?v=', 'x-data', 'Alpine'];
  for (const p of patterns) {
    const c = (htmlFull.match(new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
    if (c) console.log(`  "${p}" x${c}`);
  }
  // 外链甄别（广告位）
  const extLinks = await page.$$eval('a[href]', (els) => {
    const host = location.hostname;
    const set = new Set();
    els.forEach((el) => { try { const h = new URL(el.href).hostname; if (h && h !== host && !h.endsWith(host)) set.add(h); } catch (e) {} });
    return [...set].slice(0, 10);
  });
  if (extLinks.length) console.log('外链域名（甄别广告位）:', extLinks.join(', '));

  // ---------- 详情页 ----------
  if (detailUrl) {
    console.log('\n===== 详情页: ' + detailUrl + ' =====');
    try {
      await page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2000);
      const dh = await page.content();
      fs.writeFileSync(path.join(outDir, 'detail.html'), dh);
      const og = dh.match(/<meta[^>]*property="og:(title|image)"[^>]*content="([^"]*)"/g) || [];
      og.slice(0, 4).forEach((m) => console.log('  ' + m.slice(0, 120)));
      console.log('  含 eval(packed):', dh.indexOf('eval(function(p,a,c,k,e,d)') !== -1);
      console.log('  含 m3u8/mp4 直链:', /https?:\/\/[^'"]+\.(m3u8|mp4)/.test(dh));
    } catch (e) {
      console.error('  ❌ 详情页打开失败: ' + e.message.split('\n')[0] + '（列表页样本仍可用）');
    }
  }

  console.log('\n样本已存 ' + outDir + '/（test_spider.js --sample 回放用）');
  if (apiHits.length) console.log('发现 ' + apiHits.length + ' 个数据 API 候选，优先评估直连（比 HTML 解析稳）');
  await browser.close();
})();
