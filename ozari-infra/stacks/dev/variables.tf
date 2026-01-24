variable "deploy_local" {
  type        = bool
  default     = false
  description = "Set to true to skip deploying the database and SSM secrets for local development."
}
variable "region" {
  type    = string
  default = "us-east-1"
}
variable "profile" {
  type    = string
  default = null
}
variable "environment" { type = string }
variable "db_password" {
  type      = string
  sensitive = true
}
variable "admin_ip" {
  type = string
}

variable "app_host" { type = string }
variable "jwt_secret" {
  type      = string
  sensitive = true
}
variable "jwt_refresh_secret" {
  type      = string
  sensitive = true
}
variable "encryption_key" {
  type      = string
  sensitive = true
}
