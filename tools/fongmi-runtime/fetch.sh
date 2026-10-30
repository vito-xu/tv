#!/bin/sh
# 从 GitHub Release 拉取全部 FongMi 运行时模块（arm64-v8a）
# 走 ghfast 镜像，直连 GitHub 在国内常年只有几十 KB/s
set -e
DIR=$(cd "$(dirname "$0")" && pwd)
BASE="https://github.com/FongMi/Release/releases/download/module"
MIRROR="https://ghfast.top/$BASE"

for apk in \
  runtime-quickjs-1.0.7-arm64-v8a.apk \
  runtime-mpv-1.0.10-arm64-v8a.apk \
  runtime-thunder-1.0.4-arm64-v8a.apk \
  runtime-python-1.1.0-arm64-v8a.apk \
  runtime-nodejs-1.0.5-arm64-v8a.apk \
  runtime-bdj-1.0.1-arm64-v8a.apk
do
  [ -f "$DIR/$apk" ] && { echo "跳过（已存在）$apk"; continue; }
  echo "下载 $apk"
  curl -L --noproxy '*' --retry 3 -o "$DIR/$apk" "$MIRROR/$apk" \
    || curl -L --noproxy '*' --retry 3 -o "$DIR/$apk" "$BASE/$apk"
done

echo "== 完成 =="
ls -lh "$DIR"/*.apk
