require('dotenv').config();
const express = require('express');
const app = express();

// request logging to a file on the shared Kubernetes volume (only when LOG_DIR is set)
if (process.env.LOG_DIR) {
    const fs = require('fs');
    const logFile = `${process.env.LOG_DIR}/${process.env.SERVICE_NAME || 'service'}-${require('os').hostname()}.log`;
    try { fs.mkdirSync(process.env.LOG_DIR, { recursive: true }); } catch (e) { console.error('Log dir error:', e.message); }
    app.use((req, res, next) => {
        res.on('finish', () => {
            if (req.originalUrl === '/health') return; // skip Kubernetes probes
            fs.appendFile(logFile, `${new Date().toISOString()} ${req.method} ${req.originalUrl} ${res.statusCode}\n`, () => {});
        });
        next();
    });
}

// USE PROXY SERVER TO REDIRECT THE INCOMING REQUEST
const httpProxy = require('http-proxy');
const proxy = httpProxy.createProxyServer();

const jwt = require('jsonwebtoken');
const JWT_SECRETE = process.env.JWT_SECRETE;

const REGISTRATION_URL = process.env.REGISTRATION_URL;
const LOGIN_URL = process.env.LOGIN_URL;
const ADMIN_URL = process.env.ADMIN_URL;
const OWNER_URL = process.env.OWNER_URL;
const DELIVERY_URL = process.env.DELIVERY_URL;
// customer is forwarded to the customer-service ClusterIP Service,
// which load balances across the Customer pods (kube-proxy)
const CUSTOMER_URL = process.env.CUSTOMER_URL;

// Never trust identity headers coming from the client
app.use((req, res, next) => {
    delete req.headers['x-user-id'];
    delete req.headers['x-user-role'];
    next();
});

function authToken(req, res, next) {
    const header = req?.headers.authorization;
    const token = header && header.split(' ')[1];

    if (token == null) return res.status(401).json({ message: 'Please send token' });

    jwt.verify(token, JWT_SECRETE, (err, user) => {
        if (err) return res.status(403).json({ message: 'Invalid token' });
        req.user = user;
        // pass the verified identity on to the microservice
        req.headers['x-user-id'] = String(user.id);
        req.headers['x-user-role'] = user.role;
        next();
    });
}

function authRole(role) {
    return (req, res, next) => {
        if (req.user.role !== role) {
            return res.status(403).json({ message: 'Unauthorized' });
        }
        next();
    };
}

// plain proxy to one microservice (keeps the full path, e.g. /admin/users)
const forward = target => (req, res) => {
    req.url = req.originalUrl;
    proxy.web(req, res, { target }, () => {
        if (!res.headersSent) res.status(502).json({ message: 'Service unavailable' });
    });
};

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// PUBLIC ROUTES
app.post('/register', forward(REGISTRATION_URL));
app.get('/register/check-email', forward(REGISTRATION_URL));
app.post('/login', forward(LOGIN_URL));

// ANY LOGGED-IN USER
app.use('/users/profile', authToken, forward(LOGIN_URL));
app.use('/login/validate', authToken, forward(LOGIN_URL));
app.use('/login/change-password', authToken, forward(LOGIN_URL));

// ROLE BASED ROUTES
app.use('/admin', authToken, authRole('admin'), (req, res) => {
    console.log('INSIDE API GATEWAY ADMIN ROUTE');
    forward(ADMIN_URL)(req, res);
});
app.use('/owner', authToken, authRole('owner'), (req, res) => {
    console.log('INSIDE API GATEWAY OWNER ROUTE');
    forward(OWNER_URL)(req, res);
});
app.use('/delivery', authToken, authRole('delivery'), (req, res) => {
    console.log('INSIDE API GATEWAY DELIVERY ROUTE');
    forward(DELIVERY_URL)(req, res);
});
app.use('/customer', authToken, authRole('user'), (req, res) => {
    console.log('INSIDE API GATEWAY CUSTOMER ROUTE');
    forward(CUSTOMER_URL)(req, res);
});

app.listen(process.env.PORT || 8080, () => {
    console.log(`API Gateway Service is running on PORT NO : ${process.env.PORT || 8080}`);
});
