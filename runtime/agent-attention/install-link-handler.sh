#!/bin/zsh
set -euo pipefail

script_dir=${0:A:h}
source_dir="$script_dir/link-handler"
app_dir="$HOME/Applications/Agent Attention Link.app"
contents_dir="$app_dir/Contents"
macos_dir="$contents_dir/MacOS"
register_bin="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"

mkdir -p "$macos_dir"
swiftc -parse-as-library "$source_dir/main.swift" -o "$macos_dir/AgentAttentionLink"
cp "$source_dir/Info.plist" "$contents_dir/Info.plist"
chmod 755 "$macos_dir/AgentAttentionLink"
"$register_bin" -f "$app_dir"
printf '{"status":"installed","app":"%s","scheme":"agent-attention"}\n' "$app_dir"
