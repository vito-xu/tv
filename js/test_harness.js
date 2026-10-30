/**
 * TVBox JS Spider Test Harness
 * 
 * This script mocks the Android runtime environment (globalThis._http, etc.)
 * so that the JS spider files can be tested in Node.js.
 * 
 * IMPORTANT: The Android QuickJS _http() is SYNCHRONOUS (blocking).
 * We use child_process.execSync with curl to achieve the same behavior.
 * 
 * Usage:
 *   node js/test_harness.js <spider_file> <command> [args...]
 * 
 * Commands:
 *   home              - Test home() function
 *   homeVod           - Test homeVod() function
 *   category <tid> <pg> - Test category() function
 *   detail <id>       - Test detail() function
 *   search <keyword>  - Test search() function
 *   play <flag> <id>  - Test play() function
 * 
 * Examples:
 *   node js/test_harness.js js/0bv77aw.js home
 *   node js/test_harness.js js/0bv77aw.js category 2 1
 *   node js/test_harness.js js/hanime1.js search 动漫
 *   node js/test_harness.js js/badnews.js homeVod
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ============================================================
// Mock globalThis._http - SYNCHRONOUS, like the Android runtime
// ============================================================
globalThis._http = function(url, options = {}) {
  const headers = options.headers || {};
  const timeout = options.timeout || 15000;
  
  // Build curl command for synchronous HTTP request
  let curlCmd = `curl -s -m ${Math.ceil(timeout / 1000)}`;
  
  // Add headers
  for (const [key, value] of Object.entries(headers)) {
    curlCmd += ` -H "${key}: ${value.replace(/"/g, '\\"')}"`;
  }
  
  // Add URL
  curlCmd += ` "${url}"`;
  
  try {
    const content = execSync(curlCmd, {
      encoding: 'utf-8',
      timeout: timeout + 2000,
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });
    
    return {
      ok: true,
      status: 200,
      url: url,
      content: content,
    };
  } catch (err) {
    // curl returns non-zero exit code on failure
    return {
      ok: false,
      status: 0,
      url: url,
      content: '',
    };
  }
};

// ============================================================
// Mock other global functions that the Android runtime provides
// ============================================================
globalThis.setTimeout = setTimeout;
globalThis.console = console;

// ============================================================
// Helper to import a spider JS file as a CommonJS module
// ============================================================
function loadSpider(filePath) {
  const absolutePath = path.resolve(filePath);
  const code = fs.readFileSync(absolutePath, 'utf-8');
  
  // The spider files use ES module export: export default spider;
  // Replace with a global assignment for CommonJS compatibility
  const wrappedCode = code
    .replace(/export default spider;?/, 'globalThis.__SPIDER__ = spider;')
    .replace(/export default (\w+);?/, 'globalThis.__SPIDER__ = $1;');
  
  try {
    const vm = require('vm');
    const script = new vm.Script(wrappedCode, { filename: filePath });
    const context = vm.createContext({
      ...globalThis,
      module: { exports: {} },
      exports: {},
      require: require,
      console: console,
      Buffer: Buffer,
      setTimeout: setTimeout,
      setInterval: setInterval,
      clearTimeout: clearTimeout,
      clearInterval: clearInterval,
    });
    
    script.runInContext(context);
    
    if (context.__SPIDER__) {
      return context.__SPIDER__;
    }
    
    console.error('Could not find spider object.');
    return null;
  } catch (err) {
    console.error('Error loading spider:', err.message);
    console.error(err.stack);
    return null;
  }
}

// ============================================================
// Main test runner
// ============================================================
function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.log(`
TVBox JS Spider Test Harness
=============================
Usage:
  node js/test_harness.js <spider_file> <command> [args...]

Commands:
  home                    - Test home()
  homeVod                 - Test homeVod()
  category <tid> <pg>     - Test category()
  detail <id>             - Test detail()
  search <keyword>        - Test search()
  play <flag> <id>        - Test play()

Examples:
  node js/test_harness.js js/0bv77aw.js home
  node js/test_harness.js js/0bv77aw.js category 2 1
  node js/test_harness.js js/hanime1.js search 动漫
  node js/test_harness.js js/badnews.js homeVod
`);
    process.exit(1);
  }

  const spiderFile = args[0];
  const command = args[1];
  const commandArgs = args.slice(2);

  console.log(`\n🔍 Loading spider: ${spiderFile}`);
  console.log(`📋 Command: ${command} ${commandArgs.join(' ')}\n`);

  const spider = loadSpider(spiderFile);
  
  if (!spider) {
    console.error('❌ Failed to load spider');
    process.exit(1);
  }

  console.log('✅ Spider loaded successfully\n');

  let result;
  try {
    switch (command) {
      case 'home':
        result = spider.home();
        break;
      case 'homeVod':
        result = spider.homeVod();
        break;
      case 'category':
        result = spider.category(commandArgs[0], commandArgs[1]);
        break;
      case 'detail':
        result = spider.detail(commandArgs[0]);
        break;
      case 'search':
        result = spider.search(commandArgs[0]);
        break;
      case 'play':
        result = spider.play(commandArgs[0], commandArgs[1]);
        break;
      default:
        console.error(`❌ Unknown command: ${command}`);
        process.exit(1);
    }

    // Pretty print the result
    if (typeof result === 'string') {
      try {
        const parsed = JSON.parse(result);
        console.log('📦 Result (parsed):');
        console.log(JSON.stringify(parsed, null, 2));
      } catch {
        console.log('📦 Result (raw string):');
        console.log(result);
      }
    } else {
      console.log('📦 Result:');
      console.log(JSON.stringify(result, null, 2));
    }
  } catch (err) {
    console.error(`❌ Error executing ${command}:`, err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

main();
