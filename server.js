import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { sendWelcomeEmail, notifyOwner, emailStatus } from './lib/email.js';
import { checkoutConfigStatus } from './lib/stripe-checkout.js';
import { createBillingRouter } from './lib/billing-routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 4001;
const SITE_URL = process.env.SITE_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
const DATA_DIR = path.join(__dirname, 'data');
const LEADS_FILE = path.join(DATA_DIR, 'leads.json');
const billingRouter = createBillingRouter();

fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(LEADS_FILE)) fs.writeFileSync(LEADS_FILE, '[]');

app.use(cors());
app.use('/webhooks/stripe', express.raw({ type: 'application/json' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(billingRouter);
app.use(express.static(path.join(__dirname, 'public')));

app.use('/stems', express.static(path.join(__dirname, 'public', 'stems'), {
  acceptRanges: true,
  cacheControl: true,
  maxAge: '1d',
}));

function readLeads() {
  try {
    return JSON.parse(fs.readFileSync(LEADS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function writeLeads(leads) {
  fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2));
}

function saveLead(entry) {
  const leads = readLeads();
  const duplicate = leads.some(l => l.email?.toLowerCase() === entry.email.toLowerCase());
  if (!duplicate) {
    leads.push(entry);
    writeLeads(leads);
  }
  return { saved: !duplicate, total: leads.length };
}

app.post('/api/leads', async (req, res) => {
  const { email, name, source = 'liminal_page' } = req.body;
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Valid email required' });

  const entry = { email, name: name || null, source, time: Date.now() };
  const { saved, total } = saveLead(entry);

  const [welcome, owner] = await Promise.all([
    sendWelcomeEmail(email),
    notifyOwner(entry),
  ]);

  if (welcome.sent) {
    entry.emailSent = true;
    entry.emailId = welcome.id;
    const leads = readLeads();
    const idx = leads.findIndex(l => l.email?.toLowerCase() === email.toLowerCase());
    if (idx >= 0) {
      leads[idx] = { ...leads[idx], emailSent: true, emailId: welcome.id };
      writeLeads(leads);
    }
  }

  res.json({
    success: true,
    saved,
    total,
    emailSent: welcome.sent,
    emailError: welcome.sent ? null : welcome.reason,
    message: welcome.sent ? 'Welcome email sent!' : 'Lead saved.',
  });
});

app.post('/api/sales', (req, res) => {
  const { email, product, amount } = req.body;
  if (email?.includes('@')) {
    saveLead({ email, name: null, source: `sale_${product || 'unknown'}`, time: Date.now(), amount });
  }
  res.json({ success: true });
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    product: 'Liminal StemSplit',
    version: '2.0',
    siteUrl: SITE_URL,
    stems: ['drums', 'bass', 'other', 'vocals'],
    leads: readLeads().length,
    email: emailStatus(),
    checkout: checkoutConfigStatus(),
    billing: 'mounted',
  });
});

const mail = emailStatus();
app.listen(PORT, '0.0.0.0', () => {
  const checkout = checkoutConfigStatus();
  console.log(`
╔═══════════════════════════════════════════╗
║       LIMINAL STEMSPLIT v2.0             ║
║                                           ║
║  Site:    ${SITE_URL}
║  Billing: ${SITE_URL}/webhooks/stripe
║  API:     ${SITE_URL}/api
║                                           ║
║  Demo song: bz_onit (4 stems)            ║
║  Email:   ${mail.configured ? 'Resend ✓' : 'NOT CONFIGURED'}
║  Checkout: ${checkout.ready ? 'Stripe ✓' : 'NOT CONFIGURED'}
╚═══════════════════════════════════════════╝
  `);
});