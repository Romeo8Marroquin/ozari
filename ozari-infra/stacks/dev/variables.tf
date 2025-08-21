variable "region" {
  type    = string
  default = "us-east-1"
}
variable "allowed_ip" {
  type        = string
  description = "Tu IP /32"
}
variable "db_password" {
  type      = string
  sensitive = true
}
variable "db_name" {
  type    = string
  default = "OzariDev"
}
