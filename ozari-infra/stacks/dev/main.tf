terraform {
  required_version = ">= 1.13.0 < 1.14.0"
  required_providers { aws = { source = "hashicorp/aws", version = ">= 6.9.0 < 7.0.0" } }

  backend "s3" {
    bucket  = "ozari-tfstates"
    key     = "dev/terraform.tfstate"
    region  = "us-east-1"
    encrypt = true
  }
}

resource "aws_cloudwatch_log_group" "sanity" {
  name              = "/ozari/sanity"
  retention_in_days = 1
  tags = {
    Project = "ozari"
    Env     = "dev"
  }
}

output "log_group_name" {
  value = aws_cloudwatch_log_group.sanity.name
}

# provider "aws" { region = var.region }

# module "network" {
#   source   = "../../modules/network"
#   region   = var.region
#   vpc_cidr = "10.0.0.0/16"
# }

# module "db" {
#   source            = "../../modules/db"
#   region            = var.region
#   vpc_id            = module.network.vpc_id
#   public_subnet_ids = module.network.public_subnet_ids
#   allowed_ip        = var.allowed_ip
#   db_password       = var.db_password
#   db_name           = var.db_name
# }
