#!/bin/sh
# Postgres runs init files in name order on a fresh volume. The health check
# waits for this final marker so the API cannot race the schema and seed SQL.
set -eu
touch /var/lib/postgresql/data/.staging-seed-ready
