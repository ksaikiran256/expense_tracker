require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const fs = reuire('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));
app.get('/', (req, res) => {
    try {
        const htmlPath = path.join(__dirname, 'index.html');
        const html = fs.readFileSync(htmlPath, 'utf8');
        res.send(html);
    } catch (err) {
        res.status(404).send("Frontend document not found");
    }
});
// Configure Multer for in-memory storage (Direct binary buffer insertion into MongoDB)
const upload = multer({ storage: multer.memoryStorage() });

// Connect to MongoDB Atlas (Online Cluster via Environment Variable)
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/wealthpulse';

async function connectDB() {
    if (mongoose.connection.readyState >= 1) return;
    try {
        await mongoose.connect(MONGODB_URI);
        console.log("Connected to MongoDB Database");
    } catch (err) {
        console.error("MongoDB Connection Error:", err);
    }
}
connectDB();
// Mongoose Schemas
const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    monthlyBudget: { type: Number, default: 10000 }
});
const User = mongoose.model('User', userSchema);

const Transaction = require('./models/Transaction');

// --- AUTH ROUTES ---
app.post('/api/signup', async (req, res) => {
    try {
        const { name, email, password } = req.body;
        const existing = await User.findOne({ email });
        if (existing) return res.status(400).json({ error: "Email already registered" });

        const newUser = new User({ name, email, password });
        await newUser.save();
        res.json({ message: "User registered successfully", user: newUser });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email, password });
        if (!user) return res.status(400).json({ error: "Invalid credentials" });
        res.json({ message: "Login successful", user });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.patch('/api/user/budget', async (req, res) => {
    try {
        const { email, budget } = req.body;
        const user = await User.findOneAndUpdate(
            { email },
            { monthlyBudget: budget },
            { returnDocument: 'after' }
        );
        res.json({ message: "Budget updated", user });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- TRANSACTION ROUTES ---
app.get('/api/expenses/:email', async (req, res) => {
    try {
        const transactions = await Transaction.find({ userId: req.params.email })
            .select('-receiptData')
            .sort({ date: -1, createdAt: -1 });

        const mapped = transactions.map(t => ({
            ...t.toObject(),
            hasReceipt: !!t.receiptContentType // flag to indicate whether DB binary receipt exists
        }));

        res.json(mapped);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ENDPOINT TO SERVE RECEIPT DIRECTLY FROM DATABASE BINARY BUFFER
app.get('/api/expenses/receipt/:id', async (req, res) => {
    try {
        const tx = await Transaction.findById(req.params.id);
        if (!tx || !tx.receiptData) {
            return res.status(404).json({ error: "Receipt document not found in database" });
        }
        res.set('Content-Type', tx.receiptContentType || 'image/jpeg');
        res.send(tx.receiptData);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// CREATE Transaction with Database Binary Storage
app.post('/api/expenses', upload.single('receipt'), async (req, res) => {
    try {
        const { userId, title, amount, category, date, tags, isSplit, isRecurring, frequency, longitude, latitude } = req.body;

        let parsedTags = [];
        if (tags) {
            parsedTags = tags.split(',').map(t => t.trim()).filter(t => t.length > 0);
        }

        const newTx = new Transaction({
            userId,
            title,
            amount: parseFloat(amount),
            category,
            date,
            tags: parsedTags,
            isSplit: isSplit === 'true',
            isRecurring: isRecurring === 'true',
            frequency,
            receiptData: req.file ? req.file.buffer : undefined,
            receiptContentType: req.file ? req.file.mimetype : undefined,
            location: {
                type: 'Point',
                coordinates: [parseFloat(longitude) || 0, parseFloat(latitude) || 0]
            }
        });

        await newTx.save();
        res.json(newTx);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// UPDATE Transaction
app.patch('/api/expenses/:id', upload.single('receipt'), async (req, res) => {
    try {
        const { title, amount, category, date } = req.body;
        const updateData = { title, amount: parseFloat(amount), category, date };
        if (req.file) {
            updateData.receiptData = req.file.buffer;
            updateData.receiptContentType = req.file.mimetype;
        }
        const updated = await Transaction.findByIdAndUpdate(req.params.id, updateData, { returnDocument: 'after' });
        res.json(updated);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.patch('/api/expenses/settle/:id', async (req, res) => {
    try {
        const tx = await Transaction.findById(req.params.id);
        tx.settled = !tx.settled;
        await tx.save();
        res.json(tx);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/expenses/:id', async (req, res) => {
    try {
        await Transaction.findByIdAndDelete(req.params.id);
        res.json({ message: "Transaction deleted" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- AGGREGATION PIPELINE ROUTES ---
app.get('/api/analytics/category/:email', async (req, res) => {
    try {
        const currentMonthPrefix = new Date().toISOString().slice(0, 7);
        const aggregation = await Transaction.aggregate([
            { $match: { userId: req.params.email, date: { $regex: `^${currentMonthPrefix}` } } },
            {
                $group: {
                    _id: "$category",
                    totalSpent: { $sum: "$amount" },
                    count: { $sum: 1 }
                }
            }, { $sort: { totalSpent: -1 } }
        ]);
        res.json(aggregation);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/analytics/trends/:email', async (req, res) => {
    try {
        const now = new Date();
        const currentMonthPrefix = now.toISOString().slice(0, 7);

        const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const prevMonthPrefix = prevDate.toISOString().slice(0, 7);

        const currentTxs = await Transaction.find({ userId: req.params.email, date: { $regex: `^${currentMonthPrefix}` } });
        const prevTxs = await Transaction.find({ userId: req.params.email, date: { $regex: `^${prevMonthPrefix}` } });

        const currentTotal = currentTxs.reduce((sum, t) => sum + t.amount, 0);
        const prevTotal = prevTxs.reduce((sum, t) => sum + t.amount, 0);

        res.json({ currentMonth: currentTotal, previousMonth: prevTotal });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- GEOSPATIAL QUERY ROUTE ---
app.get('/api/analytics/nearby/:email', async (req, res) => {
    const { longitude, latitude, maxDistanceKm = 5 } = req.query;
    try {
        if (!longitude || !latitude) {
            return res.status(400).json({ error: "Longitude and latitude required" });
        }

        const lng = parseFloat(longitude);
        const lat = parseFloat(latitude);
        const maxDistMeters = parseFloat(maxDistanceKm) * 1000;

        const transactions = await Transaction.find({ userId: req.params.email })
            .select('-receiptData')
            .where('location')
            .near({
                center: { type: 'Point', coordinates: [lng, lat] },
                maxDistance: maxDistMeters,
                spherical: true
            });

        const nearby = transactions.map(t => ({
            ...t.toObject(),
            hasReceipt: !!t.receiptContentType
        }));

        res.json(nearby);
    } catch (err) {
        console.error("Spatial Query Error:", err);
        res.status(500).json({ error: err.message });
    }
});

// --- CSV LEDGER EXPORT ROUTE ---
app.get('/api/export/csv/:email', async (req, res) => {
    try {
        const txs = await Transaction.find({ userId: req.params.email });
        let csv = 'Title,Amount,Category,Date,Tags,Split,Recurring\n';
        txs.forEach(t => {
            csv += `"${t.title}",${t.amount},"${t.category}","${t.date}","${(t.tags || []).join(';')}",${t.isSplit},${t.isRecurring}\n`;
        });
        res.header('Content-Type', 'text/csv');
        res.attachment(`wealthpulse-ledger-${req.params.email}.csv`);
        res.send(csv);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Export app for Vercel Serverless deployment, while keeping local node execution support
if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

module.exports = app;