variable "region" {
  type    = string
  default = "us-east-1"
}
variable "allowed_ip" {
  type        = string
  description = "Please provide public IP address"
}
variable "db_name" {
  type        = string
  description = "Database name"
}
variable "db_password" {
  type        = string
  sensitive   = true
  description = "Database password"
}
