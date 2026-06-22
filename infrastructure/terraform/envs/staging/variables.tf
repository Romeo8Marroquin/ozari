# Variable defaults are set to current staging reality so `terraform plan` works
# even without a terraform.tfvars. Override per-value in terraform.tfvars (gitignored)
# if needed; terraform.tfvars.example documents the canonical values.

variable "project_id" {
  description = "GCP project ID."
  type        = string
  default     = "ozari-500103"
}

variable "project_number" {
  description = "GCP project number (used for IAM and resource paths)."
  type        = string
  default     = "694756660984"
}

variable "region" {
  description = "Primary GCP region for all regional resources."
  type        = string
  default     = "northamerica-south1"
}

variable "environment" {
  description = "Logical environment name."
  type        = string
  default     = "staging"
}

variable "service_name" {
  description = "Cloud Run service name. Staging is 'ozari-api' (do NOT rename to ozari-api-staging)."
  type        = string
  default     = "ozari-api"
}

variable "app_host" {
  description = "Allowed frontend origin (APP_HOST env var). No trailing slash."
  type        = string
  default     = "https://ozari-c28.pages.dev"
}

variable "node_env" {
  description = "NODE_ENV runtime value."
  type        = string
  default     = "staging"
}

variable "log_level" {
  description = "LOG_LEVEL runtime value."
  type        = string
  default     = "info"
}

variable "artifact_repository_id" {
  description = "Artifact Registry Docker repository ID."
  type        = string
  default     = "ozari-images"
}

variable "image_name" {
  description = "Container image name within the Artifact Registry repository."
  type        = string
  default     = "ozari-api"
}

variable "max_instances" {
  description = "Cloud Run maximum instance count."
  type        = number
  default     = 3
}

variable "min_instances" {
  description = "Cloud Run minimum instance count."
  type        = number
  default     = 0
}

variable "concurrency" {
  description = "Cloud Run max concurrent requests per instance."
  type        = number
  default     = 40
}

variable "timeout_seconds" {
  description = "Cloud Run request timeout in seconds. Kept at 300 for adoption (see README cleanup notes)."
  type        = number
  default     = 300
}

variable "cpu" {
  description = "Cloud Run container CPU limit."
  type        = string
  default     = "1"
}

variable "memory" {
  description = "Cloud Run container memory limit."
  type        = string
  default     = "512Mi"
}

variable "build_trigger_name" {
  description = "Cloud Build trigger name."
  type        = string
  default     = "ozari-api-dev"
}

variable "build_trigger_branch_regex" {
  description = "Branch regex that fires the Cloud Build trigger."
  type        = string
  default     = "^dev$"
}

variable "github_repository_resource" {
  description = "Fully-qualified Cloud Build 2nd-gen GitHub repository resource."
  type        = string
  default     = "projects/ozari-500103/locations/northamerica-south1/connections/ozari-github/repositories/Romeo8Marroquin-ozari"
}
