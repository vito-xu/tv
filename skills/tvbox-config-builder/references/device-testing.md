# 真机验证手册（TVBox / FongMi 类 App）

> **harness 全绿 ≠ 设备能播**。设备侧还有四道关：配置解析、QuickJS 运行时差异、播放器内核、CDN 网络。真实案例（金牌影院）：本地 harness 全过、真机却在播放器阶段静默失败（ijkCodes 空越界），只有真机能暴露。

## 环境准备

### 无线 adb（配对一次，断连后重连）

手机开发者选项 → 无线调试 → 「使用配对码配对设备」：

```bash
adb pair 192.168.1.x:<配对端口> <6位配对码>    # 配对端口只在弹窗时显示一次
adb mdns services                              # 查 _adb-tls-connect 的新端口（≠ 配对端口！）
adb connect 192.168.1.x:<连接端口>
```

过夜/重启后端口必变：直接重跑 pair + mdns 两步。

### 配置托管（LAN 直连，不必走 raw）

```bash
cd <配置目录> && python3 -m http.server 8898 --bind <Mac的LAN-IP>
# 手机 App 配置填 http://<LAN-IP>:8898/config.json
# 长跑服务用工具的 run_in_background；裸 nohup 会被会话回收
```

### 屏幕常亮（测完务必恢复原值）

```bash
adb shell settings put system screen_off_timeout 1800000   # 30min（默认常是 60s，长操作必锁屏）
adb shell input keyevent KEYCODE_WAKEUP
adb shell input swipe 360 1500 360 500 300                 # 无 PIN 上滑解锁
```

## UI 自动化四坑（MIUI 实测）

1. **锁屏 = 空 dump**。uiautomator dump 出来没有任何文本 → 先唤醒解锁再测，别怀疑脚本。
2. **触摸注入可能失效**：`input tap` 坐标正确却无反应、logcat 无任何事件 → 改 **DPAD 焦点导航**：dump 找 `focused="true"` 节点，`keyevent 20/19`（下/上）移动焦点，`keyevent 23`（DPAD_CENTER）确认。**注意 66/ENTER 无效**，TV 惯例是 23。
3. **刘海偏移**：dump 给的是窗口坐标，`input tap` 用屏幕坐标。点击系统性打偏时查：

   ```bash
   adb shell dumpsys window displays | grep mAppBounds
   # 如 Rect(68, 0 - 1640, 688) → 所有 x 坐标要 +68
   ```

4. **输入框替换与提交**：tap 聚焦 → `input keycombination 113 29`（Ctrl+A 全选）→ `keyevent 67` 删除 → `input text ...`；**提交前先 `keyevent 4` 收键盘**，否则确定按钮被软键盘挡住，点击是假动作（表现像"提交成功"，实际配置没变——用服务器访问日志验证真到达）。

## 调试管道

```bash
# 爬虫 console.log → logcat（最有效的现场排障手段，爬虫里放心加）
adb logcat -s quickjs

# 播放事件断言：PREPARED 只是就绪，RENDERING_START 才是真的在播，两个都要有
adb logcat -d | grep -E "PREPARED|RENDERING_START"

# 前台 Activity
adb shell dumpsys activity activities | grep topResumedActivity

# Observer 的 catch 常吞堆栈 → 抓 System.err，或给 errorWithRetry/playUrl 加 Log.e 重建
adb logcat -d | grep -A20 "System.err"
```

爬虫侧调试模板（会打进 `quickjs` tag）：

```js
console.log('apiGet: ' + path + ' status=' + (res ? res.status : 'null') + ' len=' + (res && res.content ? res.content.length : 0));
```

## 静默失败速查（真机实测案例）

| 现象 | 真实原因 | 修法 |
|---|---|---|
| 配置提示"解析失败" | 极简配置无 parses/ads/ijk 字段，解析器 NPE | 播放器侧做空安全（TVBoxOSC 已修）；公开配置带最小兜底字段 |
| 详情能开、点播放闪回详情页 | ijkCodes 为空 → getIJKCodec 的 `get(0)` 越界，重试 3 次静默退出 | 无 ijk 字段时补默认软解码项 |
| play() 日志正常、无播放器日志 | 播放器错误被 catch 吞掉 | 给 errorWithRetry / playUrl 加日志重建 |
| 分类能出、列表空 | JS 加载了但 API 失败 → 看 `quickjs` tag 的 apiGet 状态码 | 签名过期 / UA / Referer / 参数缺失 |
| 手机抓不到配置 | 服务没起 / IP 变了 / nohup 被回收 | 用服务器访问日志 + curl 双向验证 |

## 验收清单（全部 ✓ 才算上线）

1. App 拉到配置，站点名出现，分类与站点一致
2. 随机 3 个分类出真实列表、翻页正常
3. 随机 3 个视频详情完整（标题/海报/线路）
4. 每条线路点播放：logcat 有 `PREPARED` **且** `RENDERING_START`，画面肉眼确认
5. 搜索出结果
