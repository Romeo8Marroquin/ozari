# Ozari

**Ozari** is a modern, cloud-ready business implementation platform built using:

- ⚛️ React (Frontend)
- 🚀 Express.js (Backend)
- ☁️ AWS (Deployment & Infrastructure)
- 🐘 PostgreSQL (Database)

---

## 📦 Tech Stack

| Layer       | Technology           |
|-------------|----------------------|
| Frontend    | React + Vite + Tailwind (optional) |
| Backend     | Express.js + Node.js |
| Database    | PostgreSQL           |
| Cloud       | AWS (EC2, RDS, S3, IAM, etc.) |
| Versioning  | Git + GitHub         |
| CI/CD       | GitHub Actions (coming soon) |

---

## 🛠️ Features

- ✨ Modular React frontend
- 🔐 Secure API built with Express
- 📊 PostgreSQL for structured data
- 🌩️ Deployed on AWS with scalability in mind
- 📈 Easy to extend with microservices or serverless
- 🧪 Ready for unit and integration testing

---

## 🚀 Getting Started

### Prerequisites

- Node.js `>= 18`
- PostgreSQL `>= 14`
- AWS CLI (optional for deployment)

---

### 📁 Project Structure

---

## GitHub Secrets Configuration

The following secrets must be configured in your GitHub repository settings for CI/CD workflows:

| Secret Name | Description |
|-------------|-------------|
| `AWS_ACCESS_KEY_ID` | AWS IAM access key for deployments |
| `AWS_SECRET_ACCESS_KEY` | AWS IAM secret key for deployments |
| `APP_HOST` | Frontend domain (e.g., `https://app.ozari.com`) |
| `JWT_SECRET` | Secret key for JWT token signing |
| `JWT_REFRESH_SECRET` | Secret key for JWT refresh token signing |
| `ENCRYPTION_KEY` | Key for data encryption |
| `API_KEY` | API key for authenticating requests to the backend |

### Generating Secure Keys

Generate secure random keys for secrets using Node.js:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

---

## API Authentication

All API requests require the `x-api-key` header with a valid API key.

**Example:**
```
Header: x-api-key: your-api-key-value
```

The API key is stored in AWS SSM Parameter Store at `/ozari/{environment}/api_key`.

