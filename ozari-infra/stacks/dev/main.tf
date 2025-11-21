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
  profile = var.profile
}

module "kms" {
  source      = "../../modules/kms"
  environment = var.environment
}

module "db" {
  count       = var.deploy_local ? 0 : 1
  source      = "../../modules/db"
  db_password = var.db_password
  environment = var.environment
}

module "ssm" {
  count              = var.deploy_local ? 0 : 1
  source             = "../../modules/ssm"
  environment        = var.environment
  app_host           = var.app_host
  jwt_secret         = var.jwt_secret
  jwt_refresh_secret = var.jwt_refresh_secret
}
