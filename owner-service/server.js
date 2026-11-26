require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const Restaurant = require('./models/Restaurant');
const MenuItem = require('./models/MenuItem');
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
    .then(() => console.log('Owner Service: MongoDB connected'))
    .catch(err => console.error('MongoDB connection error:', err.message));

const wrap = fn => (req, res) => fn(req, res).catch(err =>
    res.status(err.name === 'CastError' ? 400 : 500).json({ message: err.message }));

const ownerId = req => req.headers['x-user-id'];
const ownsRestaurant = (restaurantId, req) => Restaurant.findOne({ _id: restaurantId, ownerId: ownerId(req) });

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// ---- RESTAURANTS ----
app.post('/owner/restaurants', wrap(async (req, res) => {
    const { name, address, cuisine, phone } = req.body;
    if (!name || !address) return res.status(400).json({ message: 'name and address are required' });
    const restaurant = await Restaurant.create({ name, address, cuisine, phone, ownerId: ownerId(req) });
    res.status(201).json({ message: 'Restaurant created, waiting for admin approval', restaurant });
}));

app.get('/owner/restaurants', wrap(async (req, res) => {
    res.json(await Restaurant.find({ ownerId: ownerId(req) }));
}));

// body: { "restaurantId": "...", "name": "...", "address": "...", "cuisine": "...", "phone": "..." }
app.put('/owner/restaurants', wrap(async (req, res) => {
    const { restaurantId } = req.body;
    if (!restaurantId) return res.status(400).json({ message: 'restaurantId is required in the body' });
    const updates = {};
    ['name', 'address', 'cuisine', 'phone'].forEach(f => {
        if (req.body[f] !== undefined) updates[f] = req.body[f];
    });
    const restaurant = await Restaurant.findOneAndUpdate(
        { _id: restaurantId, ownerId: ownerId(req) }, updates, { new: true });
    if (!restaurant) return res.status(404).json({ message: 'Restaurant not found (or not yours)' });
    res.json({ message: 'Restaurant updated', restaurant });
}));

// ---- MENU ----
app.post('/owner/menu', wrap(async (req, res) => {
    const { restaurantId, name, description, price, available } = req.body;
    if (!restaurantId || !name || price === undefined)
        return res.status(400).json({ message: 'restaurantId, name and price are required' });
    if (!(await ownsRestaurant(restaurantId, req)))
        return res.status(403).json({ message: 'This restaurant is not yours' });
    const item = await MenuItem.create({ restaurantId, name, description, price, available });
    res.status(201).json({ message: 'Menu item added', item });
}));

// body: { "restaurantId": "..." }
app.get('/owner/menu', wrap(async (req, res) => {
    const { restaurantId } = req.body;
    if (!restaurantId) return res.status(400).json({ message: 'restaurantId is required in the body' });
    if (!(await ownsRestaurant(restaurantId, req)))
        return res.status(403).json({ message: 'This restaurant is not yours' });
    res.json(await MenuItem.find({ restaurantId }));
}));

// body: { "itemId": "...", "name": "...", "description": "...", "price": 9, "available": true }
app.put('/owner/menu', wrap(async (req, res) => {
    const { itemId } = req.body;
    if (!itemId) return res.status(400).json({ message: 'itemId is required in the body' });
    const item = await MenuItem.findById(itemId);
    if (!item) return res.status(404).json({ message: 'Menu item not found' });
    if (!(await ownsRestaurant(item.restaurantId, req)))
        return res.status(403).json({ message: 'This item is not yours' });
    ['name', 'description', 'price', 'available'].forEach(f => {
        if (req.body[f] !== undefined) item[f] = req.body[f];
    });
    await item.save();
    res.json({ message: 'Menu item updated', item });
}));

// body: { "itemId": "..." }
app.delete('/owner/menu', wrap(async (req, res) => {
    const { itemId } = req.body;
    if (!itemId) return res.status(400).json({ message: 'itemId is required in the body' });
    const item = await MenuItem.findById(itemId);
    if (!item) return res.status(404).json({ message: 'Menu item not found' });
    if (!(await ownsRestaurant(item.restaurantId, req)))
        return res.status(403).json({ message: 'This item is not yours' });
    await item.deleteOne();
    res.json({ message: 'Menu item deleted' });
}));

// ---- ORDERS ----
app.get('/owner/orders', wrap(async (req, res) => {
    const ids = await Restaurant.find({ ownerId: ownerId(req) }).distinct('_id');
    res.json(await Order.find({ restaurantId: { $in: ids } }).sort({ createdAt: -1 }));
}));

const NEXT_STATUS = { PLACED: 'ACCEPTED', ACCEPTED: 'PREPARING', PREPARING: 'READY' };

// body: { "orderId": "...", "status": "ACCEPTED" }
app.put('/owner/orders/status', wrap(async (req, res) => {
    const { orderId, status } = req.body;
    if (!orderId) return res.status(400).json({ message: 'orderId is required in the body' });
    if (!['ACCEPTED', 'PREPARING', 'READY'].includes(status))
        return res.status(400).json({ message: 'status must be ACCEPTED, PREPARING or READY' });
    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (!(await ownsRestaurant(order.restaurantId, req)))
        return res.status(403).json({ message: 'This order is not for your restaurant' });
    if (NEXT_STATUS[order.status] !== status)
        return res.status(400).json({ message: `Cannot move order from ${order.status} to ${status}` });
    order.status = status;
    await order.save();
    res.json({ message: `Order is now ${status}`, order });
}));

app.listen(process.env.PORT || 8084, () =>
    console.log(`Owner Service is running on PORT NO : ${process.env.PORT || 8084}`));
