const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
    userId: { type: String, required: true, index: true },
    title: { type: String, required: true },
    amount: { type: Number, required: true },
    category: { type: String, required: true },
    date: { type: String, required: true, index: true },

    // Feature 2: Embedded Arrays for Custom Tags
    tags: [String],

    // Feature 3: Dynamic / Optional Attributes (Schemaless flexibility)
    isSplit: { type: Boolean, default: false },
    settled: { type: Boolean, default: false },
    isRecurring: { type: Boolean, default: false },
    frequency: { type: String },

    // Feature 6: Unstructured Binary Document / Receipt Stored Natively in MongoDB
    receiptData: Buffer,
    receiptContentType: String,

    // Feature 5: Geospatial Indexing (GeoJSON Point for location tracking)
    location: {
        type: { type: String, enum: ['Point'], default: 'Point' },
        coordinates: { type: [Number], default: [0, 0] } // [Longitude, Latitude]
    }
}, { timestamps: true });

// Geospatial index for $near queries
transactionSchema.index({ location: '2dsphere' });

module.exports = mongoose.model('Transaction', transactionSchema);