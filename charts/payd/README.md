# PayD image releases

Every enabled backend/frontend deployment requires an explicit image tag. The
chart intentionally has no default image version: a release must name images
that actually exist, rather than silently use `latest` or `stable`.

## Tag strategy

Build and publish both `payd-backend` and `payd-frontend` with the full lowercase
40-character source commit SHA, or a unique SemVer release tag such as `v1.2.3`
or `1.2.3-rc.1`. Do not shorten SHAs or use branch names. Quote tags in YAML and
use `--set-string` on the command line, including all-numeric SHAs.

The schema validates final merged values, including production overrides and
CLI arguments. Disabled components do not require an image tag. Docker tags do
not allow `+`, so SemVer build metadata is not supported; use the source SHA
instead. `latest`, `stable`, empty tags and non-string values are rejected.

Tag syntax alone cannot prevent registry retagging. Enable immutable tags in
the registry, never overwrite a published SHA/version, and retain previous
images for the rollback window. Record the source commit, image digests, chart
revision and environment values with each release. A rebuild that changes the
image bytes needs a new release identity. Changing a Deployment's image tag
changes its pod template; `imagePullPolicy: Always` is not a substitute for a
new immutable tag.

## Deploy

First publish both images under the selected tag. Prepare a private
`site-values.yaml` containing your actual registry/repositories, ingress and
application configuration/secrets. The existing image template concatenates
`global.imageRegistry` and the repository name: a non-empty registry prefix
must include its trailing `/`. Image pull credentials remain in
`global.imagePullSecrets`. Do not commit site values or Kubernetes credentials.

```bash
# Use the commit whose images were built and published, not an unrelated HEAD.
IMAGE_TAG=171c74b454daba241bfb75f36d10a0a3a77a68e5
helm upgrade --install payd charts/payd --namespace payd --create-namespace \
  -f charts/payd/values-production.yaml -f site-values.yaml \
  --set-string "backend.image.tag=$IMAGE_TAG" \
  --set-string "frontend.image.tag=$IMAGE_TAG" \
  --atomic --wait --timeout 5m
```

The SHA above illustrates the format; it does not assert that these images have
been published. Use a real tag from your registry. For independently released
components, pass each component's own published tag instead.

## CI deployment and rollback

The **Deploy PayD Helm release** workflow is manual-only (`workflow_dispatch`):
it does not deploy on pushes or pull requests. After the workflow is merged to
the default branch, a maintainer selects the reviewed chart ref, the protected
GitHub environment, release, namespace and already-published `image_tag`.
Both image tags are passed explicitly to Helm, after the values files, so old
site values cannot override that selection. Helm validates the merged schema
before deployment. Runs targeting the same environment/namespace/release are
serialized, without cancelling an in-progress deployment.

Configure the selected environment with required reviewers/allowed deployment
branches and these secrets before dispatching:

- `KUBECONFIG_B64`: base64-encoded, least-privilege kubeconfig for that cluster.
- `HELM_VALUES`: private YAML site values described above.

The workflow writes those secrets to permission-restricted temporary files and
removes them on exit. It never builds/pushes images and does not print rendered
Secret manifests. Helm is pinned to v3.19.5; update that pin deliberately when
upgrading the deployment toolchain.

To roll back by image identity, re-run the workflow with the previous published
tag (or run the same CLI command with that tag). Select the previous reviewed
chart ref and matching site values too when the application requires them.
For distinct backend/frontend versions, use the CLI with the two prior tags.
Do not retag old images as `stable`. Helm release history also retains prior
values for `helm history payd -n payd` and `helm rollback payd REVISION -n payd
--wait`. Image rollback does not reverse database migrations or external state;
check compatibility before changing versions.

## Focused local check

With Helm 3 installed, from the repository root:

```bash
bash charts/payd/tests/image-tags.sh
```

This renders the actual chart with both default and production values, checks
SHA/SemVer tags in both Deployment images, and rejects missing, `latest` and
`stable` tags independently for each component. It does not contact Kubernetes
or a registry, and does not claim that any image has been published.
