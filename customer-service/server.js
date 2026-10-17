require('dotenv').config();
const os = require('os');
const express = require('express');
const mongoose = require('mongoose');
const Restaurant = require('./models/Restaurant');
const MenuItem = require('./models/MenuItem');
const Cart = require('./models/Cart');
const Order = require('./models/Order');
const Coupon = require('./models/Coupon');
const Review = require('./models/Review');

const app = express();
app.use(express.json());

const INSTANCE_NAME = process.env.INSTANCE_NAME || 'Customer-A';

mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log(`Customer Service (${INSTANCE_NAME}): MongoDB connected`))
    .catch(err => console.error('MongoDB connection error:', err.message));

const wrap = fn => (req, res) => fn(req, res).catch(err =>
    res.status(err.name === 'CastError' ? 400 : 500).json({ message: err.message }));

const userId = req => req.headers['x-user-id'];

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// LOAD BALANCER DEMO: shows which instance answered
app.get('/customer/instance-info', (req, res) => {
    res.json({ instance: INSTANCE_NAME, hostname: os.hostname(), port: process.env.PORT || 8085 });
});

// ---- BROWSE ----
app.get('/customer/restaurants', wrap(async (req, res) => {
    res.json(await Restaurant.find({ status: 'APPROVED' }));
}));

app.get('/customer/restaurants/:id/menu', wrap(async (req, res) => {
    const restaurant = await Restaurant.findOne({ _id: req.params.id, status: 'APPROVED' });
    if (!restaurant) return res.status(404).json({ message: 'Restaurant not found' });
    const menu = await MenuItem.find({ restaurantId: req.params.id, available: true });
    res.json({ restaurant: restaurant.name, menu });
}));

// ---- CART ----
app.post('/customer/cart', wrap(async (req, res) => {
    const { menuItemId, quantity = 1 } = req.body;
    if (!menuItemId || quantity < 1)
        return res.status(400).json({ message: 'menuItemId and a valid quantity are required' });

    const item = await MenuItem.findById(menuItemId);
    if (!item || !item.available) return res.status(404).json({ message: 'Menu item not available' });
    const restaurant = await Restaurant.findOne({ _id: item.restaurantId, status: 'APPROVED' });
    if (!restaurant) return res.status(400).json({ message: 'Restaurant is not available' });

    let cart = await Cart.findOne({ userId: userId(req) });
    if (!cart) cart = new Cart({ userId: userId(req), restaurantId: item.restaurantId, items: [] });

    if (cart.items.length && String(cart.restaurantId) !== String(item.restaurantId))
        return res.status(400).json({ message: 'Cart has items from another restaurant. Remove them first.' });
    cart.restaurantId = item.restaurantId;

    const existing = cart.items.find(i => String(i.menuItemId) === String(item._id));
    if (existing) existing.quantity += quantity;
    else cart.items.push({ menuItemId: item._id, name: item.name, price: item.price, quantity });

    await cart.save();
    res.status(201).json({ message: 'Item added to cart', cart });
}));

app.get('/customer/cart', wrap(async (req, res) => {
    const cart = await Cart.findOne({ userId: userId(req) });
    if (!cart || cart.items.length === 0) return res.json({ items: [], total: 0 });
    const total = cart.items.reduce((sum, i) => sum + i.price * i.quantity, 0);
    res.json({ cart, total });
}));

app.delete('/customer/cart/:itemId', wrap(async (req, res) => {
    const cart = await Cart.findOne({ userId: userId(req) });
    if (!cart) return res.status(404).json({ message: 'Cart is empty' });
    const before = cart.items.length;
    cart.items = cart.items.filter(i => String(i.menuItemId) !== req.params.itemId);
    if (cart.items.length === before) return res.status(404).json({ message: 'Item not in cart' });
    await cart.save();
    res.json({ message: 'Item removed from cart', cart });
}));

// ---- ORDERS ----
app.post('/customer/orders', wrap(async (req, res) => {
    const { deliveryAddress, couponCode } = req.body;
    if (!deliveryAddress) return res.status(400).json({ message: 'deliveryAddress is required' });

    const cart = await Cart.findOne({ userId: userId(req) });
    if (!cart || cart.items.length === 0) return res.status(400).json({ message: 'Cart is empty' });

    const subtotal = cart.items.reduce((sum, i) => sum + i.price * i.quantity, 0);
    let discount = 0;
    if (couponCode) {
        const coupon = await Coupon.findOne({ code: couponCode.toUpperCase(), active: true });
        if (!coupon || (coupon.expiresAt && coupon.expiresAt < new Date()))
            return res.status(400).json({ message: 'Invalid or expired coupon' });
        discount = +(subtotal * coupon.discountPercent / 100).toFixed(2);
    }

    const order = await Order.create({
        userId: userId(req),
        restaurantId: cart.restaurantId,
        items: cart.items,
        subtotal,
        discount,
        totalAmount: +(subtotal - discount).toFixed(2),
        couponCode: couponCode ? couponCode.toUpperCase() : undefined,
        deliveryAddress
    });

    cart.items = [];
    await cart.save();
    res.status(201).json({ message: 'Order placed', order });
}));

app.get('/customer/orders', wrap(async (req, res) => {
    res.json(await Order.find({ userId: userId(req) }).sort({ createdAt: -1 }));
}));

app.get('/customer/orders/:id', wrap(async (req, res) => {
    const order = await Order.findOne({ _id: req.params.id, userId: userId(req) });
    if (!order) return res.status(404).json({ message: 'Order not found' });
    res.json(order);
}));

app.put('/customer/orders/:id/cancel', wrap(async (req, res) => {
    const order = await Order.findOne({ _id: req.params.id, userId: userId(req) });
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (order.status !== 'PLACED')
        return res.status(400).json({ message: `Cannot cancel, order is already ${order.status}` });
    order.status = 'CANCELLED';
    await order.save();
    res.json({ message: 'Order cancelled', order });
}));

// ---- REVIEWS ----
app.post('/customer/reviews', wrap(async (req, res) => {
    const { orderId, rating, comment } = req.body;
    if (!orderId || !rating) return res.status(400).json({ message: 'orderId and rating are required' });
    if (rating < 1 || rating > 5) return res.status(400).json({ message: 'rating must be 1 to 5' });

    const order = await Order.findOne({ _id: orderId, userId: userId(req) });
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (order.status !== 'DELIVERED')
        return res.status(400).json({ message: 'You can review only delivered orders' });
    if (await Review.findOne({ orderId }))
        return res.status(409).json({ message: 'You already reviewed this order' });

    const review = await Review.create({
        userId: userId(req), restaurantId: order.restaurantId, orderId, rating, comment });
    res.status(201).json({ message: 'Review added', review });
}));

app.get('/customer/reviews/restaurant/:id', wrap(async (req, res) => {
    const reviews = await Review.find({ restaurantId: req.params.id }).sort({ createdAt: -1 });
    const average = reviews.length
        ? +(reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1) : 0;
    res.json({ averageRating: average, totalReviews: reviews.length, reviews });
}));

app.listen(process.env.PORT || 8085, () =>
    console.log(`Customer Service (${INSTANCE_NAME}) is running on PORT NO : ${process.env.PORT || 8085}`));
