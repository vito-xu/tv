# FongMi 运行时模块（离线安装）

FongMi 5.8 起，把**播放/脚本引擎**从主 APK 里拆了出去，做成独立安装的模块 APK：

| 模块 | 包名 | arm64 体积 | 作用 |
|---|---|---|---|
| QuickJS | `com.fongmi.runtime.quickjs` | 2.2 MB | JS 爬虫（金牌影院这类 `type:3` 源） |
| MPV | `com.fongmi.runtime.mpv` | 17 MB | MPV 播放内核（可选，默认 ExoPlayer） |
| Thunder | `com.fongmi.runtime.thunder` | 6.2 MB | 迅雷/磁力协议 |
| Python | `com.fongmi.runtime.python` | 27 MB | Python 爬虫 |
| Node.js | `com.fongmi.runtime.nodejs` | 48 MB | Node 爬虫 |
| BD-J | `com.fongmi.runtime.bdj` | 39 MB | 蓝光 BD-J 菜单 |

**不装模块的典型现象**（很容易误判成源坏了）：

```
com.github.catvod.utils.RuntimeModule$MissingException: QuickJS module is not installed
```

首页空白、搜索列表里没有该源，都是这个原因。纯 HTTP 源（`type:1`，如暴风资源）不受影响。

## 为什么不把模块打进主 APK

`catvod` 的 `RuntimeModule` 是按**独立包名**加载的：它检查 `com.fongmi.runtime.<id>` 是否安装、
校验 APK 签名与 `assets/runtime.json` 里的 `module/packageName/versionCode/compatibilityId`，
再把 .so 解出来加载。合并进主 APK 需要重写加载器、改插件接口、处理重复的
`libc++_shared.so` 与多套 ABI，等于改架构；而且六个模块合计 143 MB（arm64），
合并后单 ABI 主包会从 50 MB 涨到约 190 MB。上游还在持续往「模块化」方向走
（例如 "Hide MPV playback engine when its module is not installed"），逆着拆不划算。

所以正确做法是：**主 APK 保持原样，模块离线预装**。

## 用法

```bash
# 1. 下载（走 ghfast / gh-proxy 镜像，直连 GitHub 往往只有几十 KB/s）
sh fetch.sh

# 2. 装机（MIUI 会弹「继续安装」，脚本会等你在手机上点确认）
sh install-modules.sh                 # 用默认设备
sh install-modules.sh 192.168.1.104:43227   # 指定无线调试地址

# 3. 校验
adb shell pm list packages | grep fongmi
# 期望看到 com.fongmi.android.tv + 6 个 com.fongmi.runtime.*
```

装完打开 FongMi → 设置 → 模块管理，六项右侧都应是「已安装」图标（花瓣状，不是下载箭头），
然后杀掉 App 重进，JS 爬虫才会生效。

## 说明

- 仓库里只放脚本，不放 APK（合计 143 MB，不适合进 git）
- 模块版本要跟主 APK 的 `compatibilityId` 匹配；升级 FongMi 后同步执行 `fetch.sh` 更新
- 只提供 arm64-v8a；老设备（armeabi-v7a）把文件名里的 `arm64-v8a` 换成 `armeabi-v7a`
