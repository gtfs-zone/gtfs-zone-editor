#!/usr/bin/env bash
# Zip the fixture's .txt files into fixtures/google-extended/dist/google-extended.zip,
# ready to drop into the app's Load dialog (it only accepts .zip).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
out="$here/dist"
mkdir -p "$out"
rm -f "$out/google-extended.zip"
(cd "$here" && zip -q "$out/google-extended.zip" ./*.txt)
echo "built $out/google-extended.zip"
