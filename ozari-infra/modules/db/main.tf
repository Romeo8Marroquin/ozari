variable "environment" { type = string }

variable "vpc_id" {
  type = string
}

variable "admin_ip" {
  type        = string
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

variable "allow_migrations_from_github" {
  type        = bool
  default     = false
  description = "Temporarily allow GitHub Actions to access RDS for migrations"
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
    description = "PostgreSQL from admin IP"
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = [var.admin_ip]
  }

  # Temporary access for migrations from GitHub Actions
  dynamic "ingress" {
    for_each = var.allow_migrations_from_github ? [1] : []
    content {
      description = "Temporary: PostgreSQL from GitHub Actions for migrations"
      from_port   = 5432
      to_port     = 5432
      protocol    = "tcp"
      cidr_blocks = ["0.0.0.0/0"]
    }
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

  publicly_accessible                 = true
  db_subnet_group_name                = aws_db_subnet_group.rds_subnet_group.name
  vpc_security_group_ids              = [aws_security_group.rds_sg.id]
  iam_database_authentication_enabled = true # Use IAM instead of passwords
  enabled_cloudwatch_logs_exports     = ["postgresql", "upgrade"]
  deletion_protection                 = true
  ca_cert_identifier                  = "rds-ca-rsa2048-g1"

  skip_final_snapshot = !local.is_prod
  apply_immediately   = !local.is_prod

  tags = { Name = "ozari-${var.environment}-postgres" }
}

resource "aws_cloudwatch_metric_alarm" "rds_connections" {
  alarm_name          = "rds-connection-spike"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "DatabaseConnections"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = 10
  alarm_description   = "Alert on unusual connection count"
}

resource "aws_ssm_parameter" "database_url" {
  name  = "/ozari/${var.environment}/database_url"
  type  = "SecureString"
  value = "postgresql://${aws_db_instance.postgres.username}:${var.db_password}@${aws_db_instance.postgres.address}:${aws_db_instance.postgres.port}/${aws_db_instance.postgres.db_name}?schema=public&sslmode=require"
}
