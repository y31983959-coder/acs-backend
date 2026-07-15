# ACS Store - Backend

باك إند بسيط لموقع ACS (المتجر + لوحة تحكم الأدمن) مبني بـ Node.js + Express + MongoDB.

## إجراءات الحماية المضافة (مهمة قبل النشر لعملاء حقيقيين)
- **خصم مخزون آمن (atomic):** لو عميلين طلبوا آخر قطعة في نفس اللحظة بالظبط، واحد بس هيعدي والتاني هياخد رسالة "الكمية غير متوفرة" بدل ما يتباع نفس المنتج مرتين.
- **فحص الحد الأقصى لكل عميل من على السيرفر:** مش بس من متصفح العميل، فمينفعش حد يتحايل عليه بمسح بيانات متصفحه.
- **رقم طلب فريد** بيتولّد من السيرفر نفسه، مش من متصفح العميل.
- **Rate limiting:** حماية من إغراق السيرفر بطلبات وهمية كتير في وقت قصير من نفس المصدر.
- **تحقق أساسي من البيانات** (اسم، سعر، تليفون، إلخ) قبل الحفظ في القاعدة.

## إشعارات SMS للعميل عند تغيير حالة الطلب (اختياري)
1. اعمل حساب على https://www.twilio.com (فيه رصيد تجريبي مجاني بسيط).
2. من لوحة تحكم Twilio هتلاقي **Account SID** و **Auth Token** — انسخهم في `TWILIO_ACCOUNT_SID` و `TWILIO_AUTH_TOKEN`.
3. اشتري رقم تليفون من Twilio يقدر يبعت SMS دولي، وحطه في `TWILIO_SMS_FROM` (بالصيغة اللي Twilio بتديهولك، مثال: `+12025551234`).
4. لو المتغيرات دي فاضية، الميزة بتتجاهل نفسها تلقائيًا من غير ما تعطل أي حاجة تانية.

⚠️ **ملحوظة:** الرصيد التجريبي في Twilio بيكفي رسائل قليلة بس للتجربة. لاستخدام حقيقي مع عملاء كتير، محتاج تشحن رصيد فعلي (تكلفة صغيرة لكل رسالة SMS).

## نسخة احتياطية تلقائية يومية بالإيميل (اختياري)
1. لو عندك إيميل Gmail، روح على إعدادات الأمان بتاعت حسابك واعمل **App Password** (مش الباسورد العادي بتاعك).
2. حط إيميلك في `BACKUP_EMAIL_USER` والـ App Password في `BACKUP_EMAIL_PASS`.
3. حط الإيميل اللي عايز تستقبل النسخة الاحتياطية عليه في `BACKUP_EMAIL_TO` (ممكن يكون نفس الإيميل).
4. غيّر `ADMIN_BACKUP_SECRET` لكلمة سر من عندك (مش الافتراضية).
5. السيرفر هيبعتلك إيميل فيه نسخة كاملة من قاعدة البيانات (JSON) كل يوم الساعة 3 صباحًا تلقائيًا.
6. تقدر تجرب الميزة يدويًا في أي وقت من غير ما تستنى الموعد، بإرسال طلب POST لـ:
   ```
   https://your-backend-url.onrender.com/api/admin/backup-now
   ```
   مع هيدر: `x-backup-secret: القيمة-اللي-حطيتها-في-ADMIN_BACKUP_SECRET`
   (تقدر تجرب ده من Postman أو أي أداة زيها)

## الخطوات كاملة من الصفر

### 1) إنشاء قاعدة بيانات مجانية على MongoDB Atlas
1. روح على https://www.mongodb.com/cloud/atlas/register واعمل حساب مجاني.
2. اعمل Cluster جديد (اختار الخطة المجانية M0).
3. من "Database Access" اعمل مستخدم جديد (username + password) — احفظهم كويس.
4. من "Network Access" اضغط "Add IP Address" واختار "Allow Access from Anywhere" (0.0.0.0/0) — عشان Render يقدر يوصل لقاعدة البيانات.
5. من صفحة الـ Cluster اضغط "Connect" > "Drivers" وانسخ الـ connection string، هيكون شكله كده:
   ```
   mongodb+srv://USERNAME:PASSWORD@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```
6. ضيف اسم قاعدة البيانات في آخر اللينك قبل الـ `?` كده:
   ```
   mongodb+srv://USERNAME:PASSWORD@cluster0.xxxxx.mongodb.net/acs_store?retryWrites=true&w=majority
   ```

### 2) رفع الكود على GitHub
1. اعمل مستودع (repository) جديد على GitHub وارفعله محتويات مجلد `backend` ده.

### 3) نشر السيرفر على Render (مجاني)
1. اعمل حساب على https://render.com وربطه بحساب الـ GitHub بتاعك.
2. اضغط "New +" > "Web Service" واختار المستودع اللي رفعته.
3. الإعدادات:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
4. من قسم "Environment Variables" ضيف:
   - `MONGODB_URI` = اللينك اللي نسخته من Atlas في الخطوة 1
   - `ALLOWED_ORIGINS` = `*` (أو حط روابط موقع المتجر ولوحة الأدمن بعد ما ترفعهم، مفصولين بفاصلة، عشان أمان أعلى)
5. اضغط "Create Web Service" واستنى لحد ما ينشر (Deploy). هتاخد رابط شكله:
   ```
   https://acs-store-backend.onrender.com
   ```

⚠️ **ملحوظة عن الخطة المجانية في Render:** السيرفر بينام تلقائيًا لو مافيش زيارات لمدة معينة، وبياخد شوية ثواني يصحى تاني أول ما حد يفتح الموقع بعد فترة سكون. ده طبيعي في الخطة المجانية، ولو حبيت تتجنبه تقدر تترقّى لخطة مدفوعة بسيطة لاحقًا.

### 4) تحديث ملفات الموقع (store.html و admin.html)
في الملفين، دور على السطر ده:
```javascript
const API_BASE_URL = 'http://localhost:5000/api';
```
وغيّره لرابط Render بتاعك + `/api`:
```javascript
const API_BASE_URL = 'https://acs-store-backend.onrender.com/api';
```

### 5) نشر ملفات الموقع نفسها (store.html و admin.html)
أسهل طريقة: استخدم Netlify (مجاني):
1. روح https://app.netlify.com/drop
2. اسحب وحط ملف `store.html` هناك → هتاخد رابط للمتجر.
3. كرر نفس الخطوة مع `admin.html` (في نشر منفصل) → هتاخد رابط للوحة الأدمن.

بعد كده الاتنين (المتجر ولوحة الأدمن) هيكلموا نفس السيرفر ونفس قاعدة البيانات، فأي طلب من أي عميل في أي محافظة هيوصل فورًا للأدمن.

## اختبار سريع إن السيرفر شغال
افتح في المتصفح: `https://your-backend-url.onrender.com/api/health`
المفروض يرجعلك: `{"ok":true,"time":"..."}`

## تشغيل محلي (لو حابب تجرب على جهازك الأول)
```bash
npm install
cp .env.example .env
# عدّل .env وحط الـ MONGODB_URI بتاعك
npm start
```

## تخزين صور المنتجات على Cloudinary (اختياري، بدل base64)
1. اعمل حساب مجاني على https://cloudinary.com
2. من الـ Dashboard انسخ **Cloud Name**.
3. روح Settings > Upload > Upload presets > Add upload preset.
   - غيّر **Signing Mode** لـ **Unsigned**.
   - احفظ، وانسخ اسم الـ preset.
4. افتح ملف `admin.html` (بعد ما تنشره) ودور على السطرين دول (قريب من أول السكريبت):
   ```javascript
   const CLOUDINARY_CLOUD_NAME = '';
   const CLOUDINARY_UPLOAD_PRESET = '';
   ```
   واملأهم بالقيم اللي نسختها.
5. لو سبتهم فاضيين، لوحة الأدمن هترجع تلقائيًا لطريقة الرفع القديمة (تخزين الصورة كنص base64 في قاعدة البيانات نفسها) — شغالة برضو بس مش الأفضل لصور كتير.
