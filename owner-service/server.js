require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const Restaurant = require('./models/Restaurant');
const MenuItem = require('./models/MenuItem');
const Order = require('./models/Order');

const app = express();
app.use(express.json());

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

app.put('/owner/restaurants/:id', wrap(async (req, res) => {
    const updates = {};
    ['name', 'address', 'cuisine', 'phone'].forEach(f => {
        if (req.body[f] !== undefined) updates[f] = req.body[f];
    });
    const restaurant = await Restaurant.findOneAndUpdate(
        { _id: req.params.id, ownerId: ownerId(req) }, updates, { new: true });
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

app.get('/owner/menu/restaurant/:restaurantId', wrap(async (req, res) => {
    if (!(await ownsRestaurant(req.params.restaurantId, req)))
        return res.status(403).json({ message: 'This restaurant is not yours' });
    res.json(await MenuItem.find({ restaurantId: req.params.restaurantId }));
}));

app.put('/owner/menu/:itemId', wrap(async (req, res) => {
    const item = await MenuItem.findById(req.params.itemId);
    if (!item) return res.status(404).json({ message: 'Menu item not found' });
    if (!(await ownsRestaurant(item.restaurantId, req)))
        return res.status(403).json({ message: 'This item is not yours' });
    ['name', 'description', 'price', 'available'].forEach(f => {
        if (req.body[f] !== undefined) item[f] = req.body[f];
    });
    await item.save();
    res.json({ message: 'Menu item updated', item });
}));

app.delete('/owner/menu/:itemId', wrap(async (req, res) => {
    const item = await MenuItem.findById(req.params.itemId);
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

app.put('/owner/orders/:orderId/status', wrap(async (req, res) => {
    const { status } = req.body;
    if (!['ACCEPTED', 'PREPARING', 'READY'].includes(status))
        return res.status(400).json({ message: 'status must be ACCEPTED, PREPARING or READY' });
    const order = await Order.findById(req.params.orderId);
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
