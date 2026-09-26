#!/usr/bin/env bash
# Keep plaintext Kubernetes Secrets out of the deployable base.
set -euo pipefail

python3 - <<'PY'
from pathlib import Path
import re
import sys

base = Path('k8s/base')
if not base.is_dir():
    sys.exit('ERROR: k8s/base is missing')

bad = []
if (base / 'backend-secret.yaml').exists():
    bad.append(base / 'backend-secret.yaml')

for path in (*base.rglob('*.yaml'), *base.rglob('*.yml')):
    text = path.read_text()
    if re.search(r'^\s*kind:\s*Secret\s*(?:#.*)?$', text, re.MULTILINE):
        bad.append(path)

if bad:
    print('ERROR: plaintext Secret manifest in k8s/base:')
    for path in sorted(set(bad)):
        print(f'  {path}')
    sys.exit(1)

print('OK: k8s/base contains no plaintext Secret manifest')
PY
