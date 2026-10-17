require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('./models/User');

const app = express();
app.use(express.json());

mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('Registration Service: MongoDB connected'))
    .catch(err => console.error('MongoDB connection error:', err.message));

const ROLES = ['admin', 'owner', 'user', 'delivery'];
const wrap = fn => (req, res) => fn(req, res).catch(err =>
    res.status(err.name === 'CastError' ? 400 : 500).json({ message: err.message }));

// user can only touch their own profile (admin can touch any)
const canAccess = req =>
    req.headers['x-user-id'] === req.params.id || req.headers['x-user-role'] === 'admin';

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// REGISTER (public)
app.post('/register', wrap(async (req, res) => {
    const { name, email, password, role, phone, address, vehicleType } = req.body;
    if (!name || !email || !password || !role)
        return res.status(400).json({ message: 'name, email, password and role are required' });
    if (!ROLES.includes(role))
        return res.status(400).json({ message: `role must be one of: ${ROLES.join(', ')}` });
    if (await User.findOne({ email: email.toLowerCase() }))
        return res.status(409).json({ message: 'Email already registered' });

    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, password: hashed, role, phone, address, vehicleType });
    res.status(201).json({
        message: 'Registered successfully',
        user: { id: user._id, name: user.name, email: user.email, role: user.role }
    });
}));

// VIEW PROFILE (token required)
app.get('/register/profile/:id', wrap(async (req, res) => {
    if (!canAccess(req)) return res.status(403).json({ message: 'You can only view your own profile' });
    const user = await User.findById(req.params.id).select('-password');
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(user);
}));

// UPDATE PROFILE (token required)
app.put('/register/profile/:id', wrap(async (req, res) => {
    if (!canAccess(req)) return res.status(403).json({ message: 'You can only update your own profile' });
    const updates = {};
    ['name', 'phone', 'address', 'vehicleType'].forEach(f => {
        if (req.body[f] !== undefined) updates[f] = req.body[f];
    });
    const user = await User.findByIdAndUpdate(req.params.id, updates, { new: true }).select('-password');
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({ message: 'Profile updated', user });
}));

app.listen(process.env.PORT || 8081, () =>
    console.log(`Registration Service is running on PORT NO : ${process.env.PORT || 8081}`));
