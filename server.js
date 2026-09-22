const express = require('express');
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
    balance: { type: Number, default: 0 },        // Withdrawable balance / winnings
    investedAmount: { type: Number, default: 0 },  // Non-withdrawable principal/deposit
    vipLevel: { type: String, default: 'VIP 1' },
    referredBy: { type: String, default: '' },
    taskDone: { type: Boolean, default: false },
    lastTaskDate: { type: String, default: '' },
    totalWagered: { type: Number, default: 0 },
    gameHistory: [{
        gameType: String,
        betAmount: Number,
        multiplier: Number,
        payout: Number,
        isWin: Boolean,
        timestamp: { type: Date, default: Date.now }
    }],
    createdAt: { type: Date, default: Date.now }
});

const transactionSchema = new mongoose.Schema({
    username: String,
    type: String, // 'deposit' | 'withdrawal'
    amount: Number,
    tax: { type: Number, default: 0 },
    netAmount: { type: Number, default: 0 },
    method: String, // 'Easypaisa', 'JazzCash', 'Bank Transfer', 'USDT TRC20'
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

// ==========================================
// NEW GAMING ENGINE ROUTE (Aviator / Mining / Dice)
// ==========================================
app.post('/api/game/play', async (req, res) => {
    try {
        await connectDB();
        const { username, betAmount, gameType, multiplierChoice } = req.body;
        const bAmount = Number(betAmount);

        if (!username || bAmount <= 0) {
            return res.status(400).json({ success: false, message: 'Valid username and bet amount required' });
        }

        const user = await User.findOne({ username: { $regex: new RegExp(`^${username}$`, 'i') } });
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        if (user.balance < bAmount) {
            return res.status(400).json({ success: false, message: 'Insufficient balance for this bet' });
        }

        // Deduct bet amount from balance
        user.balance -= bAmount;
        user.totalWagered = (user.totalWagered || 0) + bAmount;

        let multiplier = 0;
        let isWin = false;

        if (gameType === 'mining') {
            // 60% win probability example for grid/mining
            isWin = Math.random() > 0.4;
            multiplier = isWin ? 1.6 : 0;
        } else if (gameType === 'aviator') {
            // Crash point RNG (exponential-like distribution or target match)
            const crashPoint = Number((1 + Math.random() * Math.random() * 8).toFixed(2));
            const target = Number(multiplierChoice || 2.0);
            if (crashPoint >= target) {
                isWin = true;
                multiplier = target;
            } else {
                isWin = false;
                multiplier = 0;
            }
        } else {
            // Default coin/dice multiplier fallback
            isWin = Math.random() > 0.5;
            multiplier = isWin ? 2.0 : 0;
        }

        const payout = Number((bAmount * multiplier).toFixed(2));
        user.balance += payout;

        const gameRecord = {
            gameType: gameType || 'general',
            betAmount: bAmount,
            multiplier,
            payout,
            isWin,
            timestamp: new Date()
        };

        user.gameHistory.push(gameRecord);
        if (user.gameHistory.length > 50) user.gameHistory.shift(); // keep last 50

        await user.save();
        res.json({
            success: true,
            isWin,
            multiplier,
            payout,
            balance: user.balance,
            message: isWin ? `You won ${payout}!` : 'You lost this round!'
        });
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

// Pakistan Local + Crypto Withdrawal Route (Min 90 / PKR equivalent handling)
app.post('/api/withdraw', async (req, res) => {
    try {
        await connectDB();
        const { username, method, accountNumber, accountName, amount } = req.body;
        const withdrawAmount = Number(amount);

        if (withdrawAmount < 50) {
            return res.status(400).json({ success: false, message: 'Minimum withdrawal amount is $50 / PKR equivalent' });
        }

        const user = await User.findOne({ username: { $regex: new RegExp(`^${username}$`, 'i') } });
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        if (user.balance < withdrawAmount) {
            return res.status(400).json({ success: false, message: 'Insufficient earnings/game balance for withdrawal.' });
        }

        const tax = withdrawAmount * 0.17;
        const netAmount = withdrawAmount - tax;

        const newTx = new Transaction({ 
            username, 
            type: 'withdrawal', 
            amount: withdrawAmount, 
            tax: tax,
            netAmount: netAmount,
            method: method || 'Easypaisa/JazzCash', 
            accountDetails: `${accountNumber} (${accountName})`, 
            status: 'Pending' 
        });
        await newTx.save();
        res.json({ success: true, message: 'Withdrawal requested successfully for manual review' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Pakistan Local (Easypaisa/JazzCash Manual Proof) + Crypto Deposit Route
app.post('/api/deposit', async (req, res) => {
    try {
        await connectDB();
        const { username, method, sender, amount, txid, receiptInfo } = req.body;
        const depositAmount = Number(amount);

        if (depositAmount < 10) {
            return res.status(400).json({ success: false, message: 'Minimum deposit amount is $10 or PKR equivalent' });
        }

        const isLocalPK = ['easypaisa', 'jazzcash', 'bank transfer'].includes((method || '').toLowerCase());
        let isValidTransfer = false;
        let cleanTxid = (txid || receiptInfo || '').trim();

        if (isLocalPK) {
            // Local PK manual verification receipt submit flow
            if (!cleanTxid) {
                return res.status(400).json({ success: false, message: 'Transaction ID / TID / Screenshot reference is required for local payment verification.' });
            }
            isValidTransfer = true; // Goes to pending review or immediate test bypass if admin
        } else {
            // Crypto TRC20 verification logic (existing)
            const TEST_ADMIN_TXID = "DBL_TEST_TXID_12345";
            const lowerUsername = username ? username.toLowerCase().trim() : '';
            if (cleanTxid === TEST_ADMIN_TXID && lowerUsername === 'anas_admin') {
                isValidTransfer = true;
            } else if (cleanTxid === TEST_ADMIN_TXID) {
                return res.status(400).json({ success: false, message: 'Invalid or unauthorized transaction ID.' });
            } else {
                const existingTx = await Transaction.findOne({ accountDetails: { $regex: cleanTxid,$options: 'i' } });
                if (existingTx) {
                    return res.status(400).json({ success: false, message: 'This Transaction ID (TxID) has already been used!' });
                }
                try {
                    const tronGridUrl = `https://api.trongrid.io/v1/transactions/${cleanTxid}/events`;
                    const response = await axios.get(tronGridUrl);
                    const events = response.data.data;
                    if (events && events.length > 0) {
                        for (let event of events) {
                            if (event.contract_address === USDT_CONTRACT && event.event_name === 'Transfer') {
                                const toAddress = event.result.to;
                                const actualValue = Number(event.result.value) / 1000000;
                                if (toAddress === ADMIN_WALLET && actualValue >= depositAmount) {
                                    isValidTransfer = true;
                                    break;
                                }
                            }
                        }
                    }
                } catch (apiErr) {
                    isValidTransfer = false;
                }
            }
        }

        if (!isValidTransfer && !isLocalPK) {
            return res.status(400).json({ success: false, message: 'Auto-verification failed! Invalid Crypto TxID.' });
        }

        const initialStatus = isLocalPK ? 'Pending' : 'Approved';

        const newTx = new Transaction({ 
            username, 
            type: 'deposit', 
            amount: depositAmount, 
            netAmount: depositAmount,
            method: method || 'USDT TRC20', 
            accountDetails: `Ref/TxID: ${cleanTxid} | Sender: ${sender || 'N/A'}`, 
            status: initialStatus 
        });
        await newTx.save();

        let updatedUser = null;
        if (!isLocalPK) {
            updatedUser = await User.findOneAndUpdate(
                { username: { $regex: new RegExp(`^${username}$`, 'i') } },
                { $inc: { investedAmount: depositAmount, balance: depositAmount } },
                { new: true }
            );
        }

        return res.json({ 
            success: true, 
            message: isLocalPK ? 'Local deposit submitted for admin approval!' : 'Deposit verified and approved successfully!', 
            user: updatedUser 
        });

    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Case-insensitive transactions route fix
app.get('/api/transactions/:username', async (req, res) => {
    try {
        await connectDB();
        const { username } = req.params;
        const transactions = await Transaction.find({ 
            username: new RegExp(`^${username}$`, 'i') 
        }).sort({ createdAt: -1 });
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
        res.json({ success: true, message: 'User updated successfully' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.change || err.message });
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
                { $inc: { investedAmount: Number(tx.amount), balance: Number(tx.amount) } },
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

app.post('/api/admin/announcement/update', additions = false, ...rest);
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
