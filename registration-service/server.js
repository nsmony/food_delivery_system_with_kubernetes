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

// CHECK IF AN EMAIL IS AVAILABLE (public)
app.get('/register/check-email', wrap(async (req, res) => {
    const { email } = req.query;
    if (!email) return res.status(400).json({ message: 'email query parameter is required' });
    const exists = await User.findOne({ email: email.toLowerCase() });
    res.json({ email, available: !exists });
}));

app.listen(process.env.PORT || 8081, () =>
    console.log(`Registration Service is running on PORT NO : ${process.env.PORT || 8081}`));
