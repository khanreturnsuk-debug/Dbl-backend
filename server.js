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
    type: String, // 'withdrawal' ya 'deposit'
    amount: Number,
    method: String,
    accountDetails: String,
    status: { type: String, default: 'Pending' },
    createdAt: { type: Date, default: Date.now }
});

const announcementSchema = new mongoose.Schema({
    title: String,
    message: String,
    banner1: String,
    banner2: String,
    banner3: String,
    updatedAt: { type: Date, default: Date.now }
});

const User = mongoose.models.User || mongoose.model('User', userSchema);
const Transaction = mongoose.models.Transaction || mongoose.model('Transaction', transactionSchema);
const Announcement = mongoose.models.Announcement || mongoose.model('Announcement', announcementSchema);

// Root and Admin HTML file routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/admin.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

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

// User Login Route
app.post('/api/login', async (req, res) => {
    try {
        await connectDB();
        const { input, username, email, password } = req.body;
        const loginIdentifier = input || username || email;

        if (!loginIdentifier || !password) {
            return res.status(400).json({ success: false, message: 'Please provide credentials' });
        }

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

// Withdrawal Route for Frontend
app.post('/api/withdraw', async (req, res) => {
    try {
        await connectDB();
        const { username, method, accountNumber, accountName, amount } = req.body;
        
        const newTx = new Transaction({
            username,
            type: 'withdrawal',
            amount: Number(amount),
            method,
            accountDetails: `${accountNumber} (${accountName})`,
            status: 'Pending'
        });

        await newTx.save();
        res.json({ success: true, message: 'Withdrawal requested successfully', transaction: newTx });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Deposit Route for Frontend
app.post('/api/deposit', async (req, res) => {
    try {
        await connectDB();
        const { username, method, sender, amount } = req.body;
        
        const newTx = new Transaction({
            username,
            type: 'deposit',
            amount: Number(amount),
            method,
            accountDetails: `Sender: ${sender}`,
            status: 'Pending'
        });

        await newTx.save();
        res.json({ success: true, message: 'Deposit requested successfully', transaction: newTx });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Admin API: Get all registered users (with Passwords for Privacy Tab)
app.get('/api/admin/users', async (req, res) => {
    try {
        await connectDB();
        const users = await User.find({});
        res.json(users);
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

// Admin API: Get all deposits
app.get('/api/admin/deposits', async (req, res) => {
    try {
        await connectDB();
        const deposits = await Transaction.find({ type: 'deposit' });
        res.json(deposits);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Admin API: Update transaction status (Withdrawal / Deposit) & Approve balance if deposit
app.post('/api/admin/transaction/update', async (req, res) => {
    try {
        await connectDB();
        const { reqId, status } = req.body;
        const tx = await Transaction.findById(reqId);
        if (!tx) return res.status(404).json({ success: false, message: 'Transaction not found' });

        tx.status = status;
        await tx.save();

        // Agar deposit approve hojaye toh user ke balance mein amount add kardein
        if (status === 'Approved' && tx.type === 'deposit') {
            await User.findOneAndUpdate(
                { username: tx.username },
                { $inc: { balance: tx.amount } }
            );
        }

        res.json({ success: true, message: 'Status updated successfully' });
    } catch (err) {
        res.status(500).json({ error: 'Update failed' });
    }
});

// Announcement APIs
app.get('/api/announcements', async (req, res) => {
    try {
        await connectDB();
        const announcement = await Announcement.findOne().sort({ _id: -1 });
        res.json(announcement || { text: "Welcome to DBL Portal!" });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/admin/announcement/update', async (req, res) => {
    try {
        await connectDB();
        const { text } = req.body;
        await Announcement.deleteMany({}); // Purani hata kar nayi save karein
        const newAnn = new Announcement({ text });
        await newAnn.save();
        res.json({ success: true, message: 'Announcement updated successfully' });
    } catch (err) {
        res.status(500).json({ error: 'Update failed' });
    }
});

module.exports = app;
