terraform {
  required_version = ">= 1.12.0, < 1.14.0"
  required_providers { aws = { source = "hashicorp/aws", version = ">= 6.9.0, < 7.0.0" } }

  backend "s3" {
    bucket  = "ozari-tfstates"
    key     = "dev/terraform.tfstate"
    region  = "us-east-1"
    encrypt = true
    profile = "terraform-profile"
  }
}

provider "aws" {
  region  = var.region
  profile = "terraform-profile"
}

module "network" {
  source  = "../../modules/network"
  region  = var.region
  profile = "terraform-profile"
}

# module "db" {
#   source            = "../../modules/db"
#   region            = var.region
#   vpc_id            = module.network.vpc_id
#   public_subnet_ids = module.network.public_subnet_ids
#   allowed_ip        = var.allowed_ip
#   db_password       = var.db_password
#   db_name           = var.db_name
# }
