#!/usr/bin/env node
/**
 * 验证 assets/spider_template.js 的 unpacker 与工具函数。
 * 覆盖 packer 三种 radix（16/36/62）、HTML 实体、视频 URL 抽取、集数名净化。
 * 用法: node test_unpacker.js [spider_template.js 路径]
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const tpl = process.argv[2] || path.join(__dirname, '..', 'assets', 'spider_template.js');
const code = fs.readFileSync(tpl, 'utf-8')
  .replace('export default spider;', '')
  .replace('const spider = {', 'globalThis.__T__ = { decodeEval, extractVideoUrls, decode, packerKey, safeName }; const spider = {');
const ctx = vm.createContext({ module: { exports: {} }, exports: {}, require, console, Buffer });
vm.runInContext(code, ctx, { filename: tpl });
const T = ctx.__T__;

// 与真实 packer 输出同构的包装器
function pack(p, a, words) {
  return `eval(function(p,a,c,k,e,d){e=function(c){return(c<a?'':e(parseInt(c/a)))+((c=c%a)>35?String.fromCharCode(c+29):c.toString(36))};if(!''.replace(/^/,String)){while(c--){d[e(c)]=k[c]||c}return p}while(c--){if(d[c]){p=p.replace(new RegExp('\\\\b'+e(c)+'\\\\b','g'),d[c])}}return p}('${p}',${a},${words.length},'${words.join('|')}'.split('|'),0,{}))`;
}

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? '✅' : '❌'} ${name}${ok ? '' : ': ' + detail}`);
  ok ? pass++ : fail++;
};

// 1. radix 16：单字符 hex key
check('radix 16 解码',
  T.decodeEval(pack('var u="0://1.2/3-4.5";', 16, ['https', 'missav', 'ws', 'abc', '720p', 'm3u8']))
    === 'var u="https://missav.ws/abc-720p.m3u8";',
  'radix 16 样本');

// 2. radix 36：key 为 0-9,a-z,10,11...；'1a' 不是合法 key（key 46 越界）应保持原样
check('radix 36 解码',
  T.decodeEval(pack('0.1("2");var 10=z;var 1a=y;', 36, Array.from({ length: 40 }, (_, i) => 'w' + i)))
    === 'w0.w1("w2");var w36=w35;var 1a=w34;',
  'radix 36 样本');

// 3. radix 62：key 越过 35 进入 A-Z，再越 62 进入两位；'24'/'3k' 非合法 key 应保持原样
check('radix 62 解码',
  T.decodeEval(pack('0.1("2");var 10=z;var 24=A;var 3k=Q;', 62, Array.from({ length: 70 }, (_, i) => 'word' + i)))
    === 'word0.word1("word2");var word62=word35;var 24=word36;var 3k=word52;',
  'radix 62 样本');

// 4. 替换顺序无关性: 值中含其他 key 的文本不应被二次替换
//    dict: 0→'a'（值恰是 key 'a' 的文本）, 1→'b'；radix 16 下 'a' 是 key 10 → 'w10'
check('单次替换无二次污染',
  T.decodeEval(pack('0 1', 16, ['a', 'b'].concat(Array.from({ length: 8 }, (_, i) => 'x' + i)).concat(['a', 'b', 'c', 'd', 'e', 'f'])))
    === 'a b',
  '顺序依赖回归');

// 5. HTML 实体
check('HTML 实体解码',
  T.decode('A &amp; B &quot;C&quot; &lt;D&gt; &nbsp;') === 'A & B "C" <D>  ',
  '实体解码');

// 6. 视频 URL 抽取（清晰度入名 + 去重）
const urls = T.extractVideoUrls('var u="https://a.com/720p.m3u8";var v="https://a.com/720p.m3u8";var w="https://b.com/1080p.mp4";');
check('extractVideoUrls',
  urls.length === 2 && urls[0].name === '720p' && urls[1].name === '1080p',
  JSON.stringify(urls));

// 7. 集数名净化（去 $ #，空值回退）
check('safeName 净化',
  T.safeName('第1$集#x', '播放', 0) === '第1 集 x' && T.safeName('', '播放', 2) === '播放3',
  'safeName');

// 8. 非 packer 内容不崩
check('无 eval 时返回空串', T.decodeEval('<html>普通页面</html>') === '', '非 packer 输入');

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
