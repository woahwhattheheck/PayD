{{/*
Expand the name of the chart.
*/}}
{{- define "payd.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "payd.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Service names are DNS labels (63 characters including the component suffix).
Keep existing valid names unchanged. Hash only overlong names so truncation
retains both the component and a stable distinction between long overrides.
Pass dict "root" $ "component" "backend" (or "frontend").
*/}}
{{- define "payd.serviceName" -}}
{{- $base := include "payd.fullname" .root -}}
{{- $suffix := printf "-%s" .component -}}
{{- $name := printf "%s%s" $base $suffix -}}
{{- if le (len $name) 63 -}}
{{- $name -}}
{{- else -}}
{{- $prefixLength := sub 54 (len $suffix) | int -}}
{{- printf "%s-%s%s" ($base | trunc $prefixLength | trimSuffix "-") ($base | sha256sum | trunc 8) $suffix -}}
{{- end -}}
{{- end }}

{{/*
Common labels
*/}}
{{- define "payd.labels" -}}
helm.sh/chart: {{ include "payd.name" . }}-{{ .Chart.Version }}
{{ include "payd.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "payd.selectorLabels" -}}
app.kubernetes.io/name: {{ include "payd.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Backend selector labels
*/}}
{{- define "payd.backend.selectorLabels" -}}
{{ include "payd.selectorLabels" . }}
app.kubernetes.io/component: backend
{{- end }}

{{/*
Frontend selector labels
*/}}
{{- define "payd.frontend.selectorLabels" -}}
{{ include "payd.selectorLabels" . }}
app.kubernetes.io/component: frontend
{{- end }}
