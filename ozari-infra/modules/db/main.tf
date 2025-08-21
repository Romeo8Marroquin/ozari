terraform {
  required_version = ">= 1.12.0, < 1.14.0"
  required_providers { aws = { source = "hashicorp/aws", version = ">= 6.9.0, < 7.0.0" } }
}

variable "environment" { type = string }
variable "region" { type = string }
variable "profile" { type = string }
variable "vpc_id" { type = string }
variable "public_subnet_ids" { type = list(string) }
variable "allowed_ip" { type = string }
variable "db_name" { type = string }
variable "db_password" {
  type      = string
  sensitive = true
}

locals {
  is_prod = lower(var.environment) == "prod"
}

provider "aws" {
  region  = var.region
  profile = var.profile
}

resource "aws_security_group" "rds_access" {
  name        = "ozari-${var.environment}-rds-sg"
  description = "Allow psql from developer IP"
  vpc_id      = var.vpc_id

  ingress {
    description = "Postgres"
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = [var.allowed_ip]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "ozari-${var.environment}-rds-sg" }
}

resource "aws_db_subnet_group" "this" {
  name        = "ozari-${var.environment}-rds-subnet-group"
  description = "Subnets for RDS"
  subnet_ids  = var.public_subnet_ids
  tags        = { Name = "ozari-${var.environment}-rds-subnet-group" }
}

resource "aws_db_instance" "postgres" {
  identifier              = "ozari-${var.environment}-postgres"
  engine                  = "postgres"
  instance_class          = "db.t4g.micro"
  allocated_storage       = 20
  storage_type            = "gp2"
  db_name                 = var.db_name
  username                = "postgres"
  password                = var.db_password
  db_subnet_group_name    = aws_db_subnet_group.this.name
  vpc_security_group_ids  = [aws_security_group.rds_access.id]
  publicly_accessible     = !local.is_prod
  multi_az                = local.is_prod
  backup_retention_period = local.is_prod ? 7 : 0
  deletion_protection     = local.is_prod
  skip_final_snapshot     = !local.is_prod
  apply_immediately       = !local.is_prod
  tags                    = { Name = "ozari-${var.environment}-postgres" }
}

output "rds_endpoint" { value = aws_db_instance.postgres.address }
output "rds_port" { value = aws_db_instance.postgres.port }
