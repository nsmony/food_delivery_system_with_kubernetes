require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const Order = require('./models/Order');
const User = require('./models/User');

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
// body: { "orderId": "..." }
app.put('/delivery/accept', wrap(async (req, res) => {
    const { orderId } = req.body;
    if (!orderId) return res.status(400).json({ message: 'orderId is required in the body' });
    const order = await Order.findOneAndUpdate(
        { _id: orderId, status: 'READY', deliveryAgentId: null },
        { deliveryAgentId: agentId(req) },
        { new: true }
    );
    if (!order) return res.status(409).json({ message: 'Order is not available for delivery' });
    res.json({ message: 'Order accepted for delivery', order });
}));

const NEXT_STATUS = { READY: 'PICKED_UP', PICKED_UP: 'DELIVERED' };

// body: { "orderId": "...", "status": "PICKED_UP" }
app.put('/delivery/status', wrap(async (req, res) => {
    const { orderId, status } = req.body;
    if (!orderId) return res.status(400).json({ message: 'orderId is required in the body' });
    if (!['PICKED_UP', 'DELIVERED'].includes(status))
        return res.status(400).json({ message: 'status must be PICKED_UP or DELIVERED' });
    const order = await Order.findOne({ _id: orderId, deliveryAgentId: agentId(req) });
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
