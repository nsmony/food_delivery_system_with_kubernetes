require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const User = require('./models/User');
const Restaurant = require('./models/Restaurant');
const Coupon = require('./models/Coupon');
const Order = require('./models/Order');

const app = express();
app.use(express.json());

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

app.get('/admin/users/:id', wrap(async (req, res) => {
    const user = await User.findById(req.params.id).select('-password');
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(user);
}));

// block / unblock (send { "blocked": true } or leave empty to toggle)
app.put('/admin/users/:id/block', wrap(async (req, res) => {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    user.blocked = req.body.blocked !== undefined ? !!req.body.blocked : !user.blocked;
    await user.save();
    res.json({ message: user.blocked ? 'User blocked' : 'User unblocked', blocked: user.blocked });
}));

app.delete('/admin/users/:id', wrap(async (req, res) => {
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({ message: 'User removed' });
}));

// ---- RESTAURANTS ----
app.get('/admin/restaurants', wrap(async (req, res) => {
    const filter = req.query.status ? { status: req.query.status.toUpperCase() } : {};
    res.json(await Restaurant.find(filter));
}));

// approve or reject (send { "approved": true } or { "approved": false })
app.put('/admin/restaurants/:id/approve', wrap(async (req, res) => {
    if (typeof req.body.approved !== 'boolean')
        return res.status(400).json({ message: 'approved (true/false) is required' });
    const restaurant = await Restaurant.findByIdAndUpdate(
        req.params.id,
        { status: req.body.approved ? 'APPROVED' : 'REJECTED' },
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
