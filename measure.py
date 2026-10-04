"""Build the original and candidate Dockerfiles against identical pinned source."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import time

SOURCE = "55b4bc5a9cc1ca234610c17581acb35f31fbe842"
BEFORE = "da34233df80f6fa808ef01bb2c9a12cee1d13750"
AFTER = "91afcb2bb6dde6baa8d62a881a941422b16fcedc"
evidence = Path("evidence")
evidence.mkdir()

def blob(path):
    data = Path(path).read_bytes()
    return hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()

def output(args):
    return subprocess.check_output(args, text=True).strip()

assert output(["git", "-C", "source", "rev-parse", "HEAD"]) == SOURCE
assert blob("source/backend/Dockerfile") == BEFORE
assert blob("Dockerfile.candidate") == AFTER
shutil.copytree("source/backend", "candidate")
shutil.copyfile("Dockerfile.candidate", "candidate/Dockerfile")
report = {
    "source": SOURCE, "before_dockerfile_blob": BEFORE,
    "after_dockerfile_blob": AFTER, "docker_version": output(["docker", "--version"]),
    "scope": "Actual Docker builds and non-root runtime file access; no database, HTTP or application suite",
    "images": {},
}
node_check = """const fs=require('fs');
if (process.getuid() === 0) throw Error('root runtime');
for(const p of ['package.json','node_modules','dist/index.js']) fs.accessSync(p,fs.constants.R_OK);
console.log(JSON.stringify({uid:process.getuid(),node:process.version,cwd:process.cwd(),filesReadable:true}));"""
for name, context in [("before", "source/backend"), ("after", "candidate")]:
    command = ["docker", "build", "--progress=plain", "--tag", "payd633:" + name, context]
    started = time.monotonic()
    row = {"command": command}
    with (evidence / (name + "-build.log")).open("w") as log:
        try:
            completed = subprocess.run(command, stdout=log, stderr=subprocess.STDOUT, timeout=390)
            row["build_exit"] = completed.returncode
        except subprocess.TimeoutExpired:
            row["build_exit"] = "TIMEOUT"
    row["elapsed_seconds"] = round(time.monotonic() - started, 3)
    if row["build_exit"] == 0:
        inspected = json.loads(output(["docker", "image", "inspect", "payd633:" + name]))[0]
        row.update(size_bytes=inspected["Size"], image_id=inspected["Id"],
                   user=inspected["Config"]["User"], healthcheck=inspected["Config"].get("Healthcheck"))
        (evidence / (name + "-inspect.json")).write_text(json.dumps(inspected, indent=2) + "\n")
        (evidence / (name + "-history.txt")).write_text(output([
            "docker", "history", "--no-trunc", "payd633:" + name]) + "\n")
        runtime = subprocess.run(["docker", "run", "--rm", "--network=none", "--entrypoint", "node",
                                  "payd633:" + name, "-e", node_check], capture_output=True, text=True, timeout=30)
        row["runtime_exit"] = runtime.returncode
        row["runtime_stdout"] = runtime.stdout
        row["runtime_stderr"] = runtime.stderr
    report["images"][name] = row
    (evidence / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(name, json.dumps(row), flush=True)
if all(v.get("build_exit") == 0 for v in report["images"].values()):
    report["size_reduction_bytes"] = report["images"]["before"]["size_bytes"] - report["images"]["after"]["size_bytes"]
    report["under_200000000_bytes"] = report["images"]["after"]["size_bytes"] < 200_000_000
report["acceptance"] = (report.get("under_200000000_bytes") is True and
    report["images"]["after"].get("runtime_exit") == 0 and
    bool(report["images"]["after"].get("healthcheck")))
(evidence / "report.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report, indent=2))
raise SystemExit(0 if report["acceptance"] else 1)
