#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
SDK="${ANDROID_SDK_ROOT:-$HOME/android-sdk}"
BT="$SDK/android-14"
ANDJAR="$SDK/android-34/android.jar"
PASS="${INSPIRE_STORE_PASS:-}"
if [ -z "$PASS" ]; then
  echo "Set INSPIRE_STORE_PASS to the keystore password." >&2
  exit 1
fi
BUILD="$ROOT/build"

python3 "$ROOT/prepare_assets.py"
export APP_ROOT="$ROOT"
python3 - <<'PY'
import os
from PIL import Image
from pathlib import Path
root = Path(os.environ["APP_ROOT"])
out = root / "res/mipmap-xxxhdpi/ic_launcher.png"
out.parent.mkdir(parents=True, exist_ok=True)
candidates = [
    root.parent / "public/static/logo-mark.webp",
    root / "logo-mark.webp",
]
src = next((p for p in candidates if p.exists()), None)
if src is None:
    if not out.exists():
        Image.new("RGBA", (192, 192), (11, 79, 156, 255)).save(out)
    print("icon", out)
else:
    im = Image.open(src).convert("RGBA")
    side = max(im.size)
    canvas = Image.new("RGBA", (side, side), (11, 79, 156, 255))
    canvas.paste(im, ((side - im.width) // 2, (side - im.height) // 2), im)
    canvas.resize((192, 192), Image.Resampling.LANCZOS).save(out)
    print("icon", out, out.stat().st_size)
PY

rm -rf "$BUILD"
mkdir -p "$BUILD/classes" "$BUILD/flats"
chmod +x "$BT/aapt2" "$BT/aapt" "$BT/d8" "$BT/zipalign" "$BT/apksigner"

"$BT/aapt2" compile --dir "$ROOT/res" -o "$BUILD/flats"
"$BT/aapt2" link -o "$BUILD/base.apk" \
  -I "$ANDJAR" \
  --manifest "$ROOT/AndroidManifest.xml" \
  --min-sdk-version 24 \
  --target-sdk-version 34 \
  "$BUILD/flats"/*.flat

javac --release 8 -classpath "$ANDJAR" -d "$BUILD/classes" \
  $(find "$ROOT/src" -name '*.java')
"$BT/d8" --lib "$ANDJAR" --min-api 24 --output "$BUILD" \
  "$BUILD/classes"/com/inspireacademy/quiz/*.class

cp "$BUILD/base.apk" "$BUILD/unaligned.apk"
(
  cd "$ROOT"
  jar uf "$BUILD/unaligned.apk" assets
)
jar uf "$BUILD/unaligned.apk" -C "$BUILD" classes.dex

if [ ! -f "$ROOT/inspire-release.keystore" ]; then
  keytool -genkeypair -keystore "$ROOT/inspire-release.keystore" -alias inspire \
    -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass "$PASS" -keypass "$PASS" \
    -dname "CN=INSPIRE Academy, OU=Quiz, O=INSPIRE Academy, C=IN"
fi

"$BT/zipalign" -f -p 4 "$BUILD/unaligned.apk" "$BUILD/aligned.apk"
"$BT/apksigner" sign \
  --ks "$ROOT/inspire-release.keystore" \
  --ks-key-alias inspire \
  --ks-pass "pass:$PASS" \
  --key-pass "pass:$PASS" \
  --out "$BUILD/INSPIRE-Academy.apk" \
  "$BUILD/aligned.apk"
"$BT/apksigner" verify --verbose "$BUILD/INSPIRE-Academy.apk"
"$BT/aapt" dump badging "$BUILD/INSPIRE-Academy.apk" | head -20
ls -lh "$BUILD/INSPIRE-Academy.apk"
