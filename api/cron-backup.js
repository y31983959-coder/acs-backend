// الـ endpoint ده Vercel Cron بيناديه تلقائيًا حسب الجدول في vercel.json (مرة يوميًا)
// محمي بمتغير CRON_SECRET اللي Vercel بيبعته تلقائيًا في هيدر Authorization لو ظبطته في إعدادات المشروع
const appModule = require('./index');

module.exports = async (req, res) => {
  const auth = req.headers['authorization'];
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'غير مصرح' });
  }
  await appModule.runBackupJob();
  res.status(200).json({ ok: true, ranAt: new Date().toISOString() });
};
