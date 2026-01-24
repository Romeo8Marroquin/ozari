terraform {
  required_version = ">= 1.12.0, < 1.14.0"
  required_providers { aws = { source = "hashicorp/aws", version = ">= 6.9.0, < 7.0.0" } }

  backend "s3" {
    bucket  = "ozari-tfstates"
    key     = "dev/terraform.tfstate"
    region  = "us-east-1"
    encrypt = true
    profile = "default"
  }
}

provider "aws" {
  region  = var.region
  profile = var.profile != null ? var.profile : null
}

module "ssm" {
  source             = "../../modules/ssm"
  environment        = var.environment
  app_host           = var.app_host
  jwt_secret         = var.jwt_secret
  jwt_refresh_secret = var.jwt_refresh_secret
  encryption_key     = var.encryption_key
}

module "network" {
  count       = var.deploy_local ? 0 : 1
  source      = "../../modules/network"
  environment = var.environment
}

module "db" {
  count             = var.deploy_local ? 0 : 1
  source            = "../../modules/db"
  db_password       = var.db_password
  environment       = var.environment
  vpc_id            = module.network[0].vpc_id
  public_subnet_ids = module.network[0].public_subnet_ids
  lambda_sg_id      = module.network[0].lambda_sg_id
  admin_ip          = var.admin_ip
}
