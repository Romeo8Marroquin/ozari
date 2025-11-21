variable "environment" { type = string }
variable "db_password" {
  type      = string
  sensitive = true
}

locals {
  is_prod = lower(var.environment) == "prod"
}

data "aws_vpc" "default" { default = true }
data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

resource "aws_security_group" "rds_sg" {
  name        = "ozari-${var.environment}-rds-sg"
  description = "Allow PostgreSQL access"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description = "Allow Postgres from anywhere (Secured by SSL/Auth)"
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "ozari-${var.environment}-rds-sg" }
}

resource "aws_db_parameter_group" "force_ssl" {
  name   = "ozari-${var.environment}-force-ssl"
  family = "postgres18"

  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }
}

resource "aws_db_instance" "postgres" {
  identifier        = "ozari-${var.environment}-postgres"
  engine            = "postgres"
  engine_version    = "18"
  instance_class    = "db.t4g.micro"
  allocated_storage = 20
  storage_type      = "gp3"

  db_name  = "ozari${var.environment}"
  username = "postgres"
  password = var.db_password

  publicly_accessible    = true
  parameter_group_name   = aws_db_parameter_group.force_ssl.name
  vpc_security_group_ids = [aws_security_group.rds_sg.id]
  skip_final_snapshot    = !local.is_prod
  apply_immediately      = !local.is_prod
  tags                   = { Name = "ozari-${var.environment}-postgres" }
}

resource "aws_ssm_parameter" "database_url" {
  name  = "/ozari/${var.environment}/database_url"
  type  = "SecureString"
  value = "postgres://${aws_db_instance.postgres.username}:${var.db_password}@${aws_db_instance.postgres.address}:${aws_db_instance.postgres.port}/${aws_db_instance.postgres.db_name}?sslmode=require&schema=public"
}
