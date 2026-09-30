#!/usr/bin/env bash
# Build a signed demo APK: the Vite build inside a WebView shell.
#
# Needs only a JDK (17+), Node and Python 3 — no Android SDK. The toolchain comes
# from Maven Central (dl.google.com, where the SDK lives, is often firewalled):
#   aapt2 + framework resource table  ← org.apktool:apktool-lib (prebuilt/)
#   dx (dexer)                        ← com.jakewharton.android.repackaged:dalvik-dx
#   apksig (signing)                  ← com.android.tools.build:apksig
# MainActivity compiles against android/stubs; the device supplies the real classes.
#
# Usage: npm run build:apk            → dist-android/ledgerline-glass.apk
# Env:   KEYSTORE, KEYSTORE_PASS, KEY_ALIAS to sign with your own key
#        (default: a generated demo key in android/.tools — not for distribution).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
A="$ROOT/android"
T="$A/.tools"
B="$A/build"
OUT="$ROOT/dist-android"
MIN_SDK=24
TARGET_SDK=34
M=https://repo.maven.apache.org/maven2

mkdir -p "$T" "$OUT"
rm -rf "$B" && mkdir -p "$B"/{stubs,classes,res}

fetch() { # fetch <path> <file> — verified against Maven Central's .sha1
  local url="$M/$1" f="$T/$2"
  if [[ ! -f "$f" ]]; then
    echo "↓ $2"
    curl -fsSL -o "$f.part" "$url"
    local want; want="$(curl -fsSL "$url.sha1" | cut -c1-40)"
    local got; got="$(sha1sum "$f.part" | cut -c1-40)"
    [[ "$want" == "$got" ]] || { echo "checksum mismatch for $2" >&2; rm -f "$f.part"; exit 1; }
    mv "$f.part" "$f"
  fi
}
fetch org/apktool/apktool-lib/3.0.3/apktool-lib-3.0.3.jar apktool-lib.jar
fetch com/jakewharton/android/repackaged/dalvik-dx/16.0.1/dalvik-dx-16.0.1.jar dx.jar
fetch com/android/tools/build/apksig/2.3.0/apksig-2.3.0.jar apksig.jar

if [[ ! -x "$T/aapt2" ]]; then
  (cd "$T" && unzip -o -q apktool-lib.jar prebuilt/linux/aapt2 prebuilt/android-framework.jar \
    && mv prebuilt/linux/aapt2 aapt2 && mv prebuilt/android-framework.jar android-framework.jar && rm -rf prebuilt)
  chmod +x "$T/aapt2"
fi

echo "① web build"
(cd "$ROOT" && npx tsc -b && npx vite build --logLevel warn)

echo "② resources + manifest (aapt2)"
"$T/aapt2" compile --dir "$A/res" -o "$B/res/compiled.zip"
"$T/aapt2" link -o "$B/linked.apk" \
  -I "$T/android-framework.jar" \
  --manifest "$A/AndroidManifest.xml" \
  --min-sdk-version "$MIN_SDK" --target-sdk-version "$TARGET_SDK" \
  "$B/res/compiled.zip"

echo "③ java → dex"
javac -nowarn --release 8 -d "$B/stubs" $(find "$A/stubs" -name '*.java')
javac -nowarn --release 8 -cp "$B/stubs" -d "$B/classes" $(find "$A/src" -name '*.java')
java -cp "$T/dx.jar" com.android.dx.command.Main --dex --min-sdk-version="$MIN_SDK" \
  --output="$B/classes.dex" "$B/classes"

echo "④ package (4-byte aligned)"
python3 "$A/tools/package_apk.py" "$B/linked.apk" "$B/classes.dex" "$ROOT/dist" "$B/unsigned.apk"

echo "⑤ sign (v2) + verify"
KEYSTORE="${KEYSTORE:-$T/demo.p12}"
KEYSTORE_PASS="${KEYSTORE_PASS:-ledgerline-demo}"
KEY_ALIAS="${KEY_ALIAS:-demo}"
if [[ ! -f "$KEYSTORE" ]]; then
  keytool -genkeypair -storetype PKCS12 -keystore "$KEYSTORE" -storepass "$KEYSTORE_PASS" \
    -alias "$KEY_ALIAS" -keyalg RSA -keysize 2048 -validity 10000 \
    -dname "CN=Ledgerline Glass Demo" 2>/dev/null
fi
javac -nowarn -cp "$T/apksig.jar" -d "$B" "$A/tools/SignApk.java"
# apksig's engine touches JDK-internal X.509 classes when it initialises
java --add-exports java.base/sun.security.x509=ALL-UNNAMED \
  --add-exports java.base/sun.security.pkcs=ALL-UNNAMED \
  --add-exports java.base/sun.security.util=ALL-UNNAMED \
  -cp "$T/apksig.jar:$B" SignApk "$KEYSTORE" "$KEYSTORE_PASS" "$KEY_ALIAS" \
  "$B/unsigned.apk" "$OUT/ledgerline-glass.apk" "$MIN_SDK"
python3 "$A/tools/package_apk.py" "$OUT/ledgerline-glass.apk" >/dev/null

"$T/aapt2" dump badging "$OUT/ledgerline-glass.apk" | grep -E "^(package|sdkVersion|targetSdkVersion|application-label|launchable)" || true
ls -lh "$OUT/ledgerline-glass.apk"
