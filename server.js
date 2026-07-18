/**
 * 超越巔峰｜Resend 預約/訂單郵件後端
 * ---------------------------------------------------
 * 一支訂單觸發三封信：
 *   1) 客人收到「訂單確認信」
 *   2) 華靖老師收到「新訂單通知信」
 *   3) 客人收到「歡迎信」
 *
 * 啟動：npm install → 設定 .env → npm start
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());                 // 允許前台網頁跨來源呼叫
app.use(express.json());

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL  = process.env.FROM_EMAIL  || '超越巔峰 <onboarding@resend.dev>';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'gina66688@gmail.com';
const BRAND = '超越巔峰・AI流量變現實戰營';

/* ---------- 前台設定（存 Firestore，優雅降級到記憶體） ---------- */
const CONFIG_PW = process.env.CONFIG_PW || 'admin168';
const DEFAULT_CONFIG = {
  video: 'https://youtu.be/4FOP2aYJBII',
  dailyTimes: ['14:00', '20:00'],
  instantMin: 30,
  urgencyMin: 60,
  enrollN: 88,
  enrollG: 100,
};
let memConfig = null;   // 若沒接 Firebase，先用記憶體（重啟會清空）
let db = null;
try {
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (sa) {
    const admin = require('firebase-admin');
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(sa)) });
    db = admin.firestore();
    console.log('✅ Firestore 已連線（設定將永久保存）');
  } else {
    console.log('ℹ️ 未設定 FIREBASE_SERVICE_ACCOUNT，設定暫存於記憶體');
  }
} catch (e) {
  console.error('Firebase 初始化略過：', e.message);
}

async function getConfig() {
  if (db) {
    try {
      const doc = await db.collection('site').doc('config').get();
      if (doc.exists) return Object.assign({}, DEFAULT_CONFIG, doc.data());
    } catch (e) { console.error('讀取設定失敗：', e.message); }
  }
  return memConfig || DEFAULT_CONFIG;
}
async function setConfig(cfg) {
  const clean = {
    video: String(cfg.video || ''),
    dailyTimes: Array.isArray(cfg.dailyTimes) ? cfg.dailyTimes.map(String) : [],
    instantMin: Number(cfg.instantMin) || 0,
    urgencyMin: Number(cfg.urgencyMin) || 0,
    enrollN: Number(cfg.enrollN) || 0,
    enrollG: Number(cfg.enrollG) || 100,
  };
  memConfig = Object.assign({}, DEFAULT_CONFIG, clean);
  if (db) {
    try { await db.collection('site').doc('config').set(clean, { merge: true }); }
    catch (e) { console.error('寫入設定失敗：', e.message); }
  }
  return memConfig;
}

/* ---------- 寄信底層（呼叫 Resend REST API） ---------- */
async function sendEmail({ to, subject, html }) {
  if (!RESEND_API_KEY) throw new Error('尚未設定 RESEND_API_KEY，請檢查 .env');
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
    }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error('Resend 錯誤：' + JSON.stringify(data));
  return data;
}

/* ---------- 郵件外框 ---------- */
function shell(inner) {
  return `<div style="max-width:560px;margin:0 auto;font-family:'PingFang TC','Microsoft JhengHei',sans-serif;color:#1c1440;background:#ffffff;border:1px solid #e7e1fb;border-radius:16px;overflow:hidden">
    <div style="background:linear-gradient(90deg,#7c3aed,#9333ea);padding:20px 24px;color:#fff">
      <div style="font-size:18px;font-weight:800">🏔️ ${BRAND}</div>
    </div>
    <div style="padding:24px">${inner}</div>
    <div style="padding:16px 24px;background:#f6f3ff;color:#6b6390;font-size:12px">
      本信由系統自動發送。若有疑問，歡迎回覆或加入官方 LINE 與我們聯繫。
    </div>
  </div>`;
}
const btn = (t, href = '#') =>
  `<a href="${href}" style="display:inline-block;background:linear-gradient(90deg,#7c3aed,#9333ea);color:#fff;text-decoration:none;font-weight:800;padding:12px 22px;border-radius:10px">${t}</a>`;
const esc = s => String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

/* ---------- 三封信範本 ---------- */
function tplConfirm(o) {  // 給客人：訂單確認
  return shell(`
    <h2 style="margin:0 0 12px">✅ 訂單已確認，${esc(o.name) || '同學'} 你好！</h2>
    <p style="color:#6b6390">感謝你報名 <b style="color:#7c3aed">${esc(o.plan) || 'AI流量變現實戰營'}</b>，我們已收到你的訂單。</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin:14px 0">
      <tr><td style="padding:8px 0;color:#6b6390">方案</td><td style="text-align:right;font-weight:700">${esc(o.plan) || 'AI流量變現實戰營・完整課程'}</td></tr>
      <tr><td style="padding:8px 0;color:#6b6390">金額</td><td style="text-align:right;font-weight:700">${o.amount ? ('NT$' + Number(o.amount).toLocaleString()) : '—'}</td></tr>
      ${o.code ? `<tr><td style="padding:8px 0;color:#6b6390">優惠碼</td><td style="text-align:right;font-weight:700">${esc(o.code)}</td></tr>` : ''}
    </table>
    <p style="color:#6b6390">專人將盡快與你聯繫，協助完成後續付款與開課流程。</p>
  `);
}
function tplAdmin(o) {   // 給老師：新訂單通知
  return shell(`
    <h2 style="margin:0 0 12px">🔔 有新訂單！</h2>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <tr><td style="padding:8px 0;color:#6b6390">姓名</td><td style="text-align:right;font-weight:700">${esc(o.name)}</td></tr>
      <tr><td style="padding:8px 0;color:#6b6390">Email</td><td style="text-align:right;font-weight:700">${esc(o.email)}</td></tr>
      <tr><td style="padding:8px 0;color:#6b6390">手機/LINE</td><td style="text-align:right;font-weight:700">${esc(o.phone)}</td></tr>
      <tr><td style="padding:8px 0;color:#6b6390">方案</td><td style="text-align:right;font-weight:700">${esc(o.plan) || 'AI流量變現實戰營'}</td></tr>
      ${o.code ? `<tr><td style="padding:8px 0;color:#6b6390">優惠碼</td><td style="text-align:right;font-weight:700">${esc(o.code)}</td></tr>` : ''}
      <tr><td style="padding:8px 0;color:#6b6390">時間</td><td style="text-align:right">${new Date().toLocaleString('zh-TW')}</td></tr>
    </table>
  `);
}
function tplWelcome(o) { // 給客人：歡迎信
  return shell(`
    <h2 style="margin:0 0 12px">🎉 歡迎加入，${esc(o.name) || '同學'}！</h2>
    <p style="color:#6b6390">你正式踏出「用 AI 打造第一個自動賺錢系統」的第一步，我們非常期待陪你把知識變成成果。</p>
    <p style="margin:14px 0 6px;font-weight:800">接下來你可以：</p>
    <ul style="color:#6b6390;font-size:14px;line-height:1.9">
      <li>加入專屬學員社群，與同學一起學習</li>
      <li>領取報名贈品：AI 爆款腳本模板大全、AI 流量變現寶典等</li>
      <li>準備好一支手機或電腦，開始你的第一支短影音</li>
    </ul>
    <p style="margin-top:18px">${btn('加入學員社群')}</p>
    <p style="color:#6b6390;margin-top:16px">利他，才能利己；成就別人，就是成就自己。 —— 華靖老師</p>
  `);
}

/* ---------- API：一支訂單 → 三封信 ---------- */
app.post('/api/order', async (req, res) => {
  const o = req.body || {};
  if (!o.email) return res.status(400).json({ error: '缺少客人 email' });
  const results = { confirm: null, admin: null, welcome: null };
  try {
    results.confirm = await sendEmail({ to: o.email,    subject: `【${BRAND}】訂單確認`,                          html: tplConfirm(o) });
    results.admin   = await sendEmail({ to: ADMIN_EMAIL, subject: `【新訂單】${o.name || ''} 報名 AI流量變現實戰營`, html: tplAdmin(o) });
    results.welcome = await sendEmail({ to: o.email,    subject: `🎉 歡迎加入 ${BRAND}！`,                        html: tplWelcome(o) });
    res.json({ ok: true, results });
  } catch (e) {
    console.error('寄信失敗：', e.message);
    res.status(500).json({ error: String(e.message || e), results });
  }
});

/* ---------- 設定 API ---------- */
app.get('/config', async (_req, res) => {
  res.json(await getConfig());
});
app.post('/config', async (req, res) => {
  const { pw, config } = req.body || {};
  if (pw !== CONFIG_PW) return res.status(401).json({ error: '密碼錯誤' });
  if (!config || typeof config !== 'object') return res.status(400).json({ error: '缺少 config' });
  const saved = await setConfig(config);
  res.json({ ok: true, config: saved });
});

app.get('/', (_req, res) => res.send('✅ 超越巔峰 Resend 郵件後端運作中。POST /api/order 觸發三封信。'));

const PORT = process.env.PORT || 8787;
app.listen(PORT, () => console.log(`✅ 郵件後端已啟動：http://localhost:${PORT}`));
