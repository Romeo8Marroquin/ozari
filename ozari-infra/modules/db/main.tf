variable "environment" { type = string }

variable "vpc_id" {
  type = string
}

variable "admin_ip" {
  type = string
  description = "IP address of the admin machine"
}

variable "lambda_sg_id" {
  type = string
}

variable "public_subnet_ids" {
  type = list(string)
}

variable "db_password" {
  type      = string
  sensitive = true
}

locals {
  is_prod = lower(var.environment) == "prod"
}

resource "aws_security_group" "rds_sg" {
  name        = "ozari-${var.environment}-rds-sg"
  description = "Allow PostgreSQL access"
  vpc_id      = var.vpc_id

  ingress {
    description     = "Postgres from Lambda SG"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [var.lambda_sg_id]
  }

  ingress {
    description = "PostgreSQL from admin IP only"
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = [var.admin_ip]
  }

  egress {
    description = "No outbound traffic from RDS"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = []
  }

  tags = { Name = "ozari-${var.environment}-rds-sg" }
}

resource "aws_db_subnet_group" "rds_subnet_group" {
  name       = "ozari-${var.environment}-db-subnets"
  subnet_ids = var.public_subnet_ids

  tags = {
    Name = "ozari-${var.environment}-db-subnets"
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
  db_subnet_group_name   = aws_db_subnet_group.rds_subnet_group.name
  vpc_security_group_ids = [aws_security_group.rds_sg.id]

  skip_final_snapshot = !local.is_prod
  apply_immediately   = !local.is_prod

  tags = { Name = "ozari-${var.environment}-postgres" }
}

resource "aws_ssm_parameter" "database_url" {
  name  = "/ozari/${var.environment}/database_url"
  type  = "SecureString"
  value = "postgres://${aws_db_instance.postgres.username}:${var.db_password}@${aws_db_instance.postgres.address}:${aws_db_instance.postgres.port}/${aws_db_instance.postgres.db_name}?schema=public"
}
