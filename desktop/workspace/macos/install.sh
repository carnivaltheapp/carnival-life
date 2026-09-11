#!/bin/sh
set -eu

extension_id="${1:-}"
case "$extension_id" in
  ''|*[!a-p]* )
    echo "Usage: ./install.sh <32-character Chrome extension ID>" >&2
    exit 1
    ;;
esac
if [ "${#extension_id}" -ne 32 ]; then
  echo "Usage: ./install.sh <32-character Chrome extension ID>" >&2
  exit 1
fi

host_name="com.carnival.workspace"
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
install_dir="$HOME/Library/Application Support/Carnival/DesktopWorkspace"
manifest_dir="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
host_executable="$install_dir/CarnivalWorkspaceHost"
manifest_path="$manifest_dir/$host_name.json"

mkdir -p "$install_dir" "$manifest_dir"
swiftc -framework AppKit "$script_dir/CarnivalWorkspaceHost.swift" -o "$host_executable"
chmod 755 "$host_executable"

cat > "$manifest_path" <<EOF
{
  "name": "$host_name",
  "description": "Carnival hot-corner desktop companion",
  "path": "$host_executable",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$extension_id/"]
}
EOF

echo "Installed $host_name for Chrome extension $extension_id."
echo "Restart Chrome to activate the companion."
