// نقطة الدخول الرئيسية - Vercel بيشغّل الملف ده كـ serverless function لأي مسار
// (بفضل قاعدة rewrites في vercel.json). لو بتشغّله محليًا، استخدم server.js في الجذر.
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const nodemailer = require('nodemailer');

const app = express();
app.use(express.json({ limit: '10mb' })); // limit عالي عشان صور المنتجات (base64) لو العميل رفعها من الجهاز

// ---------- إشعارات SMS (اختياري - لو المتغيرات فاضية، الميزة بتتجاهل نفسها بأمان) ----------
const twilioClient = (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN)
  ? require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null;

// بيحول رقم مصري محلي (زي 01012345678) لصيغة دولية (+201012345678)
function toEgyptInternational(phone) {
  let digits = String(phone || '').replace(/[^\d]/g, '');
  if (digits.startsWith('0')) digits = '20' + digits.slice(1);
  else if (!digits.startsWith('20')) digits = '20' + digits;
  return '+' + digits;
}

const orderStatusLabelsAr = { pending: 'قيد المعالجة', shipped: 'تم الشحن', delivered: 'تم التسليم', cancelled: 'ملغي' };

async function sendOrderStatusSMS(order) {
  if (!twilioClient || !process.env.TWILIO_SMS_FROM) return; // الميزة مش متفعّلة
  try {
    const label = orderStatusLabelsAr[order.status] || order.status;
    const trackingLine = order.trackingInfo ? ` رقم التتبع: ${order.trackingInfo}` : '';
    await twilioClient.messages.create({
      from: process.env.TWILIO_SMS_FROM,
      to: toEgyptInternational(order.phone),
      body: `مرحبًا ${order.customerName}، حالة طلبك ${order.id} بقت: ${label}.${trackingLine}`
    });
  } catch (e) {
    console.error('فشل إرسال SMS:', e.message);
  }
}

async function runBackupJob() {
  if (!process.env.BACKUP_EMAIL_TO || !process.env.BACKUP_EMAIL_USER || !process.env.BACKUP_EMAIL_PASS) return;
  try {
    const backup = {
      categories: (await Category.find()).map(x => x.toJSON()),
      products: (await Product.find()).map(x => x.toJSON()),
      orders: (await Order.find()).map(x => x.toJSON()),
      coupons: (await Coupon.find()).map(x => x.toJSON()),
      customers: (await Customer.find()).map(x => x.toJSON()),
      reviews: (await Review.find()).map(x => x.toJSON()),
      settings: await Settings.findOne(),
      contact: await Contact.findOne(),
      exportedAt: new Date().toISOString()
    };
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.BACKUP_EMAIL_USER, pass: process.env.BACKUP_EMAIL_PASS }
    });
    await transporter.sendMail({
      from: process.env.BACKUP_EMAIL_USER,
      to: process.env.BACKUP_EMAIL_TO,
      subject: `نسخة احتياطية - ACS Store - ${new Date().toLocaleDateString('ar-EG')}`,
      text: 'مرفق نسخة احتياطية كاملة من قاعدة بيانات المتجر.',
      attachments: [{ filename: `acs-backup-${Date.now()}.json`, content: JSON.stringify(backup, null, 2) }]
    });
    console.log('✓ Backup email sent');
  } catch (e) {
    console.error('✗ فشل إرسال النسخة الاحتياطية:', e.message);
  }
}

app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'بيانات غير صالحة' });
  next(err);
});

const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'طلبات كتير جدًا، حاول تاني بعد شوية' }
});
const orderLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'عدد كبير من الطلبات في وقت قصير، حاول تاني بعد شوية' }
});

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '*').split(',').map(s => s.trim());
app.use(cors({
  origin: function (origin, callback) {
    if (allowedOrigins.includes('*') || !origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  }
}));

let cachedConnection = null;
async function connectDB() {
  if (cachedConnection && mongoose.connection.readyState === 1) return cachedConnection;
  cachedConnection = await mongoose.connect(process.env.MONGODB_URI);
  return cachedConnection;
}
connectDB()
  .then(() => console.log('✓ Connected to MongoDB'))
  .catch(err => console.error('✗ MongoDB connection error:', err.message));

app.use(async (req, res, next) => {
  try { await connectDB(); next(); } catch (e) { res.status(503).json({ error: 'تعذر الاتصال بقاعدة البيانات، حاول تاني' }); }
});

const stripMeta = { transform: (_doc, ret) => { delete ret._id; delete ret.__v; return ret; } };

const categorySchema = new mongoose.Schema({
  id: { type: String, unique: true, required: true },
  name: { type: String, required: true },
  order: { type: Number, default: 0 }
}, { toJSON: stripMeta });

const productSchema = new mongoose.Schema({
  id: { type: String, unique: true, required: true },
  categoryId: String,
  name: String,
  price: Number,
  stock: { type: Number, default: 0 },
  maxPerCustomer: { type: Number, default: null },
  image: String,
  desc: String
}, { toJSON: stripMeta });

const orderItemSchema = new mongoose.Schema({
  productId: String, name: String, price: Number, qty: Number
}, { _id: false });

const orderSchema = new mongoose.Schema({
  id: { type: String, unique: true, required: true },
  customerName: String,
  phone: String,
  address: String,
  items: [orderItemSchema],
  subtotal: Number,
  discount: { type: Number, default: 0 },
  shipping: { type: Number, default: 0 },
  total: Number,
  couponCode: { type: String, default: null },
  status: { type: String, default: 'pending' },
  trackingInfo: { type: String, default: '' },
  date: { type: Date, default: Date.now }
}, { toJSON: stripMeta });

const couponSchema = new mongoose.Schema({
  id: { type: String, unique: true, required: true },
  code: { type: String, required: true, unique: true },
  type: { type: String, enum: ['percent', 'fixed'], default: 'percent' },
  value: Number,
  active: { type: Boolean, default: true }
}, { toJSON: stripMeta });

const customerSchema = new mongoose.Schema({
  phone: { type: String, unique: true, required: true },
  name: String,
  address: String,
  firstSeen: { type: Date, default: Date.now }
}, { toJSON: stripMeta });

const reviewSchema = new mongoose.Schema({
  id: { type: String, unique: true, required: true },
  productId: String,
  customerName: String,
  rating: Number,
  comment: String,
  date: { type: Date, default: Date.now }
}, { toJSON: stripMeta });

const activityLogSchema = new mongoose.Schema({
  id: { type: String, unique: true, required: true },
  action: String,
  date: { type: Date, default: Date.now }
}, { toJSON: stripMeta });

const contactSchema = new mongoose.Schema({
  phone: { type: String, default: '' },
  whatsapp: { type: String, default: '' },
  facebook: { type: String, default: '' }
}, { toJSON: stripMeta });

const settingsSchema = new mongoose.Schema({
  shippingFee: { type: Number, default: 30 },
  freeShippingThreshold: { type: Number, default: null },
  maintenanceMode: { type: Boolean, default: false },
  maintenanceMessage: { type: String, default: 'الموقع تحت الصيانة حاليًا، هنرجع قريب!' }
}, { toJSON: stripMeta });

const Category = mongoose.model('Category', categorySchema);
const Product = mongoose.model('Product', productSchema);
const Order = mongoose.model('Order', orderSchema);
const Coupon = mongoose.model('Coupon', couponSchema);
const Customer = mongoose.model('Customer', customerSchema);
const Review = mongoose.model('Review', reviewSchema);
const ActivityLog = mongoose.model('ActivityLog', activityLogSchema);
const Contact = mongoose.model('Contact', contactSchema);
const Settings = mongoose.model('Settings', settingsSchema);

const wrap = fn => (req, res) => fn(req, res).catch(err => {
  console.error(err);
  res.status(500).json({ error: err.message });
});
// ================= CATEGORIES =================
app.get('/api/categories', wrap(async (req, res) => {
  const list = await Category.find().sort({ order: 1 });
  res.json(list.map(c => c.toJSON()));
}));

app.post('/api/categories', writeLimiter, wrap(async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name || !req.body.id) return res.status(400).json({ error: 'اسم القسم مطلوب' });
  const count = await Category.countDocuments();
  const cat = await Category.create({ ...req.body, name, order: count });
  res.json(cat.toJSON());
}));

app.put('/api/categories/reorder', writeLimiter, wrap(async (req, res) => {
  const arr = req.body;
  await Promise.all(arr.map((c, idx) => Category.updateOne({ id: c.id }, { order: idx })));
  res.json({ ok: true });
}));

app.put('/api/categories/:id', writeLimiter, wrap(async (req, res) => {
  const cat = await Category.findOneAndUpdate({ id: req.params.id }, req.body, { new: true });
  res.json(cat ? cat.toJSON() : null);
}));

app.delete('/api/categories/:id', writeLimiter, wrap(async (req, res) => {
  await Category.deleteOne({ id: req.params.id });
  res.json({ ok: true });
}));

// ================= PRODUCTS =================
app.get('/api/products', wrap(async (req, res) => {
  const list = await Product.find();
  res.json(list.map(p => p.toJSON()));
}));

app.post('/api/products', writeLimiter, wrap(async (req, res) => {
  const name = String(req.body.name || '').trim();
  const price = Number(req.body.price);
  if (!name || !req.body.id || !Number.isFinite(price) || price < 0) {
    return res.status(400).json({ error: 'اسم المنتج والسعر مطلوبين وصحيحين' });
  }
  const prod = await Product.create({ ...req.body, name, price, stock: Number(req.body.stock) || 0 });
  res.json(prod.toJSON());
}));

app.put('/api/products/:id', writeLimiter, wrap(async (req, res) => {
  const prod = await Product.findOneAndUpdate({ id: req.params.id }, req.body, { new: true });
  res.json(prod ? prod.toJSON() : null);
}));

app.delete('/api/products/:id', writeLimiter, wrap(async (req, res) => {
  await Product.deleteOne({ id: req.params.id });
  res.json({ ok: true });
}));

// ================= ORDERS =================
app.get('/api/orders', wrap(async (req, res) => {
  const list = await Order.find().sort({ date: -1 });
  res.json(list.map(o => o.toJSON()));
}));

app.post('/api/orders', orderLimiter, wrap(async (req, res) => {
  const body = req.body || {};
  const phone = String(body.phone || '').replace(/[^\d]/g, '');
  const address = String(body.address || '').trim();
  const customerName = String(body.customerName || '').trim();
  const items = Array.isArray(body.items) ? body.items : [];

  if (!phone || phone.length < 8 || !address || !customerName || items.length === 0) {
    return res.status(400).json({ error: 'بيانات الطلب غير مكتملة، تأكد من الاسم ورقم التليفون والعنوان والمنتجات' });
  }
  for (const it of items) {
    if (!it.productId || !Number.isFinite(it.qty) || it.qty <= 0) {
      return res.status(400).json({ error: 'بيانات أحد المنتجات في الطلب غير صحيحة' });
    }
  }

  const decremented = [];
  for (const item of items) {
    const updated = await Product.findOneAndUpdate(
      { id: item.productId, stock: { $gte: item.qty } },
      { $inc: { stock: -item.qty } },
      { new: true }
    );
    if (!updated) {
      for (const d of decremented) await Product.updateOne({ id: d.productId }, { $inc: { stock: d.qty } });
      const prod = await Product.findOne({ id: item.productId });
      return res.status(409).json({
        error: prod ? `الكمية المتاحة من "${prod.name}" غير كافية (متبقي: ${prod.stock})` : 'المنتج لم يعد متوفرًا',
        productId: item.productId
      });
    }
    decremented.push({ productId: item.productId, qty: item.qty });
  }

  for (const item of items) {
    const product = await Product.findOne({ id: item.productId });
    if (product && product.maxPerCustomer) {
      const priorOrders = await Order.find({ phone, status: { $ne: 'cancelled' }, 'items.productId': item.productId });
      const priorQty = priorOrders.reduce((sum, o) => {
        const it = o.items.find(i => i.productId === item.productId);
        return sum + (it ? it.qty : 0);
      }, 0);
      if (priorQty + item.qty > product.maxPerCustomer) {
        for (const d of decremented) await Product.updateOne({ id: d.productId }, { $inc: { stock: d.qty } });
        return res.status(409).json({
          error: `تخطيت الحد الأقصى المسموح من "${product.name}" (الحد الأقصى ${product.maxPerCustomer} لكل عميل)`,
          productId: item.productId
        });
      }
    }
  }

  const uniqueId = 'ORD-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();

  const order = await Order.create({
    ...body,
    id: uniqueId,
    phone,
    address,
    customerName,
    items,
    status: 'pending',
    date: new Date()
  });
  res.json(order.toJSON());
}));

app.patch('/api/orders/:id', writeLimiter, wrap(async (req, res) => {
  const existing = await Order.findOne({ id: req.params.id });
  if (!existing) return res.status(404).json({ error: 'الطلب غير موجود' });
  const statusChanged = req.body.status && req.body.status !== existing.status;
  const order = await Order.findOneAndUpdate({ id: req.params.id }, req.body, { new: true });
  if (statusChanged) sendOrderStatusSMS(order);
  res.json(order.toJSON());
  // ================= COUPONS =================
app.get('/api/coupons', wrap(async (req, res) => {
  const list = await Coupon.find();
  res.json(list.map(c => c.toJSON()));
}));

app.post('/api/coupons', writeLimiter, wrap(async (req, res) => {
  const code = String(req.body.code || '').trim().toUpperCase();
  const value = Number(req.body.value);
  if (!code || !req.body.id || !Number.isFinite(value) || value < 0) {
    return res.status(400).json({ error: 'كود الكوبون والقيمة مطلوبين وصحيحين' });
  }
  const existing = await Coupon.findOne({ code });
  if (existing) return res.status(409).json({ error: 'كود الكوبون ده مستخدم بالفعل' });
  const coupon = await Coupon.create({ ...req.body, code, value });
  res.json(coupon.toJSON());
}));

app.put('/api/coupons/:id', writeLimiter, wrap(async (req, res) => {
  const coupon = await Coupon.findOneAndUpdate({ id: req.params.id }, req.body, { new: true });
  res.json(coupon ? coupon.toJSON() : null);
}));

app.delete('/api/coupons/:id', writeLimiter, wrap(async (req, res) => {
  await Coupon.deleteOne({ id: req.params.id });
  res.json({ ok: true });
}));

// ================= CUSTOMERS =================
app.get('/api/customers', wrap(async (req, res) => {
  const list = await Customer.find().sort({ firstSeen: -1 });
  res.json(list.map(c => c.toJSON()));
}));

app.post('/api/customers', writeLimiter, wrap(async (req, res) => {
  const { name, phone, address } = req.body;
  const customer = await Customer.findOneAndUpdate(
    { phone },
    { $set: { name, address }, $setOnInsert: { firstSeen: new Date() } },
    { new: true, upsert: true }
  );
  res.json(customer.toJSON());
}));

// ================= REVIEWS =================
app.get('/api/reviews', wrap(async (req, res) => {
  const list = await Review.find().sort({ date: -1 });
  res.json(list.map(r => r.toJSON()));
}));

app.post('/api/reviews', writeLimiter, wrap(async (req, res) => {
  const review = await Review.create(req.body);
  res.json(review.toJSON());
}));

// ================= ACTIVITY LOG =================
app.get('/api/activity-log', wrap(async (req, res) => {
  const list = await ActivityLog.find().sort({ date: -1 }).limit(200);
  res.json(list.map(l => l.toJSON()));
}));

app.post('/api/activity-log', writeLimiter, wrap(async (req, res) => {
  const log = await ActivityLog.create(req.body);
  res.json(log.toJSON());
}));

// ================= CONTACT (سجل واحد فقط) =================
app.get('/api/contact', wrap(async (req, res) => {
  let contact = await Contact.findOne();
  if (!contact) contact = await Contact.create({});
  res.json(contact.toJSON());
}));

app.put('/api/contact', writeLimiter, wrap(async (req, res) => {
  let contact = await Contact.findOne();
  if (!contact) contact = await Contact.create(req.body);
  else { Object.assign(contact, req.body); await contact.save(); }
  res.json(contact.toJSON());
}));

// ================= SETTINGS (سجل واحد فقط) =================
app.get('/api/settings', wrap(async (req, res) => {
  let settings = await Settings.findOne();
  if (!settings) settings = await Settings.create({});
  res.json(settings.toJSON());
}));

app.put('/api/settings', writeLimiter, wrap(async (req, res) => {
  let settings = await Settings.findOne();
  if (!settings) settings = await Settings.create(req.body);
  else { Object.assign(settings, req.body); await settings.save(); }
  res.json(settings.toJSON());
}));

// ================= Health check =================
app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.post('/api/admin/backup-now', wrap(async (req, res) => {
  if (!process.env.ADMIN_BACKUP_SECRET || req.headers['x-backup-secret'] !== process.env.ADMIN_BACKUP_SECRET) {
    return res.status(403).json({ error: 'غير مصرح' });
  }
  await runBackupJob();
  res.json({ ok: true, message: 'تم تشغيل النسخة الاحتياطية، تحقق من الإيميل بعد شوية' });
}));

module.exports = app;
module.exports.runBackupJob = runBackupJob;
}));
