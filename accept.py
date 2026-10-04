"""Render the existing chart and compare all resources around a narrow probe fix."""
from pathlib import Path
import copy
import json
import os
import subprocess
import yaml

out = Path(os.environ['EVIDENCE'])
out.mkdir(parents=True, exist_ok=True)
key = out / 'render-only-refresh-key'
key.write_text('RENDER_ONLY_NOT_A_SIGNING_KEY')
chart = Path('charts/payd')
version = subprocess.check_output(['helm', 'version', '--short'], text=True).strip()
source = subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()

def render(name, flags=(), require_success=True):
    command = ['helm', 'template', 'payd', str(chart), '--set-file', f'backend.secrets.JWT_REFRESH_SECRET={key}', *flags]
    result = subprocess.run(command, text=True, capture_output=True)
    (out / (name + '.yaml')).write_text(result.stdout)
    (out / (name + '.stderr')).write_text(result.stderr)
    if require_success and result.returncode:
        raise RuntimeError(f'{name}: helm failed ({result.returncode}): {result.stderr}')
    return list(yaml.safe_load_all(result.stdout)) if require_success else result

def backend(documents):
    return next(d for d in documents if d and d.get('kind') == 'Deployment' and d['metadata']['name'].endswith('-backend'))

def container(documents):
    return backend(documents)['spec']['template']['spec']['containers'][0]

def probes(documents):
    c = container(documents)
    return {k: c.get(k) for k in ('startupProbe', 'livenessProbe', 'readinessProbe')}

presets = {'default': [], 'staging': ['-f', str(chart / 'values-staging.yaml')], 'production': ['-f', str(chart / 'values-production.yaml')]}
before = {name: render('before-' + name, flags) for name, flags in presets.items()}
for docs in before.values():
    p = probes(docs)
    assert p['startupProbe'] is None
    assert p['livenessProbe']['httpGet'] == {'path': '/health', 'port': 3001}
    assert p['readinessProbe']['httpGet'] == {'path': '/health', 'port': 3001}

values_path = chart / 'values.yaml'
values = values_path.read_text()
start = values.index('  healthCheck:\n')
end = values.index('  config:\n', start)
values = values[:start] + '''  healthCheck:
    startupProbe:
      httpGet:
        path: /health/live
        port: http
      periodSeconds: 5
      timeoutSeconds: 3
      failureThreshold: 60
    livenessProbe:
      httpGet:
        path: /health/live
        port: http
      initialDelaySeconds: 30
      periodSeconds: 10
      timeoutSeconds: 5
      failureThreshold: 3
    readinessProbe:
      httpGet:
        path: /health
        port: http
      initialDelaySeconds: 5
      periodSeconds: 5
      timeoutSeconds: 3
      failureThreshold: 3

''' + values[end:]
values_path.write_text(values)

template_path = chart / 'templates/backend-deployment.yaml'
template = template_path.read_text()
anchor = '          {{- with .Values.backend.healthCheck.livenessProbe }}\n'
assert template.count(anchor) == 1
template_path.write_text(template.replace(anchor, '''          {{- with .Values.backend.healthCheck.startupProbe }}
          startupProbe:
            {{- toYaml . | nindent 12 }}
          {{- end }}
''' + anchor, 1))

guide_path = chart / 'VALUES.md'
guide = guide_path.read_text()
row = '| `backend.healthCheck.livenessProbe` | Complete probe mapping copied to the backend container. |'
assert guide.count(row) == 1
guide = guide.replace(row, '| `backend.healthCheck.startupProbe` | Startup probe mapping; default checks `/health/live`, with up to 300 seconds for application startup. Set to `null` to omit it. |\n' + row, 1)
old = '''Both backend probe mappings support the supplied `httpGet.path`,
`httpGet.port`, `initialDelaySeconds`, `periodSeconds`, `timeoutSeconds` and
`failureThreshold` fields; each whole mapping is rendered as provided. The
frontend template fixes its probes to `/` on its named port 80 and does not
expose a corresponding values mapping.'''
new = '''All three backend probe mappings are rendered as configured. Startup and
liveness default to `/health/live`, the backend's dependency-independent process
check. Readiness stays on `/health`, which checks PostgreSQL, Redis and Horizon.
A dependency outage can therefore remove a ready endpoint without making that
same dependency failure trigger the routine liveness restart policy. Startup
allows up to 300 seconds (60 failures at 5-second intervals) before the normal
liveness/readiness probes take over; this is a configured allowance, not a
measured startup duration.

Default HTTP probes use the container's named `http` port, which follows
`backend.service.port`. Keep `backend.config.PORT` and ingress ports aligned
when changing that port. Each mapping supports the Kubernetes probe fields;
Helm merges environment overrides with defaults. To switch a probe to another
handler such as `exec`, explicitly set its inherited `httpGet` to `null`.
Setting the entire startup mapping to `null` omits the startup probe. The
frontend template fixes its probes to `/` on its named port 80 and does not
expose a corresponding values mapping.'''
assert guide.count(old) == 1
guide = guide.replace(old, new, 1)
guide = guide.replace('Keep `backend.config.PORT`, probe ports and ingress backend ports consistent.', 'Keep `backend.config.PORT` and ingress backend ports consistent; default probes use the named `http` port.', 1)
guide_path.write_text(guide)

after = {name: render('after-' + name, flags) for name, flags in presets.items()}
for name, docs in after.items():
    p = probes(docs)
    assert p['startupProbe'] == {'httpGet': {'path': '/health/live', 'port': 'http'}, 'periodSeconds': 5, 'timeoutSeconds': 3, 'failureThreshold': 60}
    assert p['livenessProbe']['httpGet'] == {'path': '/health/live', 'port': 'http'}
    assert p['readinessProbe']['httpGet'] == {'path': '/health', 'port': 'http'}
    expected = copy.deepcopy(before[name])
    c = container(expected)
    c['startupProbe'] = copy.deepcopy(p['startupProbe'])
    c['livenessProbe']['httpGet'] = {'path': '/health/live', 'port': 'http'}
    c['readinessProbe']['httpGet']['port'] = 'http'
    assert docs == expected, f'{name}: unrelated rendered resource changed'

custom = render('custom-port', ['--set', 'backend.service.port=8088', '--set-string', 'backend.config.PORT=8088'])
assert container(custom)['ports'][0]['containerPort'] == 8088
assert all(p['httpGet']['port'] == 'http' for p in probes(custom).values())
assert probes(render('disabled-startup', ['--set', 'backend.healthCheck.startupProbe=null']))['startupProbe'] is None
custom_probe = render('custom-startup', ['--set', 'backend.healthCheck.startupProbe.httpGet.path=/custom-start', '--set', 'backend.healthCheck.startupProbe.httpGet.port=9090', '--set', 'backend.healthCheck.startupProbe.timeoutSeconds=7'])
assert probes(custom_probe)['startupProbe']['httpGet'] == {'path': '/custom-start', 'port': 9090}
assert probes(custom_probe)['startupProbe']['timeoutSeconds'] == 7
without_backend = render('disabled-backend', ['--set', 'backend.enabled=false'])
assert not any(d and d.get('kind') == 'Deployment' and d['metadata']['name'].endswith('-backend') for d in without_backend)
missing_key = subprocess.run(['helm', 'template', 'payd', str(chart)], capture_output=True, text=True)
assert missing_key.returncode != 0 and 'JWT_REFRESH_SECRET' in missing_key.stderr
(out / 'missing-refresh.stderr').write_text(missing_key.stderr)

files = ['charts/payd/values.yaml', 'charts/payd/templates/backend-deployment.yaml', 'charts/payd/VALUES.md']
blobs = {name: subprocess.check_output(['git', 'hash-object', name], text=True).strip() for name in files}
result = {'source': source, 'helm': version, 'preset_resource_counts': {name: len([d for d in docs if d]) for name, docs in after.items()}, 'before_probes': {n: probes(d) for n, d in before.items()}, 'after_probes': {n: probes(d) for n, d in after.items()}, 'unrelated_resources_identical': True, 'controls': ['custom port 8088 via named http', 'startup null omitted', 'custom startup path/port/timeout retained', 'disabled backend omitted', 'missing refresh secret still rejected'], 'blobs': blobs}
(out / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result, indent=2))
key.unlink()
run_url = f"https://github.com/{os.environ['GITHUB_REPOSITORY']}/actions/runs/{os.environ['GITHUB_RUN_ID']}"
report = f'''# Helm backend probe acceptance — 4 October 2026

Source parent: `{source}`. Native Helm: `{version}`.
[Executed validation]({run_url}).

The unchanged chart rendered defaults, staging and production with `/health`
for liveness and no startup probe. The repaired chart renders all three presets
with startup/liveness `/health/live`, readiness `/health`, and the named `http`
container port. Every other field in every rendered Kubernetes resource was
compared structurally and remained identical, including HPA, images, environment,
Secrets, frontend, Service and ingress.

Additional native renders preserved a configured port of 8088 through the named
probe port, omitted startup when its mapping was null, preserved a custom
startup path/port/timeout, and omitted a disabled backend. Missing production
refresh-key input remained a rendering error. All render inputs used an obvious
disposable placeholder, never live credentials; no manifest was installed.

## Reproduce

The pinned validation carrier contains `accept.py`, which runs the real Helm
CLI, applies the three-file patch and compares parsed rendered resources. It
uses PyYAML only in the validation runner; the product has no new dependency.
The executed source files are identified below:

'''
for name, blob in blobs.items():
    report += f'- `{name}`: `{blob}`.\n'
report += '''
The action retains before/after manifests, errors and machine-readable results.
This establishes chart rendering and probe configuration, not a running cluster,
load result, dependency-outage experiment, deployment or bounty acceptance.
No backend health handler, authentication, secret template or frontend source
was modified. The isolated runner is not included in the product branch.
'''
(chart / 'PROBE_VALIDATION.md').write_text(report)
