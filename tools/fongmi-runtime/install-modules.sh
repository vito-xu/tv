#!/bin/sh
# FongMi 运行时模块离线安装（arm64-v8a）
#
# 背景：FongMi 5.8 把播放/脚本引擎拆成独立 APK（包名 com.fongmi.runtime.*），
#       主 APK 只保留壳；不装模块时 JS 爬虫会报
#       com.github.catvod.utils.RuntimeModule$MissingException。
#       这里把 6 个模块一次性装好，之后换机/刷机不用再联网下载。
#
# 用法：sh install-modules.sh [设备序列号]
#   设备序列号省略时用 adb 默认设备（adb devices 里唯一在线的那台）

set -e
DIR=$(cd "$(dirname "$0")" && pwd)
SERIAL="$1"
ADB="adb"
[ -n "$SERIAL" ] && ADB="adb -s $SERIAL"

echo "== 设备 =="
$ADB devices

for apk in \
  runtime-quickjs-1.0.7-arm64-v8a.apk \
  runtime-mpv-1.0.10-arm64-v8a.apk \
  runtime-thunder-1.0.4-arm64-v8a.apk \
  runtime-python-1.1.0-arm64-v8a.apk \
  runtime-nodejs-1.0.5-arm64-v8a.apk \
  runtime-bdj-1.0.1-arm64-v8a.apk
do
  if [ ! -f "$DIR/$apk" ]; then
    echo "!! 缺少 $apk，先执行 fetch.sh"
    continue
  fi
  echo "== 安装 $apk =="
  # MIUI 会弹「继续安装」，需要手动点一下；脚本会等 60 秒
  $ADB install -r "$DIR/$apk" || echo "!! $apk 安装失败（可能需要在手机上点「继续安装」后重跑）"
done

echo "== 已安装的 FongMi 包 =="
$ADB shell pm list packages | grep -i fongmi || true

echo
echo "装完请打开 FongMi → 设置 → 模块管理，确认每项右侧是「已安装」图标（花瓣状），"
echo "然后杀掉 App 重进，JS 爬虫（如金牌影院）才会生效。"
