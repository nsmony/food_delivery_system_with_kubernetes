# Food Delivery System (Node.js + Express + MongoDB)

| Document name | Folder | Port | EC2 |
|---|---|---|---|
| API Gateway Microservice | api-service | 8080 | EC2-1 |
| Registration Microservice | registration-service | 8081 | EC2-1 |
| Login Microservice | login-service | 8082 | EC2-1 |
| Admin Microservice | admin-service | 8083 | EC2-2 |
| Restaurant Owner Microservice | owner-service | 8084 | EC2-2 |
| Delivery Microservice | delivery-service | 8086 | EC2-2 |
| Customer Microservice (A) | customer-service | 8085 | EC2-3 |
| Customer Microservice (B) | customer-service | 8085 | EC2-4 |

## Run on EC2
1. Install Docker, clone this repo.
2. In each service folder you run on that instance: `cp .env.example .env` and fill it in
   (same `JWT_SECRETE` in api-service and login-service, same Atlas `MONGO_URI` everywhere).
3. `docker compose -f docker-compose.ec2-N.yml up -d --build`   (N = 1, 2, 3 or 4)

## Local test (without Docker)
In every folder: `npm install && node server.js` (use localhost URLs in api-service/.env).
