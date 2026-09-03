Const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const path = require('path');
const axios = require('axios');

const app = express();
app.use(express.json());
app.use(cors());

const MONGO_URI = 'mongodb+srv://khanreturnsuk_db_user:admin12345@cluster0.irfj6ne.mongodb.net/dbl_database?appName=Cluster0';

// Tron TRC-20 USDT Official Contract Address and Admin Wallet
const USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const ADMIN_WALLET = 'TKiPY8H7GT4JZpSUVxvPiPY2bnzTxCcRjz';

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
    balance: { type: Number, default: 0 },        // Sirf earnings/profits (withdrawable)
    investedAmount: { type: Number, default: 0 },  // VIP deposit principal (non-withdrawable)
    vipLevel: { type: String, default: 'VIP 1' },
    referredBy: { type: String, default: '' },
    taskDone: { type: Boolean, default: false },
    lastTaskDate: { type: String, default: '' },
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
        const { fullName, username, email, phone, password, referredBy } = req.body;
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

        // Auto-reset task if a new day has started (Midnight reset)
        const today = new Date().toDateString();
        if (user.lastTaskDate !== today) {
            user.taskDone = false;
            await user.save();
        }

        res.status(200).json({ success: true, user });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Daily Task Completion Route with Automatic Midnight Reset
app.post('/api/complete-task', async (req, res) => {
    try {
        await connectDB();
        const { username } = req.body;
        if (!username) {
            return res.status(400).json({ success: false, message: "Username is required" });
        }

        const user = await User.findOne({ username: new RegExp(`^${username}$`, 'i') });
        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        const today = new Date().toDateString();
        
        if (user.lastTaskDate !== today) {
            user.taskDone = false;
        }

        if (user.taskDone && user.lastTaskDate === today) {
            return res.status(400).json({ success: false, message: "Task already completed today!" });
        }

        const totalBalance = (user.balance || 0) + (user.investedAmount || 0);
        
        let reward = 1.00;
        if (totalBalance >= 5000) reward = 50.00;
        else if (totalBalance >= 1000) reward = 10.00;
        else if (totalBalance >= 800) reward = 8.00;
        else if (totalBalance >= 500) reward = 5.00;
        else if (totalBalance >= 200) reward = 2.00;
        else if (totalBalance >= 100) reward = 1.00;

        user.balance = (user.balance || 0) + reward;
        user.taskDone = true;
        user.lastTaskDate = today;

        await user.save();

        res.json({
            success: true,
            message: "Task completed successfully",
            balance: user.balance,
            reward: reward
        });
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

        const user = await User.findOne({ username: { $regex: new RegExp(`^${username}$`, 'i') } });
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        if (user.balance < withdrawAmount) {
            return res.status(400).json({ success: false, message: 'Insufficient earnings balance for withdrawal. Deposited funds cannot be withdrawn.' });
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

// Minimum Deposit Limit ($100) with Strict Tron TRC-20 Auto-Verification & Admin Unlimited Test Bypass
app.post('/api/deposit', async (req, res) => {
    try {
        await connectDB();
        const { username, method, sender, amount, txid } = req.body;
        const depositAmount = Number(amount);

        if (depositAmount < 100) {
            return res.status(400).json({ success: false, message: 'Minimum deposit amount is $100' });
        }

        if (!txid || txid.trim() === '') {
            return res.status(400).json({ success: false, message: 'Transaction Hash (TxID) is required for auto-verification' });
        }

        const cleanTxid = txid.trim();
        const lowerUsername = username ? username.toLowerCase().trim() : '';
        const TEST_ADMIN_TXID = "DBL_TEST_TXID_12345";

        let isValidTransfer = false;

        // ==========================================
        // ADMIN UNLIMITED TEST TRANSACTION BYPASS
        // ==========================================
        if (cleanTxid === TEST_ADMIN_TXID) {
            if (lowerUsername === 'anas_admin' || lowerUsername === 'admin') {
                isValidTransfer = true; // Admin ke liye unlimited times bypass karega aur error nahi dega
            } else {
                return res.status(400).json({ 
                    success: false, 
                    message: 'Invalid or unauthorized transaction ID.' 
                });
            }
        } else {
            // Aam users ke liye purana single-use check (duplicate TxID check)
            const existingTx = await Transaction.findOne({ accountDetails: { $regex: cleanTxid, $options: 'i' } });
            if (existingTx) {
                return res.status(400).json({ success: false, message: 'This Transaction ID (TxID) has already been used!' });
            }

            // Strict TronGrid API check for regular users
            try {
                const tronGridUrl = `https://api.trongrid.io/v1/transactions/${cleanTxid}/events`;
                const response = await axios.get(tronGridUrl);
                const events = response.data.data;

                if (events && events.length > 0) {
                    for (let event of events) {
                        if (event.contract_address === USDT_CONTRACT && event.event_name === 'Transfer') {
                            const toAddress = event.result.to;
                            const rawValue = Number(event.result.value);
                            const actualValue = rawValue / 1000000;

                            if (toAddress === ADMIN_WALLET && actualValue >= depositAmount) {
                                isValidTransfer = true;
                                break;
                            }
                        }
                    }
                }
            } catch (apiErr) {
                console.error('TronGrid API Error or Invalid TxID:', apiErr.message);
                isValidTransfer = false;
            }
        }

        if (!isValidTransfer) {
            return res.status(400).json({ 
                success: false, 
                message: 'Auto-verification failed! Invalid TxID, transaction not found on blockchain, amount mismatch, or incorrect recipient.' 
            });
        }

        const newTx = new Transaction({ 
            username, 
            type: 'deposit', 
            amount: depositAmount, 
            netAmount: depositAmount,
            method: method || 'USDT TRC20', 
            accountDetails: `TxID: ${cleanTxid} | Sender: ${sender || 'N/A'}`, 
            status: 'Approved' 
        });
        await newTx.save();

        await User.findOneAndUpdate(
            { username: { $regex: new RegExp(`^${username}$`, 'i') } },
            { $inc: { investedAmount: depositAmount } }
        );

        return res.json({ success: true, message: 'Deposit verified and approved successfully!' });

    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

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

        if ((normalizedStatus === 'approved' || normalizedStatus === 'approve') && normalizedType === 'deposit' && tx.status !== 'Approved') {
            const updatedUser = await User.findOneAndUpdate(
                { username: { $regex: new RegExp(`^${tx.username}$`, 'i') } }, 
                { $inc: { investedAmount: Number(tx.amount) } },
                { new: true }
            );
            
            if (!updatedUser) {
                return res.status(404).json({ success: false, message: `User '${tx.username}' database mein nahi mila!` });
            }
        }

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
