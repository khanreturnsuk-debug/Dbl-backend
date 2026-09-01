const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors());

const MONGO_URI = 'mongodb+srv://khanreturnsuk_db_user:admin12345@cluster0.irfj6ne.mongodb.net/dbl_database?appName=Cluster0';

let cachedDb = null;
async function connectDB() {
    if (mongoose.connection.readyState >= 1) return;
    if (!cachedDb) {
        cachedDb = await mongoose.connect(MONGO_URI, { bufferCommands: false });
    }
}

const userSchema = new mongoose.Schema({
    fullName: String,
    username: { type: String, unique: true },
    email: String,
    phone: String,
    password: String,
    balance: { type: Number, default: 100 },
    vipLevel: { type: String, default: 'VIP 1' },
    referredBy: { type: String, default: '' }, // Referral field added
    createdAt: { type: Date, default: Date.now }
});

const transactionSchema = new mongoose.Schema({
    username: String,
    type: String, 
    amount: Number,
    tax: { type: Number, default: 0 },
    netAmount: { type: Number, default: 0 },
    method: String,
    accountDetails: String,
    status: { type: String, default: 'Pending' },
    createdAt: { type: Date, default: Date.now }
});

const announcementSchema = new mongoose.Schema({
    text: String,
    updatedAt: { type: Date, default: Date.now }
});

const User = mongoose.models.User || mongoose.model('User', userSchema);
const Transaction = mongoose.models.Transaction || mongoose.model('Transaction', transactionSchema);
const Announcement = mongoose.models.Announcement || mongoose.model('Announcement', announcementSchema);

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/admin.html', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

// Admin Secure Login Route
app.post('/api/admin/login', (req, res) => {
    const { password } = req.body;
    if (password === 'admin12345') {
        res.json({ success: true, token: 'secure_admin_token_xyz' });
    } else {
        res.status(401).json({ success: false, message: 'Invalid Admin Password' });
    }
});

app.post('/api/register', async (req, res) => {
    try {
        await connectDB();
        const { fullName, username, email, phone, password, referredBy } = req.body; // referredBy added
        const existing = await User.findOne({ username });
        if (existing) return res.status(400).json({ success: false, message: 'Username already exists' });
        const newUser = new User({ fullName, username, email, phone, password, referredBy: referredBy || '' });
        await newUser.save();
        res.json({ success: true, user: newUser });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        await connectDB();
        const loginIdentifier = req.body.input || req.body.username || req.body.email || req.body.identifier;
        const password = req.body.password;

        if (!loginIdentifier) {
            return res.status(400).json({ success: false, message: 'Please provide username or email' });
        }

        const user = await User.findOne({ 
            $or: [
                { username: { $regex: new RegExp(`^${loginIdentifier.trim()}$`, 'i') } }, 
                { email: { $regex: new RegExp(`^${loginIdentifier.trim()}$`, 'i') } }
            ] 
        });

        if (!user || !password || user.password !== password.trim()) {
            return res.status(400).json({ success: false, message: 'Invalid credentials' });
        }
        res.status(200).json({ success: true, user });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Minimum Withdrawal Limit & 17% Tax Calculation
app.post('/api/withdraw', async (req, res) => {
    try {
        await connectDB();
        const { username, method, accountNumber, accountName, amount } = req.body;
        const withdrawAmount = Number(amount);

        if (withdrawAmount < 90) {
            return res.status(400).json({ success: false, message: 'Minimum withdrawal amount is $90' });
        }

        // Check user balance
        const user = await User.findOne({ username: { $regex: new RegExp(`^${username}$`, 'i') } });
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        if (user.balance < withdrawAmount) {
            return res.status(400).json({ success: false, message: 'Insufficient balance' });
        }

        const tax = withdrawAmount * 0.17;
        const netAmount = withdrawAmount - tax;

        const newTx = new Transaction({ 
            username, 
            type: 'withdrawal', 
            amount: withdrawAmount, 
            tax: tax,
            netAmount: netAmount,
            method, 
            accountDetails: `${accountNumber} (${accountName})`, 
            status: 'Pending' 
        });
        await newTx.save();
        res.json({ success: true, message: 'Withdrawal requested successfully' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Minimum Deposit Limit ($100)
app.post('/api/deposit', async (req, res) => {
    try {
        await connectDB();
        const { username, method, sender, amount } = req.body;
        const depositAmount = Number(amount);

        if (depositAmount < 100) {
            return res.status(400).json({ success: false, message: 'Minimum deposit amount is $100' });
        }

        const newTx = new Transaction({ 
            username, 
            type: 'deposit', 
            amount: depositAmount, 
            netAmount: depositAmount,
            method, 
            accountDetails: `Sender: ${sender}`, 
            status: 'Pending' 
        });
        await newTx.save();
        res.json({ success: true, message: 'Deposit requested successfully' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// User Transaction History Route
app.get('/api/transactions/:username', async (req, res) => {
    try {
        await connectDB();
        const { username } = req.params;
        const transactions = await Transaction.find({ username }).sort({ createdAt: -1 });
        res.json(transactions);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/admin/users', async (req, res) => {
    try {
        await connectDB();
        const users = await User.find({});
        res.json(users);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Admin Route to Edit User Credentials
app.post('/api/admin/user/update', async (req, res) => {
    try {
        await connectDB();
        const { userId, username, email, password } = req.body;
        await User.findByIdAndUpdate(userId, { username, email, password });
        res.json({ success: { success: true }, message: 'User updated successfully' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.get('/api/admin/withdrawals', async (req, res) => {
    try {
        await connectDB();
        const withdrawals = await Transaction.find({ type: 'withdrawal' });
        res.json(withdrawals);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/admin/deposits', async (req, res) => {
    try {
        await connectDB();
        const deposits = await Transaction.find({ type: 'deposit' });
        res.json(deposits);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/admin/transaction/update', async (req, res) => {
    try {
        await connectDB();
        const { reqId, status } = req.body;
        const tx = await Transaction.findById(reqId);
        if (!tx) return res.status(404).json({ success: false, message: "Transaction nahi mili" });

        const normalizedStatus = status ? status.toLowerCase() : '';
        const normalizedType = tx.type ? tx.type.toLowerCase() : '';

        // Deposit Approve hone par balance add hoga
        if ((normalizedStatus === 'approved' || normalizedStatus === 'approve') && normalizedType === 'deposit' && tx.status !== 'Approved') {
            const updatedUser = await User.findOneAndUpdate(
                { username: { $regex: new RegExp(`^${tx.username}$`, 'i') } }, 
                { $inc: { balance: Number(tx.amount) } },
                { new: true }
            );
            
            if (!updatedUser) {
                return res.status(404).json({ success: false, message: `User '${tx.username}' database mein nahi mila!` });
            }
        }

        // Withdrawal Approve hone par user ke balance se amount deduct hogi
        if ((normalizedStatus === 'approved' || normalizedStatus === 'approve') && normalizedType === 'withdrawal' && tx.status !== 'Approved') {
            const updatedUser = await User.findOneAndUpdate(
                { username: { $regex: new RegExp(`^${tx.username}$`, 'i') } }, 
                { $inc: { balance: -Number(tx.amount) } },
                { new: true }
            );
            
            if (!updatedUser) {
                return res.status(404).json({ success: false, message: `User '${tx.username}' database mein nahi mila!` });
            }
        }

        tx.status = status;
        await tx.save();
        res.json({ success: true, message: "Transaction status update ho gaya" });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Update failed: ' + err.message });
    }
});

// Fixed Announcement Routes
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
        await Announcement.deleteMany({});
        const newAnn = new Announcement({ text });
        await newAnn.save();
        res.json({ success: true, message: 'Announcement updated' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Update failed' });
    }
});

module.exports = app;
