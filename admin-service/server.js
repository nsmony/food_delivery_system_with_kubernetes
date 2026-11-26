require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const User = require('./models/User');
const Restaurant = require('./models/Restaurant');
const Coupon = require('./models/Coupon');
const Order = require('./models/Order');

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
app.use(express.json());
app.use((req, res, next) => { req.body = req.body || {}; next(); }); // GET/DELETE may arrive without a body

mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('Admin Service: MongoDB connected'))
    .catch(err => console.error('MongoDB connection error:', err.message));

const wrap = fn => (req, res) => fn(req, res).catch(err =>
    res.status(err.name === 'CastError' ? 400 : 500).json({ message: err.message }));

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// ---- USERS ----
app.get('/admin/users', wrap(async (req, res) => {
    const filter = req.query.role ? { role: req.query.role } : {};
    res.json(await User.find(filter).select('-password'));
}));

// body: { "userId": "..." }
app.get('/admin/users/details', wrap(async (req, res) => {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ message: 'userId is required in the body' });
    const user = await User.findById(userId).select('-password');
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(user);
}));

// block / unblock. body: { "userId": "...", "blocked": true } (leave blocked out to toggle)
app.put('/admin/users/block', wrap(async (req, res) => {
    const { userId, blocked } = req.body;
    if (!userId) return res.status(400).json({ message: 'userId is required in the body' });
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });
    user.blocked = blocked !== undefined ? !!blocked : !user.blocked;
    await user.save();
    res.json({ message: user.blocked ? 'User blocked' : 'User unblocked', blocked: user.blocked });
}));

// body: { "userId": "..." }
app.delete('/admin/users', wrap(async (req, res) => {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ message: 'userId is required in the body' });
    const user = await User.findByIdAndDelete(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({ message: 'User removed' });
}));

// ---- RESTAURANTS ----
app.get('/admin/restaurants', wrap(async (req, res) => {
    const filter = req.query.status ? { status: req.query.status.toUpperCase() } : {};
    res.json(await Restaurant.find(filter));
}));

// approve or reject. body: { "restaurantId": "...", "approved": true }
app.put('/admin/restaurants/approve', wrap(async (req, res) => {
    const { restaurantId, approved } = req.body;
    if (!restaurantId || typeof approved !== 'boolean')
        return res.status(400).json({ message: 'restaurantId and approved (true/false) are required in the body' });
    const restaurant = await Restaurant.findByIdAndUpdate(
        restaurantId,
        { status: approved ? 'APPROVED' : 'REJECTED' },
        { new: true }
    );
    if (!restaurant) return res.status(404).json({ message: 'Restaurant not found' });
    res.json({ message: `Restaurant ${restaurant.status.toLowerCase()}`, restaurant });
}));

// ---- COUPONS ----
app.post('/admin/coupons', wrap(async (req, res) => {
    const { code, discountPercent, expiresAt } = req.body;
    if (!code || !discountPercent)
        return res.status(400).json({ message: 'code and discountPercent are required' });
    if (await Coupon.findOne({ code: code.toUpperCase() }))
        return res.status(409).json({ message: 'Coupon code already exists' });
    const coupon = await Coupon.create({ code, discountPercent, expiresAt });
    res.status(201).json({ message: 'Coupon created', coupon });
}));

app.get('/admin/coupons', wrap(async (req, res) => {
    res.json(await Coupon.find());
}));

// ---- ORDERS ----
app.get('/admin/orders', wrap(async (req, res) => {
    const filter = req.query.status ? { status: req.query.status.toUpperCase() } : {};
    res.json(await Order.find(filter).sort({ createdAt: -1 }));
}));

app.listen(process.env.PORT || 8083, () =>
    console.log(`Admin Service is running on PORT NO : ${process.env.PORT || 8083}`));
