# Food Delivery System on Kubernetes (Minikube)

All services run as Deployments behind ClusterIP Services. A fanout Ingress for `fooddelivery.com` sends every
request to the API Gateway, which checks the JWT and role and forwards to the microservices.
Data is stored in MongoDB Atlas (cloud). Logs go to a shared Kubernetes volume.

## 1. One-time setup
```powershell
minikube start --driver=docker --cpus=4 --memory=4096
minikube addons enable ingress
kubectl get pods -n ingress-nginx          # wait until the controller is Running
```

## 2. Create the secret (never commit it)
```powershell
copy k8s\03-secret.yaml.example k8s\03-secret.yaml
notepad k8s\03-secret.yaml                  # fill in MONGO_URI and JWT_SECRETE
```
Generate a secret: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`

MongoDB Atlas > Network Access must allow your connection (use `0.0.0.0/0` for the demo).

## 3. Build the images and deploy
```powershell
./deploy.ps1          # Windows (Linux/Mac: ./deploy.sh)
```
The script builds each image inside Minikube's Docker, then runs `kubectl apply -f k8s/`.

## 4. Map the domain
With the Docker driver on Windows/Mac, keep this running in an Administrator terminal:
```powershell
minikube tunnel
```
Add this line to `C:\Windows\System32\drivers\etc\hosts` (open Notepad as Administrator):
```
127.0.0.1 fooddelivery.com
```
(Other drivers: use the output of `minikube ip` instead of 127.0.0.1.)

Test: `curl.exe http://fooddelivery.com/health` should return `{"status":"ok"}`.
In Postman use `http://fooddelivery.com` as the base URL and import `FoodDelivery_k8s.postman_collection.json`.

## 5. Demonstrate each guideline
| Guideline | Command / evidence |
|---|---|
| 1. YAML only | `kubectl apply -f k8s/` and the files in `k8s/` |
| 2. Several pods | `kubectl get pods -n fooddelivery -o wide` |
| 3. Only the gateway is reachable | `kubectl get svc -n fooddelivery` (all ClusterIP); `kubectl get ingress -n fooddelivery` (only `api-gateway` as backend) |
| 4. Cloud database | `kubectl logs deploy/registration-service -n fooddelivery` shows "MongoDB connected" (Atlas); no database pod exists |
| 5. Fanout DNS | `kubectl describe ingress fooddelivery-fanout -n fooddelivery`, then call `http://fooddelivery.com/...` |
| 6. Volume shared by containers | `kubectl get pvc -n fooddelivery`; `kubectl logs deploy/log-reader -n fooddelivery`; `kubectl exec deploy/customer-service -n fooddelivery -- ls -l /var/log/app` |
| 7. Minikube | `minikube status` |

Load balancing: send `GET http://fooddelivery.com/customer/instance-info` about 10 times. The two Customer pods
answer; the `instance` field shows the pod name. (kube-proxy spreads new connections roughly evenly, not in strict turns.)
Failover: `kubectl delete pod <one customer pod> -n fooddelivery` and keep calling; the other pod answers
while Kubernetes starts a replacement.

## 6. After changing code
```powershell
./deploy.ps1
kubectl rollout restart deployment/<name> -n fooddelivery
```

## 7. Optional: block direct pod access
`minikube start --driver=docker --cni=calico`, then `kubectl apply -f k8s/optional/`.
The microservices then accept traffic only from the gateway pods.

## Troubleshooting
| Symptom | Cause / fix |
|---|---|
| `ImagePullBackOff` or `ErrImageNeverPull` | The images were built outside Minikube's Docker. Run `deploy.ps1` again. |
| `CreateContainerConfigError` | `k8s/03-secret.yaml` is missing or not applied. |
| Pods restart, logs show MongoDB timeout | Atlas Network Access blocks you; check username and password in the URI. |
| `404 Not Found` from nginx | The path is not in `k8s/20-ingress.yaml`. |
| `fooddelivery.com` does not open | `minikube tunnel` is not running, or the hosts entry is missing. |
| Logs empty on the volume | `kubectl logs deploy/log-reader -n fooddelivery`; send a few requests first (health probes are not logged). |
