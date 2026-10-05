# Reproducible Helm image tags

The backend and frontend tags have no implicit default. Supply each enabled
component's tag as a string. The chart schema rejects empty values, `latest`,
`stable`, branch names, and numeric YAML values before installation or upgrade.
A disabled component does not need an image tag.

Accepted tags are a full 40-character lowercase commit SHA, or a SemVer release
such as `1.2.3`, `v1.2.3`, or `1.2.3-rc.1`. SemVer build metadata (`+...`) is not
accepted because `+` is not a Docker tag character. Use `--set-string` even when
a SHA happens to contain only digits. Both images normally use the same tag;
manual Helm commands may select separate published versions when necessary.

## Build once and retain the images

Run from the repository root, after choosing the registry:

```bash
export IMAGE_TAG="$(git rev-parse HEAD)"
export REGISTRY="your-registry"
docker build -t "$REGISTRY/payd-backend:$IMAGE_TAG" backend
docker build -t "$REGISTRY/payd-frontend:$IMAGE_TAG" frontend
docker push "$REGISTRY/payd-backend:$IMAGE_TAG"
docker push "$REGISTRY/payd-frontend:$IMAGE_TAG"
```

Keep this source checkout clean before building so its SHA identifies the actual
source. Publish both images before deploying. The workflow does not build images
or establish that a registry already contains them. Set registry access/pull
secrets for the cluster in the environment values.

A version-shaped tag is not intrinsically immutable: never overwrite it with a
new build. Enable immutable-tag protection in the registry and retain historical
images used by releases. If a rebuild changes image contents, publish a new
version. Do not move old SHA or release tags. The chart validates the tag format,
not registry history or the image digest.

## Install, upgrade, and inspect

Keep environment configuration in `my-values.yaml` outside version control when
it contains secrets. Configure `global.imageRegistry` with a trailing slash
(for example, `your-registry/`) and both repositories for the images published
above, together with domains, database and network settings.
For production, apply the production profile before the environment overrides:

```bash
helm upgrade --install payd charts/payd \
  --namespace payd --create-namespace \
  -f charts/payd/values-production.yaml -f my-values.yaml \
  --set-string backend.image.tag="$IMAGE_TAG" \
  --set-string frontend.image.tag="$IMAGE_TAG" \
  --atomic --wait --timeout 5m

kubectl get deployment payd-backend payd-frontend -n payd \
  -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.template.spec.containers[0].image}{"\n"}{end}'
```

Omit the production profile for staging/testnet and provide its environment values
instead. Do not use the production profile for a testnet release. Existing
releases using mutable tags must migrate to explicitly published tags; historical
revisions with mutable tags cannot be made reproducible retroactively.

## CI deployment

`.github/workflows/helm-deploy.yml` is manual-only. It does not deploy on a push
or pull request, and does not modify the existing build/test workflow.

Before enabling it, configure the named GitHub environment, its permitted
branches and required-reviewer rules as appropriate. Set these environment
secrets: `KUBE_CONFIG_DATA` (base64-encoded kubeconfig) and `HELM_VALUES` (the full
YAML environment overrides, including the existing application secrets and image
registry configuration). Optional environment variables `HELM_RELEASE` and
`HELM_NAMESPACE` default to `payd`. Never commit those secret values.

Dispatch the workflow with the environment and a tag already present for both
images. Leaving the tag blank selects the workflow run's full `GITHUB_SHA`; those
images still must have been published first. The environment named `production`
loads `values-production.yaml` before `HELM_VALUES`; other environment names use
the base chart plus `HELM_VALUES`. The same validated tag is injected into both
images with final `--set-string` arguments, so environment files cannot silently
restore a mutable tag. Jobs for the same environment are serialized without
cancelling an in-progress deployment.

## Roll back by selecting a previous tag

Choose tags recorded for a successful release and confirm that the corresponding
images still exist. Reuse the environment values for that release, including its
secrets and registry settings. Helm release metadata may contain secrets; do not
publish an unredacted `helm get values` output in tickets or logs.

```bash
export PREVIOUS_TAG="1.2.3" # Replace with an actual retained release tag or SHA.
helm upgrade payd charts/payd --namespace payd \
  -f charts/payd/values-production.yaml -f my-values.yaml \
  --set-string backend.image.tag="$PREVIOUS_TAG" \
  --set-string frontend.image.tag="$PREVIOUS_TAG" \
  --atomic --wait --timeout 5m
```

The same operation is available by dispatching CI with `image_tag` set to the
previous tag. To roll back components released separately, pass their respective
previous tags in the manual command. Review application/database compatibility
before any rollback; changing an image tag does not reverse a database migration.
