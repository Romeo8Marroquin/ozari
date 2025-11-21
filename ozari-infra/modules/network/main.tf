variable "environment" {
  type = string
}

data "aws_availability_zones" "available" {
  state = "available"
}

resource "aws_vpc" "this" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = {
    Name = "ozari-${var.environment}-vpc"
  }
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id

  tags = {
    Name = "ozari-${var.environment}-igw"
  }
}

resource "aws_subnet" "public" {
  count                   = 2
  vpc_id                  = aws_vpc.this.id
  cidr_block              = cidrsubnet(aws_vpc.this.cidr_block, 8, count.index)
  availability_zone       = data.aws_availability_zones.available.names[count.index]
  map_public_ip_on_launch = true

  tags = {
    Name = "ozari-${var.environment}-public-${count.index + 1}"
  }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.this.id
  }

  tags = {
    Name = "ozari-${var.environment}-public-rt"
  }
}

resource "aws_route_table_association" "public" {
  count          = length(aws_subnet.public)
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_security_group" "lambda_sg" {
  name        = "ozari-${var.environment}-lambda-sg"
  description = "Security group for Lambda functions"
  vpc_id      = aws_vpc.this.id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "ozari-${var.environment}-lambda-sg"
  }
}

resource "aws_ssm_parameter" "lambda_sg_id" {
  name  = "/ozari/${var.environment}/lambda_sg_id"
  type  = "String"
  value = aws_security_group.lambda_sg.id
}

resource "aws_ssm_parameter" "lambda_subnet_1" {
  name  = "/ozari/${var.environment}/lambda_subnet_1"
  type  = "String"
  value = aws_subnet.public[0].id
}

resource "aws_ssm_parameter" "lambda_subnet_2" {
  name  = "/ozari/${var.environment}/lambda_subnet_2"
  type  = "String"
  value = aws_subnet.public[1].id
}

output "vpc_id" {
  value = aws_vpc.this.id
}

output "lambda_sg_id" {
  value = aws_security_group.lambda_sg.id
}

output "public_subnet_ids" {
  value = [for s in aws_subnet.public : s.id]
}
