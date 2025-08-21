terraform {
  required_version = ">= 1.6, < 1.14"
  required_providers { aws = { source = "hashicorp/aws", version = ">= 5.0, < 7.0" } }
}

variable "region" { type = string }
variable "vpc_id" { type = string }
variable "public_subnet_ids" { type = list(string) }
variable "allowed_ip" { type = string }
variable "db_password" {
  type      = string
  sensitive = true
}
variable "db_name" {
  type    = string
  default = "OzariDev"
}

provider "aws" { region = var.region }

# SG que abre 5432 solo a tu IP
resource "aws_security_group" "rds_access" {
  name        = "dev-rds-sg"
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

  tags = { Name = "dev-rds-sg" }
}

# Subnet Group (dos subredes en distinta AZ)
resource "aws_db_subnet_group" "this" {
  name        = "dev-rds-subnet-group"
  description = "Subnets for RDS (public for dev)"
  subnet_ids  = var.public_subnet_ids
  tags        = { Name = "dev-rds-subnet-group" }
}

# RDS Postgres para dev (público y barato)
resource "aws_db_instance" "postgres" {
  identifier              = "dev-postgres"
  engine                  = "postgres"
  instance_class          = "db.t4g.micro"
  allocated_storage       = 20
  storage_type            = "gp2"
  db_name                 = var.db_name
  username                = "postgres"
  password                = var.db_password
  db_subnet_group_name    = aws_db_subnet_group.this.name
  vpc_security_group_ids  = [aws_security_group.rds_access.id]
  publicly_accessible     = true
  multi_az                = false
  backup_retention_period = 7
  deletion_protection     = false
  skip_final_snapshot     = true
  apply_immediately       = true
  tags                    = { Name = "dev-postgres" }
}

output "rds_endpoint" { value = aws_db_instance.postgres.address }
output "rds_port" { value = aws_db_instance.postgres.port }
