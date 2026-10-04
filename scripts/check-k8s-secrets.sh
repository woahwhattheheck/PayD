#!/usr/bin/env bash
#
# check-k8s-secrets.sh — verify that k8s/base/backend-secret.yaml contains
# only the expected CHANGE_ME placeholders and no real secret values.
#
# Exit codes:
#   0 — file is clean (only placeholders)
#   1 — file contains values that are NOT known placeholders (possible leak)
#   2 — file not found or parse error
#
# Usage:
#   ./scripts/check-k8s-secrets.sh          # standalone
#   # Also wired into .husky/pre-commit and .github/workflows/secrets-check.yml

set -euo pipefail

SECRET_FILE="k8s/base/backend-secret.yaml"

if [[ ! -f "$SECRET_FILE" ]]; then
  echo "ERROR: $SECRET_FILE not found."
  exit 2
fi

# Allowed placeholder values. Any stringData value not in this set is flagged.
ALLOWED_VALUES=(
  "CHANGE_ME"
  "CHANGE_ME_TO_A_SECURE_RANDOM_STRING"
  "postgresql://payd_user:CHANGE_ME@postgres:5432/payd_db"
  "payd_user"
)

# Read the expected flat stringData mapping. Unsupported syntax fails closed
# instead of silently stopping before an entry that the checker must inspect.
values=$(python3 - "$SECRET_FILE" <<'PY'
from pathlib import Path
import re
import sys

try:
    content = Path(sys.argv[1]).read_text()
except (OSError, UnicodeError):
    sys.exit(2)

lines = content.splitlines()
headers = [
    i for i, line in enumerate(lines)
    if re.fullmatch(r'stringData:[ \t]*(?:#.*)?', line)
]
if len(headers) != 1 or re.search(r'^[ \t]*(?:data|"data"|\'data\')[ \t]*:', content, re.MULTILINE):
    sys.exit(2)

# This guard supports one Secret document, not lists or nested Secret objects.
for line in lines[:headers[0]]:
    if not line.strip() or line.lstrip().startswith('#'):
        continue
    if line.startswith((' ', '\t')):
        if re.match(r'^[ \t]*(?:stringData|"stringData"|\'stringData\')[ \t]*:', line):
            sys.exit(2)
        continue
    if not re.fullmatch(r'(?:apiVersion:[ \t]+v1|kind:[ \t]+Secret|metadata:[ \t]*|type:[ \t]+Opaque)(?:[ \t]+#.*)?', line):
        sys.exit(2)

values = []
keys = set()
indent = None
for line in lines[headers[0] + 1:]:
    if not line.strip() or line.lstrip().startswith('#'):
        continue
    entry = re.fullmatch(r'( +)([A-Za-z0-9_.-]+):[ \t]*(.*)', line)
    if not entry:
        sys.exit(2)
    spaces, key, value = entry.groups()
    if indent is None:
        indent = len(spaces)
    if len(spaces) != indent or key in keys:
        sys.exit(2)
    keys.add(key)
    value = value.strip()
    if value.startswith('"') or value.endswith('"'):
        if len(value) < 2 or not (value.startswith('"') and value.endswith('"')) or '"' in value[1:-1]:
            sys.exit(2)
        value = value[1:-1]
    values.append(value)

if not values:
    sys.exit(2)
print('\n'.join(values))
PY
)

if [[ -z "$values" ]]; then
  echo "ERROR: Could not parse stringData values from $SECRET_FILE"
  exit 2
fi

failed=0
while IFS= read -r value; do
  matched=0
  for allowed in "${ALLOWED_VALUES[@]}"; do
    if [[ "$value" == "$allowed" ]]; then
      matched=1
      break
    fi
  done
  if [[ $matched -eq 0 ]]; then
    echo "FAIL: $SECRET_FILE contains a non-placeholder value."
    echo "      Real secrets must not be committed. See k8s/README.md for safe alternatives."
    failed=1
  fi
done <<< "$values"

if [[ $failed -eq 1 ]]; then
  exit 1
fi

echo "OK: $SECRET_FILE contains only placeholder values."
exit 0
