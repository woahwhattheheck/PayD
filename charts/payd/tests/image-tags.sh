#!/usr/bin/env bash
# Local rendering only: no Kubernetes or registry access is needed.
set -euo pipefail
chart=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
workdir=$(mktemp -d)
trap 'rm -rf -- "$workdir"' EXIT
sha=171c74b454daba241bfb75f36d10a0a3a77a68e5

for profile in default production; do
  values=()
  if [[ "$profile" == production ]]; then
    values=(-f "$chart/values-production.yaml")
  fi
  for tag in "$sha" v1.2.3-rc.1; do
    helm template tag-check "$chart" "${values[@]}" \
      --set-string "backend.image.tag=$tag" \
      --set-string "frontend.image.tag=$tag" > "$workdir/rendered.yaml"
    grep -Fq "payd-backend:$tag\"" "$workdir/rendered.yaml"
    grep -Fq "payd-frontend:$tag\"" "$workdir/rendered.yaml"
  done
  # Each enabled component is independently required to use an immutable tag.
  for component in backend frontend; do
    for tag in '' latest stable; do
      if helm template tag-check "$chart" "${values[@]}" \
        --set-string "backend.image.tag=$sha" \
        --set-string "frontend.image.tag=$sha" \
        --set-string "$component.image.tag=$tag" \
        > "$workdir/error.log" 2>&1; then
        echo "Unexpectedly accepted $profile $component tag '$tag'" >&2
        exit 1
      fi
      grep -q 'tag' "$workdir/error.log"
    done
  done
done
printf 'Image-tag rendering checks passed.\n'
