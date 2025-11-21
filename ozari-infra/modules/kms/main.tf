variable "environment" {
  type = string
}

resource "aws_kms_key" "this" {
  description             = "KMS key for Ozari API secrets encryption"
  deletion_window_in_days = 10
  enable_key_rotation     = true
  tags = {
    Name        = "ozari-api-key-${var.environment}"
    Environment = var.environment
  }
}

resource "aws_kms_alias" "this" {
  name          = "alias/ozari-key-${var.environment}"
  target_key_id = aws_kms_key.this.id
}

data "aws_caller_identity" "current" {}

resource "aws_kms_key_policy" "this" {
  key_id = aws_kms_key.this.id
  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        Sid    = "Key Administrator (Terraform Executer)",
        Effect = "Allow",
        Principal = {
          AWS = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"
        },
        Action   = "kms:*",
        Resource = "*"
      },
    ]
  })
}

resource "aws_ssm_parameter" "kms_key_arn" {
  name  = "/ozari/${var.environment}/kms_key_arn"
  type  = "String"
  value = aws_kms_key.this.arn
}
