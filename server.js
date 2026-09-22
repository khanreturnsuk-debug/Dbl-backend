require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(__dirname)); // Frontend HTML/CSS/JS serve karne ke liye

// MongoDB Connection
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/dbl_portal';
mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ MongoDB connected successfully'))
    .catch(err => console.error('❌ MongoDB connection error:', err));

// Schemas & Models
const userSchema = new mongoose.Schema({
    fullName: String,
    username: { type: String, unique: true },
    email: String,
    phone: String,
    password: String,
    balance: { type: Number, default: 50 } // Signup welcome bonus $50
});
const User = mongoose.model('User', userSchema);

const transactionSchema = new mongoose.Schema({
    username: String,
    type: String, // 'Deposit' or 'Withdraw'
    method: String,
    amount: Number,
    accountDetails: String,
    status: { type: String, default: 'Pending' }, // Pending, Approved, Rejected
    createdAt: { type: Date, default: Date.now }
});
const Transaction = mongoose.model('Transaction', transactionSchema);

// --- AUTH & USER ROUTES ---

app.post('/api/register', async (req, res) => {
    try {
        const { fullName, username, email, phone, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ success: false, message: 'Username and password required' });
        }
        const existing = await User.findOne({ username });
        if (existing) {
            return res.status(400).json({ success: false, message: 'Username already exists' });
        }
        const newUser = new User({ fullName, username, email, phone, password });
        await newUser.save();
        res.json({ success: true, message: 'Registered successfully!' });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { input, password } = req.body;
        const user = await User.findOne({
            $or: [{ username: input }, { email: input }]
        });
        if (!user || user.password !== password) {
            return res.status(401).json({ success: false, message: 'Invalid username or password' });
        }
        res.json({ 
            success: true, 
            user: { username: user.username, balance: user.balance } 
        });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// Admin direct login API check
app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;
    if ((username === 'admin123' || username === 'admin') && password === '12345') {
        res.json({ success: true, token: 'secure_admin_token_xyz', role: 'admin' });
    } else {
        res.status(401).json({ success: false, message: 'Invalid Admin Credentials' });
    }
});

// --- GAME LOGIC ROUTE (Aviator / Mining) ---

app.post('/api/game/play', async (req, res) => {
    try {
        const { username, betAmount, gameType, multiplierChoice } = req.body;
        const user = await User.findOne({ username });
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });
        
        const betNum = Number(betAmount);
        if (user.balance < betNum || betNum <= 0) {
            return res.status(400).json({ success: false, message: 'Insufficient balance or invalid bet' });
        }

        // Aviator crash multiplier simulation (1.00x to 4.50x random)
        const crashMultiplier = Number((Math.random() * 3.5 + 1).toFixed(2));
        const target = Number(multiplierChoice || 2.0);
        
        let isWin = false;
        let winAmount = 0;

        if (crashMultiplier >= target) {
            isWin = true;
            winAmount = betNum * target;
        }

        // Deduct bet and add winning if won
        user.balance = user.balance - betNum + (isWin ? winAmount : 0);
        await user.save();

        res.json({
            success: true,
            balance: user.balance,
            multiplier: crashMultiplier,
            isWin,
            message: isWin ? `Won! Target ${target}x achieved.` : `Crashed at ${crashMultiplier}x!`
        });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// --- WALLET & DEPOSIT/WITHDRAWAL ROUTES ---

app.post('/api/deposit', async (req, res) => {
    try {
        const { username, method, sender, amount, receiptInfo } = req.body;
        const tx = new Transaction({
            username,
            type: 'Deposit',
            method,
            amount: Number(amount),
            accountDetails: `Sender: ${sender}, Ref/TID: ${receiptInfo}`,
            status: 'Pending'
        });
        await tx.save();
        res.json({ success: true, message: 'Deposit request submitted to admin.' });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.post('/api/withdraw', async (req, res) => {
    try {
        const { username, method, accountNumber, accountName, amount } = req.body;
        const user = await User.findOne({ username });
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });
        
        const wdAmount = Number(amount);
        if (user.balance < wdAmount) {
            return res.status(400).json({ success: false, message: 'Insufficient balance for withdrawal' });
        }

        user.balance -= wdAmount;
        await user.save();

        const tx = new Transaction({
            username,
            type: 'Withdraw',
            method,
            amount: wdAmount,
            accountDetails: `${accountName} (${accountNumber})`,
            status: 'Pending'
        });
        await tx.save();
        res.json({ success: true, message: 'Withdrawal request created, pending admin approval.' });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// --- ADMIN PANEL API ROUTES ---

app.get('/api/admin/withdrawals', async (req, res) => {
    try {
        const list = await Transaction.find({ type: 'Withdraw' }).sort({ createdAt: -1 });
        res.json(list);
    } catch (e) {
        res.status(500).json([]);
    }
});

app.get('/api/admin/deposits', async (req, res) => {
    try {
        const list = await Transaction.find({ type: 'Deposit' }).sort({ createdAt: -1 });
        res.json(list);
    } catch (e) {
        res.status(500).json([]);
    }
});

app.post('/api/admin/transaction/update', async (req, res) => {
    try {
        const { reqId, status } = req.body;
        const tx = await Transaction.findById(reqId);
        if (!tx) return res.status(404).json({ success: false, message: 'Transaction not found' });

        // Agar deposit approve ho raha hai toh user balance mein add kar do
        if (status === 'Approved' && tx.status !== 'Approved' && tx.type === 'Deposit') {
            const user = await User.findOne({ username: tx.username });
            if (user) {
                user.balance += Number(tx.amount);
                await user.save();
            }
        }

        tx.status = status;
        await tx.save();
        res.json({ success: true, message: `Transaction updated to ${status}` });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
