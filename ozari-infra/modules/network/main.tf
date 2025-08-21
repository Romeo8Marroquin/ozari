terraform {
  required_version = ">= 1.12.0, < 1.14.0"
  required_providers { aws = { source = "hashicorp/aws", version = ">= 6.9.0, < 7.0.0" } }
}

variable "environment" { type = string }
variable "region" { type = string }
variable "profile" { type = string }
variable "vpc_cidr" {
  type    = string
  default = "10.0.0.0/16"
}

provider "aws" {
  region  = var.region
  profile = var.profile
}

data "aws_availability_zones" "this" { state = "available" }

resource "aws_vpc" "this" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = { Name = "ozari-${var.environment}-vpc" }
}

resource "aws_internet_gateway" "igw" {
  vpc_id = aws_vpc.this.id
  tags   = { Name = "ozari-${var.environment}-igw" }
}

resource "aws_subnet" "public_a" {
  vpc_id                  = aws_vpc.this.id
  cidr_block              = "10.0.1.0/24"
  availability_zone       = data.aws_availability_zones.this.names[0]
  map_public_ip_on_launch = true
  tags                    = { Name = "ozari-${var.environment}-public-a" }
}

resource "aws_subnet" "public_b" {
  vpc_id                  = aws_vpc.this.id
  cidr_block              = "10.0.2.0/24"
  availability_zone       = data.aws_availability_zones.this.names[1]
  map_public_ip_on_launch = true
  tags                    = { Name = "ozari-${var.environment}-public-b" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id
  tags   = { Name = "ozari-${var.environment}-rt-public" }
}

resource "aws_route" "internet" {
  route_table_id         = aws_route_table.public.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.igw.id
}

resource "aws_route_table_association" "a" {
  subnet_id      = aws_subnet.public_a.id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table_association" "b" {
  subnet_id      = aws_subnet.public_b.id
  route_table_id = aws_route_table.public.id
}

output "vpc_id" { value = aws_vpc.this.id }
output "public_subnet_ids" { value = [aws_subnet.public_a.id, aws_subnet.public_b.id] }
