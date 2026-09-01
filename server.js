const express = require('express');
const cors = require('cors');
const Datastore = require('nedb-promises');

const app = express();
app.use(express.json());
app.use(cors());

const usersDB = Datastore.create({ filename: 'users.db', autoload: true });
const txDB = Datastore.create({ filename: 'transactions.db', autoload: true });
const newsDB = Datastore.create({ filename: 'news.db', autoload: true });

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

app.post('/api/register', async (req, res) => {
    try {
        const { fullName, username, email, phone, password } = req.body;
        const existing = await usersDB.findOne({ username });
        if (existing) return res.status(400).json({ success: false, message: 'Username exists' });

        const newUser = await usersDB.insert({
            fullName, username, email, phone, password,
            balance: 100, vipLevel: 'VIP 1', createdAt: new Date()
        });
        res.json({ success: true, user: newUser });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/transaction', async (req, res) => {
    try {
        const { username, type, amount, method, accountDetails } = req.body;
        const newTx = await txDB.insert({
            username, type, amount: Number(amount), method, accountDetails,
            status: 'Pending', createdAt: new Date()
        });
        res.json({ success: true, transaction: newTx });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.get('/api/admin/dashboard', async (req, res) => {
    try {
        const users = await usersDB.find({}).sort({ createdAt: -1 });
        const pending = await txDB.find({ status: 'Pending' });
        res.json({ success: true, totalUsers: users.length, pendingTransactions: pending.length });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.get('/api/admin/transactions', async (req, res) => {
    try {
        const transactions = await txDB.find({}).sort({ createdAt: -1 });
        res.json({ success: true, transactions });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/admin/transaction/status', async (req, res) => {
    const { transactionId, status } = req.body;
    try {
        const txn = await txDB.findOne({ _id: transactionId });
        if (!txn) return res.status(404).json({ success: false, message: 'Transaction not found' });
        if (txn.status !== 'Pending') return res.status(400).json({ success: false, message: 'Already processed' });

        const user = await usersDB.findOne({ username: txn.username });
        if (user) {
            if (status === 'Success' && txn.type === 'Deposit') user.balance += txn.amount;
            if (status === 'Rejected' && txn.type === 'Withdraw') user.balance += txn.amount;
            user.vipLevel = getVipLevel(user.balance);
            await usersDB.update({ _id: user._id }, user);
        }
        await txDB.update({ _id: txn._id }, { $set: { status } });

        res.json({ success: true, message: `Status updated to ${status}` });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/admin/announcements', async (req, res) => {
    try {
        const { message } = req.body;
        await newsDB.insert({ message, createdAt: new Date() });
        res.json({ success: true, message: 'Announcement published successfully' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.get('/admin', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>DBL Admin Panel</title>
            <style>
                body { font-family: sans-serif; background: #121212; color: #fff; padding: 15px; margin: 0; }
                h1 { color: #00e676; }
                .card { background: #1e1e1e; padding: 15px; margin-bottom: 15px; border-radius: 8px; border: 1px solid #333; }
                table { width: 100%; border-collapse: collapse; margin-top: 10px; }
                th, td { border: 1px solid #333; padding: 8px; text-align: left; font-size: 12px; }
                th { background: #2a2a2a; color: #00e676; }
                button { padding: 6px 10px; border: none; border-radius: 4px; font-weight: bold; cursor: pointer; margin-right: 4px; }
                .btn-app { background: #00e676; color: #000; }
                .btn-rej { background: #ff5252; color: #fff; }
                input { width: 90%; padding: 8px; margin-bottom: 10px; background: #2a2a2a; border: 1px solid #444; color: #fff; border-radius: 4px; }
            </style>
        </head>
        <body>
            <h1>DBL Admin Panel</h1>
            <div class="card">
                <p>Total Users: <b id="u">0</b> | Pending Requests: <b id="p">0</b></p>
            </div>
            <div class="card">
                <h3>📢 Add Announcement / News</h3>
                <input type="text" id="newsMsg" placeholder="Type notification..." /><br>
                <button class="btn-app" onclick="postNews()">Post News</button>
            </div>
            <div class="card">
                <h3>Transactions Control</h3>
                <table>
                    <thead>
                        <tr><th>User</th><th>Type</th><th>Amount</th><th>Status</th><th>Action</th></tr>
                    </thead>
                    <tbody id="tb"></tbody>
                </table>
            </div>
            <script>
                async function load() {
                    const d = await (await fetch('/api/admin/dashboard')).json();
                    document.getElementById('u').innerText = d.totalUsers;
                    document.getElementById('p').innerText = d.pendingTransactions;
                    const t = await (await fetch('/api/admin/transactions')).json();
                    const tb = document.getElementById('tb');
                    tb.innerHTML = '';
                    if(t.transactions.length === 0) {
                        tb.innerHTML = '<tr><td colspan="5" style="text-align:center;">No Requests Found</td></tr>';
                    } else {
                        t.transactions.forEach(x => {
                            let act = x.status === 'Pending' ? 
                                \`<button class="btn-app" onclick="up('\${x._id}','Success')">Approve</button>
                                 <button class="btn-rej" onclick="up('\${x._id}','Rejected')">Reject</button>\` : x.status;
                            tb.innerHTML += \`<tr><td>\${x.username}</td><td>\${x.type}</td><td>Rs.\${x.amount}</td><td>\${x.status}</td><td>\${act}</td></tr>\`;
                        });
                    }
                }
                async function up(id, status) {
                    await fetch('/api/admin/transaction/status', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ transactionId: id, status })
                    });
                    load();
                }
                async function postNews() {
                    const msg = document.getElementById('newsMsg').value;
                    if(!msg) return alert('Enter news text!');
                    await fetch('/api/admin/announcements', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ message: msg })
                    });
                    alert('Announcement Live!');
                    document.getElementById('newsMsg').value = '';
                }
                load();
                setInterval(load, 4000);
            </script>
        </body>
        </html>
    `);
});

app.listen(5000, () => console.log('Server running on port 5000'));
