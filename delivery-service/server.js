require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const Order = require('./models/Order');
const User = require('./models/User');

const app = express();
app.use(express.json());

mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('Delivery Service: MongoDB connected'))
    .catch(err => console.error('MongoDB connection error:', err.message));

const wrap = fn => (req, res) => fn(req, res).catch(err =>
    res.status(err.name === 'CastError' ? 400 : 500).json({ message: err.message }));

const agentId = req => req.headers['x-user-id'];

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// orders that are READY and not taken by anyone
app.get('/delivery/available', wrap(async (req, res) => {
    res.json(await Order.find({ status: 'READY', deliveryAgentId: null }).sort({ createdAt: 1 }));
}));

// accept an order (atomic, so two agents cannot take the same order)
app.put('/delivery/:orderId/accept', wrap(async (req, res) => {
    const order = await Order.findOneAndUpdate(
        { _id: req.params.orderId, status: 'READY', deliveryAgentId: null },
        { deliveryAgentId: agentId(req) },
        { new: true }
    );
    if (!order) return res.status(409).json({ message: 'Order is not available for delivery' });
    res.json({ message: 'Order accepted for delivery', order });
}));

const NEXT_STATUS = { READY: 'PICKED_UP', PICKED_UP: 'DELIVERED' };

app.put('/delivery/:orderId/status', wrap(async (req, res) => {
    const { status } = req.body;
    if (!['PICKED_UP', 'DELIVERED'].includes(status))
        return res.status(400).json({ message: 'status must be PICKED_UP or DELIVERED' });
    const order = await Order.findOne({ _id: req.params.orderId, deliveryAgentId: agentId(req) });
    if (!order) return res.status(404).json({ message: 'Order not found or not assigned to you' });
    if (NEXT_STATUS[order.status] !== status)
        return res.status(400).json({ message: `Cannot move order from ${order.status} to ${status}` });
    order.status = status;
    await order.save();
    res.json({ message: `Order is now ${status}`, order });
}));

app.get('/delivery/history', wrap(async (req, res) => {
    res.json(await Order.find({ deliveryAgentId: agentId(req), status: 'DELIVERED' }).sort({ updatedAt: -1 }));
}));

app.put('/delivery/availability', wrap(async (req, res) => {
    if (typeof req.body.available !== 'boolean')
        return res.status(400).json({ message: 'available (true/false) is required' });
    const agent = await User.findByIdAndUpdate(
        agentId(req), { isAvailable: req.body.available }, { new: true }).select('name isAvailable');
    if (!agent) return res.status(404).json({ message: 'Agent not found' });
    res.json({ message: `You are now ${agent.isAvailable ? 'online' : 'offline'}`, agent });
}));

app.listen(process.env.PORT || 8086, () =>
    console.log(`Delivery Service is running on PORT NO : ${process.env.PORT || 8086}`));
