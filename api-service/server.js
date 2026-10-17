require('dotenv').config();
const express = require('express');
const app = express();

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
const CUSTOMER_URLS = (process.env.CUSTOMER_URLS || '').split(',').map(s => s.trim()).filter(Boolean);

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

// ---------------- LOAD BALANCER for the Customer Microservice ----------------
// Round-robin over CUSTOMER_URLS, skipping instances that fail the health check.
const health = Object.fromEntries(CUSTOMER_URLS.map(u => [u, true]));
let rr = 0;

async function checkHealth() {
    for (const url of CUSTOMER_URLS) {
        try {
            const r = await fetch(url + '/health', { signal: AbortSignal.timeout(2000) });
            health[url] = r.ok;
        } catch {
            health[url] = false;
        }
    }
}
setInterval(checkHealth, 5000);
checkHealth();

function pickCustomerInstance(exclude) {
    const alive = CUSTOMER_URLS.filter(u => health[u] && !exclude.includes(u));
    if (alive.length === 0) return null;
    return alive[rr++ % alive.length];
}

function customerLoadBalancer(req, res) {
    req.url = req.originalUrl;
    const tried = [];
    const attempt = () => {
        const target = pickCustomerInstance(tried);
        if (!target) return res.status(503).json({ message: 'No customer service instance available' });
        tried.push(target);
        console.log(`[LOAD BALANCER] ${req.method} ${req.originalUrl} -> ${target}`);
        proxy.web(req, res, { target }, () => {
            health[target] = false; // mark down, health check will bring it back
            if (req.method === 'GET' && !res.headersSent) return attempt(); // failover
            if (!res.headersSent) res.status(502).json({ message: 'Bad gateway' });
        });
    };
    attempt();
}

app.get('/health', (req, res) => res.json({ status: 'ok', customerInstances: health }));

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
    customerLoadBalancer(req, res);
});

app.listen(process.env.PORT || 8080, () => {
    console.log(`API Gateway Service is running on PORT NO : ${process.env.PORT || 8080}`);
});
