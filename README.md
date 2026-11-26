# Food Delivery System (Node.js + Express + MongoDB)

This project runs on Kubernetes. Services communicate through Kubernetes DNS, the API gateway is the only public application entry point, and MongoDB is hosted on MongoDB Atlas.

| Microservice | Folder | Port |
|---|---|---|
| API Gateway | api-service | 8080 |
| Registration | registration-service | 8081 |
| Login | login-service | 8082 |
| Admin | admin-service | 8083 |
| Restaurant Owner | owner-service | 8084 |
| Customer | customer-service | 8085 |
| Delivery | delivery-service | 8086 |

The Kubernetes manifests are in `k8s/`. Deployment, configuration, scaling, and troubleshooting instructions are in [K8S-README.md](K8S-README.md).

## Deploy with Minikube

Prerequisites:

- Docker
- kubectl
- Minikube
- MongoDB Atlas credentials

Start and configure Minikube:

```powershell
minikube start --driver=docker --cpus=4 --memory=4096
minikube addons enable ingress
kubectl get pods -n ingress-nginx
```

Create the Kubernetes secret from the example:

```powershell
copy k8s\03-secret.yaml.example k8s\03-secret.yaml
notepad k8s\03-secret.yaml
```

Then build the service images and deploy:

```powershell
& minikube -p minikube docker-env --shell powershell | Invoke-Expression

docker build -t nsmony/api-service:v1 ./api-service
docker build -t nsmony/registration-service:v2 ./registration-service
docker build -t nsmony/login-service:v1 ./login-service
docker build -t nsmony/admin-service:v1 ./admin-service
docker build -t nsmony/owner-service:v1 ./owner-service
docker build -t nsmony/customer-service:v1 ./customer-service
docker build -t nsmony/delivery-service:v1 ./delivery-service

kubectl apply -f k8s/
```

Expose the local cluster and map the demo domain:

```powershell
minikube tunnel
```

Add `127.0.0.1 fooddelivery.com` to `C:\Windows\System32\drivers\etc\hosts`, then open `http://fooddelivery.com/health`.

In Postman, use `http://fooddelivery.com` and import `FoodDelivery_k8s.postman_collection.json`.

For Linux/macOS, build the same images and run `eval $(minikube docker-env)` before applying `kubectl apply -f k8s/`.

## Verify the deployment

```powershell
kubectl get pods,svc,ingress -n fooddelivery
kubectl get pods -n fooddelivery -o wide
kubectl logs deploy/registration-service -n fooddelivery
```

The customer and API gateway deployments run two replicas. Kubernetes load-balances traffic across the pods and replaces failed pods automatically.

## Local development without Kubernetes

Install dependencies and start each service separately:

```powershell
cd api-service
npm install
node server.js
```

Repeat in the other service folders. Configure their environment variables as required for local MongoDB Atlas and service URLs. Kubernetes is the supported deployment target for this project.
