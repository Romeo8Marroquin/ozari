variable "environment" { type = string }
variable "app_host" { type = string }
variable "jwt_secret" {
  type      = string
  sensitive = true
}
variable "jwt_refresh_secret" {
  type      = string
  sensitive = true
}

resource "aws_ssm_parameter" "app_host" {
  name  = "/ozari/${var.environment}/app_host"
  type  = "String"
  value = var.app_host
}

resource "aws_ssm_parameter" "jwt_secret" {
  name  = "/ozari/${var.environment}/jwt_secret"
  type  = "SecureString"
  value = var.jwt_secret
}

resource "aws_ssm_parameter" "jwt_refresh_secret" {
  name  = "/ozari/${var.environment}/jwt_refresh_secret"
  type  = "SecureString"
  value = var.jwt_refresh_secret
}
