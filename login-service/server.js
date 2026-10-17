require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('./models/User');

const app = express();
app.use(express.json());

const JWT_SECRETE = process.env.JWT_SECRETE;

mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('Login Service: MongoDB connected'))
    .catch(err => console.error('MongoDB connection error:', err.message));

const wrap = fn => (req, res) => fn(req, res).catch(err =>
    res.status(err.name === 'CastError' ? 400 : 500).json({ message: err.message }));

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// LOGIN (public) -> returns JWT with id + role
app.post('/login', wrap(async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ message: 'email and password are required' });

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user || !(await bcrypt.compare(password, user.password)))
        return res.status(401).json({ message: 'Wrong email or password' });
    if (user.blocked) return res.status(403).json({ message: 'Your account is blocked by admin' });

    const token = jwt.sign({ id: user._id, role: user.role, name: user.name }, JWT_SECRETE, { expiresIn: '1h' });
    res.json({ message: 'Login successful', token, role: user.role });
}));

// VALIDATE TOKEN (gateway already verified it and added the x-user-* headers)
app.get('/login/validate', (req, res) => {
    res.json({ valid: true, user: { id: req.headers['x-user-id'], role: req.headers['x-user-role'] } });
});

// CHANGE PASSWORD (token required)
app.put('/login/change-password', wrap(async (req, res) => {
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword)
        return res.status(400).json({ message: 'oldPassword and newPassword are required' });

    const user = await User.findById(req.headers['x-user-id']);
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (!(await bcrypt.compare(oldPassword, user.password)))
        return res.status(401).json({ message: 'Old password is wrong' });

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();
    res.json({ message: 'Password changed successfully' });
}));

// user can only touch their own profile (admin can touch any)
const canAccess = req =>
    req.headers['x-user-id'] === req.params.id || req.headers['x-user-role'] === 'admin';

// VIEW PROFILE (token required)
app.get('/users/profile/:id', wrap(async (req, res) => {
    if (!canAccess(req)) return res.status(403).json({ message: 'You can only view your own profile' });
    const user = await User.findById(req.params.id).select('-password');
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(user);
}));

// UPDATE PROFILE (token required)
app.put('/users/profile/:id', wrap(async (req, res) => {
    if (!canAccess(req)) return res.status(403).json({ message: 'You can only update your own profile' });
    const updates = {};
    ['name', 'phone', 'address', 'vehicleType'].forEach(f => {
        if (req.body[f] !== undefined) updates[f] = req.body[f];
    });
    const user = await User.findByIdAndUpdate(req.params.id, updates, { new: true }).select('-password');
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({ message: 'Profile updated', user });
}));

app.listen(process.env.PORT || 8082, () =>
    console.log(`Login Service is running on PORT NO : ${process.env.PORT || 8082}`));
