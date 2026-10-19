#!/bin/sh
# Registers the Chrome Design voice bridge with Chrome (macOS), so the extension's voice link
# can start it. Run once, and again if you move this folder or change Node.
#
#   bridge/install.sh <extension id> [chrome|chromium|brave|edge|arc]
#
# The extension id is on chrome://extensions (Developer mode → Chrome Design → ID).
# To remove: bridge/install.sh --uninstall [browser]
set -eu

HOST=com.silverlightstudios.chrome_design.voice
HERE="$(cd "$(dirname "$0")" && pwd)"

if [ "${1:-}" = "--uninstall" ]; then UNINSTALL=1; shift; else UNINSTALL=0; fi
if [ "$UNINSTALL" = 0 ]; then
  ID="${1:-}"
  if [ -z "$ID" ]; then
    echo "usage: $0 <extension id> [chrome|chromium|brave|edge|arc]" >&2
    exit 2
  fi
  shift
fi
BROWSER="${1:-chrome}"
SUPPORT="$HOME/Library/Application Support"
case "$BROWSER" in
  chrome) DIR="$SUPPORT/Google/Chrome/NativeMessagingHosts" ;;
  chromium) DIR="$SUPPORT/Chromium/NativeMessagingHosts" ;;
  brave) DIR="$SUPPORT/BraveSoftware/Brave-Browser/NativeMessagingHosts" ;;
  edge) DIR="$SUPPORT/Microsoft Edge/NativeMessagingHosts" ;;
  arc) DIR="$SUPPORT/Arc/User Data/NativeMessagingHosts" ;;
  *) echo "unknown browser: $BROWSER" >&2; exit 2 ;;
esac

if [ "$UNINSTALL" = 1 ]; then
  rm -f "$DIR/$HOST.json" "$HOME/.chrome-design/voice-bridge"
  echo "Removed the voice bridge from $BROWSER."
  exit 0
fi

NODE="$(command -v node || true)"
if [ -z "$NODE" ]; then
  echo "Node.js is needed (brew install node)." >&2
  exit 1
fi

# Chrome starts hosts with a bare PATH, so the wrapper names Node by its full path.
mkdir -p "$HOME/.chrome-design"
WRAPPER="$HOME/.chrome-design/voice-bridge"
cat > "$WRAPPER" <<SH
#!/bin/sh
exec "$NODE" "$HERE/host.mjs" "\$@"
SH
chmod 755 "$WRAPPER"

mkdir -p "$DIR"
cat > "$DIR/$HOST.json" <<JSON
{
  "name": "$HOST",
  "description": "Chrome Design voice link",
  "path": "$WRAPPER",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$ID/"]
}
JSON
echo "Installed the voice bridge for $BROWSER ($DIR/$HOST.json)."
echo "Now turn on Chrome Design → Settings → Voice recorder."
