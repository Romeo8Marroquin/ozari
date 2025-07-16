terraform {
  required_providers {
    null = {
      source  = "hashicorp/null"
      version = "~> 3.1"
    }
  }
}

resource "null_resource" "hello_world" {
  provisioner "local-exec" {
    command = "echo '¡Hello World from Terraform!'"
  }
}
