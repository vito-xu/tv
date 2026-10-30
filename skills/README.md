# skills

这里存放与本仓库配套的自动化技能（WorkBuddy / Claude Skill 格式），可直接复制到本机技能目录复用。

## tvbox-config-builder

TVBox 源站接入的完整工作流：分析站点 → 找到数据 API 或写 QuickJS 爬虫 → 生成/修复 `config.json` → 真机验证。

```
skills/tvbox-config-builder/
├── SKILL.md                  流程总纲（何时用、怎么判断站点类型、验收标准）
├── references/
│   ├── site-patterns.md      常见站点形态（苹果CMS API / SSR / Alpine+Recombee / eval 打包 JS / 签名接口）
│   ├── anticrawl.md          封锁分级与应对（UA、Referer、Cookie、签名、限速）
│   ├── spider-contract.md    TVBox spider 的接口契约与返回字段
│   └── device-testing.md     真机验证：起播日志、分类/详情/播放三段断言
├── assets/
│   ├── analyze_page.js       网页结构分析脚本（列出接口、内联数据、渲染方式）
│   └── spider_template.js    QuickJS 爬虫模板
└── scripts/
    ├── probe_site.py         站点探针（可达性、反爬特征、候选 API）
    ├── test_spider.js        本地跑爬虫（node + 桩数据）
    └── test_unpacker.js      解 eval/packed JS
```

### 本机安装

```bash
cp -R skills/tvbox-config-builder ~/.workbuddy/skills/
```

放好后在 WorkBuddy 里说「接入某个新源」「写个 TVBox 爬虫」即可触发。

## 相关

- 配置本体：仓库根目录 `config.json`（7 站点精简版，手机在用）
- 爬虫脚本：`js/0bv77aw.js`（金牌影院）、`js/koolearn.js`（新东方公开课）
- 手机读取地址：`https://raw.githubusercontent.com/vito-xu/tv/main/config.json`
