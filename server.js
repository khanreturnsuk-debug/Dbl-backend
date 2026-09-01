const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors());

// MongoDB Atlas Connection URI
const MONGO_URI = 'mongodb+srv://khanreturnsuk_db_user:admin12345@cluster0.irfj6ne.mongodb.net/dbl_database?appName=Cluster0';

// Serverless Connection Handler for Vercel
let cachedDb = null;

async function connectDB() {
    if (mongoose.connection.readyState >= 1) {
        return;
    }
    if (!cachedDb) {
        cachedDb = await mongoose.connect(MONGO_URI, {
            bufferCommands: false,
        });
    }
}

// Mongoose Schemas & Models
const userSchema = new mongoose.Schema({
    fullName: String,
    username: { type: String, unique: true },
    email: String,
    phone: String,
    password: String,
    balance: { type: Number, default: 100 },
    vipLevel: { type: String, default: 'VIP 1' },
    referredBy: { type: String, default: 'None' },
    createdAt: { type: Date, default: Date.now }
});

const transactionSchema = new mongoose.Schema({
    username: String,
    type: String,
    amount: Number,
    method: String,
    accountDetails: String,
    status: { type: String, default: 'Pending' },
    createdAt: { type: Date, default: Date.now }
});

const User = mongoose.models.User || mongoose.model('User', userSchema);
const Transaction = mongoose.models.Transaction || mongoose.model('Transaction', transactionSchema);

// Root and Admin HTML file routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/admin.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

function getVipLevel(balance) {
    if (balance >= 4000) return "VIP 10";
    if (balance >= 3000) return "VIP 9";
    if (balance >= 2500) return "VIP 8";
    if (balance >= 2000) return "VIP 7";
    if (balance >= 1500) return "VIP 6";
    if (balance >= 1000) return "VIP 5";
    if (balance >= 800) return "VIP 4";
    if (balance >= 500) return "VIP 3";
    if (balance >= 200) return "VIP 2";
    return "VIP 1";
}

// User Registration Route
app.post('/api/register', async (req, res) => {
    try {
        await connectDB();
        const { fullName, username, email, phone, password } = req.body;
        const existing = await User.findOne({ username });
        if (existing) return res.status(400).json({ success: false, message: 'Username already exists' });

        const newUser = new User({ fullName, username, email, phone, password });
        await newUser.save();
        res.json({ success: true, user: newUser });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// User Login Route (Updated to properly catch username, email, or input)
app.post('/api/login', async (req, res) => {
    try {
        await connectDB();
        const { input, username, email, password } = req.body;
        const loginIdentifier = input || username || email;

        if (!loginIdentifier || !password) {
            return res.status(400).json({ success: false, message: 'Please provide username/email and password' });
        }

        // Find user by username or email (case-insensitive search)
        const user = await User.findOne({ 
            $or: [
                { username: { $regex: new RegExp(`^${loginIdentifier.trim()}$`, 'i') } }, 
                { email: { $regex: new RegExp(`^${loginIdentifier.trim()}$`, 'i') } }
            ] 
        });

        if (!user || user.password !== password.trim()) {
            return res.status(400).json({ success: false, message: 'Invalid credentials' });
        }

        res.status(200).json({ success: true, user });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Transaction Route
app.post('/api/transaction', async (req, res) => {
    try {
        await connectDB();
        const { username, type, amount, method, accountDetails } = req.body;
        const newTx = new Transaction({
            username, type, amount: Number(amount), method, accountDetails
        });
        await newTx.save();
        res.json({ success: true, transaction: newTx });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Admin API: Get all registered users
app.get('/api/admin/users', async (req, res) => {
    try {
        await connectDB();
        const users = await User.find({});
        const formattedUsers = users.map(user => {
            const balance = user.balance || 100;
            return {
                id: user._id,
                username: user.username || user.fullName || user.phone || 'Unknown',
                vipLevel: user.vipLevel || getVipLevel(balance),
                referral: user.referredBy || 'None'
            };
        });
        res.json(formattedUsers);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Admin API: Get all withdrawals
app.get('/api/admin/withdrawals', async (req, res) => {
    try {
        await connectDB();
        const withdrawals = await Transaction.find({ type: 'withdrawal' });
        res.json(withdrawals);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Admin API: Update withdrawal status
app.post('/api/admin/withdrawal/update', async (req, res) => {
    try {
        await connectDB();
        const { reqId, status } = req.body;
        await Transaction.findByIdAndUpdate(reqId, { status: status });
        res.json({ success: true, message: 'Status updated successfully' });
    } catch (err) {
        res.status(500).json({ error: 'Update failed' });
    }
});

module.exports = app;
