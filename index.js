require('dotenv').config();
const express = require('express');
const axios = require('axios');
const OpenAI = require('openai');

const app = express();
app.use(express.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const { SYSTEM_PROMPT } = require('./knowledge');

// Store conversation history per user (in memory)
const conversations = {};

// ─────────────────────────────────────────────
// HEALTH CHECK — keeps Render free tier awake
// ─────────────────────────────────────────────
app.get('/', (req, res) => res.send('Bot is alive ✅'));

// ─────────────────────────────────────────────
// WEBHOOK VERIFICATION (Meta — one-time setup)
// ─────────────────────────────────────────────
app.get('/webhook', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// ─────────────────────────────────────────────
// RECEIVE MESSAGES
// ─────────────────────────────────────────────
app.post('/webhook', async (req, res) => {
  res.sendStatus(200); // Always reply fast so Meta doesn't retry

  const entry   = req.body?.entry?.[0];
  const changes = entry?.changes?.[0];
  const value   = changes?.value;

  // ── Handle interactive button/list replies ──
  if (value?.messages?.[0]?.type === 'interactive') {
    const msg         = value.messages[0];
    const from        = msg.from;
    const interactive = msg.interactive;

    // Button reply (3-option buttons)
    if (interactive.type === 'button_reply') {
      const buttonId = interactive.button_reply.id;
      await handleButtonReply(from, buttonId);
      return;
    }

    // List reply (service menu selection)
    if (interactive.type === 'list_reply') {
      const listId = interactive.list_reply.id;
      await handleListReply(from, listId);
      return;
    }
  }

  // ── Handle plain text messages ──
  const message = value?.messages?.[0];
  if (!message || message.type !== 'text') return;

  const from     = message.from;
  const userText = message.text.body.trim();

  // Welcome message on first contact
  if (!conversations[from] || conversations[from].length === 0) {
    await sendWelcome(from);
  }

  // Initialise conversation history
  if (!conversations[from]) conversations[from] = [];
  conversations[from].push({ role: 'user', content: userText });

  // Keep last 10 messages to save tokens
  if (conversations[from].length > 10) {
    conversations[from] = conversations[from].slice(-10);
  }

  // Send to OpenAI
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...conversations[from]
      ],
      max_tokens: 300,
    });

    const reply = completion.choices[0].message.content;
    conversations[from].push({ role: 'assistant', content: reply });

    await sendWhatsAppMessage(from, reply);

    // After AI reply, show the service menu again so user can explore more
    await sendServiceMenu(from);

  } catch (err) {
    console.error(err);
    await sendWhatsAppMessage(from,
      "Sorry, I'm having a moment! Please contact us directly.\n📞 +44 7944 139954\n📧 info@e-mediabiz.com"
    );
  }
});

// ─────────────────────────────────────────────
// WELCOME MESSAGE
// ─────────────────────────────────────────────
async function sendWelcome(to) {
  await sendWhatsAppMessage(to,
    `👋 Hi! Welcome to *e-Mediabiz Digital Agency*.\n\nI'm your AI assistant — here to help you find the right solution for your business! 😊`
  );
  // Short pause so messages arrive in order
  await new Promise(r => setTimeout(r, 800));
  await sendServiceMenu(to);
}

// ─────────────────────────────────────────────
// SERVICE MENU (WhatsApp List — up to 10 items)
// ─────────────────────────────────────────────
async function sendServiceMenu(to) {
  await axios.post(
    `https://graph.facebook.com/v19.0/${process.env.PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: 'whatsapp',
      to,
      type: 'interactive',
      interactive: {
        type: 'list',
        header: { type: 'text', text: '🚀 Our Services' },
        body:   { text: 'Select a service to learn more, or just type your question below.' },
        footer: { text: 'e-mediabiz.com' },
        action: {
          button: 'View Services',
          sections: [
            {
              title: 'What we do',
              rows: [
                { id: 'svc_web',     title: '🌐 Web Development',   description: 'Websites, apps & digital solutions' },
                { id: 'svc_social',  title: '📱 Social Media',       description: 'AI-powered management & strategy' },
                { id: 'svc_cloud',   title: '☁️ Cloud & IT Support', description: 'Infrastructure, security & migration' },
                { id: 'svc_design',  title: '🎨 Creative Design',    description: 'Branding, UI/UX & visuals' },
                { id: 'svc_price',   title: '💰 Pricing',            description: 'Our packages & rates' },
                { id: 'svc_contact', title: '📞 Contact Our Team',   description: 'Speak to a human directly' },
              ]
            }
          ]
        }
      }
    },
    {
      headers: {
        Authorization:  `Bearer ${process.env.WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json'
      }
    }
  );
}

// ─────────────────────────────────────────────
// HANDLE LIST SELECTION
// ─────────────────────────────────────────────
async function handleListReply(from, id) {
  switch (id) {

    case 'svc_web':
      await sendWhatsAppMessage(from,
        `🌐 *Web Development*\n\nWe build modern, scalable digital solutions:\n\n• Custom websites & landing pages\n• Mobile-responsive design\n• E-commerce stores\n• Web applications\n• Website redesigns\n\nAll built with cutting-edge technology and user-centred design. 💻`
      );
      await sendContactButtons(from, 'web development');
      break;

    case 'svc_social':
      await sendWhatsAppMessage(from,
        `📱 *Social Media Management (AI-Powered)*\n\nWe help your brand stay relevant and grow:\n\n• Content creation & scheduling\n• AI trend tracking & analysis\n• Engagement strategy\n• Management across all platforms\n\n💰 *Package:* $50/month — 3 selected platforms`
      );
      await sendContactButtons(from, 'social media');
      break;

    case 'svc_cloud':
      await sendWhatsAppMessage(from,
        `☁️ *Cloud & IT Infrastructure*\n\nEnterprise-grade solutions for your business:\n\n• Cloud migration & setup\n• IT infrastructure management\n• AI-powered security monitoring\n• Performance & scalability\n• 24/7 intelligent monitoring\n\nWe handle the tech so you can focus on growth. 🔒`
      );
      await sendContactButtons(from, 'cloud infrastructure');
      break;

    case 'svc_design':
      await sendWhatsAppMessage(from,
        `🎨 *Creative Design (Human + AI)*\n\nImpactful visuals crafted for your brand:\n\n• Logo & brand identity\n• UI/UX design\n• Social media graphics\n• Print materials\n• AI-assisted creative tools for speed & efficiency`
      );
      await sendContactButtons(from, 'creative design');
      break;

    case 'svc_price':
      await sendWhatsAppMessage(from,
        `💰 *Our Pricing*\n\n*Project-Based Work:*\nCustom digital solutions starting from *$100+* per project. Pricing is tailored after understanding your specific needs.\n\n*Social Media Management:*\n*$50/month* — Content creation & management on 3 platforms\n\n_All other services are quoted based on scope. Contact us for a free consultation!_`
      );
      await sendContactButtons(from, 'pricing');
      break;

    case 'svc_contact':
      await sendWhatsAppMessage(from,
        `📞 *Get in Touch*\n\nOur team is happy to help!\n\n📱 WhatsApp / Call: *+44 7944 139954*\n📧 Email: *info@e-mediabiz.com*\n🌐 Website: *e-mediabiz.com*\n\nWe typically respond within a few hours. 🙌`
      );
      break;

    default:
      await sendServiceMenu(from);
  }

  // Show menu again after every selection (except contact)
  if (id !== 'svc_contact') {
    await new Promise(r => setTimeout(r, 600));
    await sendServiceMenu(from);
  }
}

// ─────────────────────────────────────────────
// CONTACT BUTTONS (after each service detail)
// ─────────────────────────────────────────────
async function sendContactButtons(to, service) {
  await axios.post(
    `https://graph.facebook.com/v19.0/${process.env.PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: 'whatsapp',
      to,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: `Interested in our ${service} services? What would you like to do next?` },
        action: {
          buttons: [
            { type: 'reply', reply: { id: 'btn_question', title: '💬 Ask a Question' } },
            { type: 'reply', reply: { id: 'btn_quote',    title: '📋 Get a Quote'    } },
            { type: 'reply', reply: { id: 'btn_contact',  title: '📞 Contact Team'   } },
          ]
        }
      }
    },
    {
      headers: {
        Authorization:  `Bearer ${process.env.WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json'
      }
    }
  );
}

// ─────────────────────────────────────────────
// HANDLE BUTTON REPLIES
// ─────────────────────────────────────────────
async function handleButtonReply(from, id) {
  switch (id) {
    case 'btn_question':
      await sendWhatsAppMessage(from,
        `Sure! Go ahead and type your question — I'll do my best to help. 😊`
      );
      break;

    case 'btn_quote':
      await sendWhatsAppMessage(from,
        `Great! To prepare a quote, our team will need a few details.\n\n📧 Email us at *info@e-mediabiz.com* with:\n• What service you need\n• A brief description of your project\n• Your timeline & budget (if known)\n\nOr call us directly: 📞 *+44 7944 139954*`
      );
      break;

    case 'btn_contact':
      await sendWhatsAppMessage(from,
        `📞 *Reach Our Team Directly*\n\n📱 WhatsApp / Call: *+44 7944 139954*\n📧 Email: *info@e-mediabiz.com*\n🌐 Website: *e-mediabiz.com*`
      );
      break;

    default:
      await sendServiceMenu(from);
  }
}

// ─────────────────────────────────────────────
// SEND PLAIN TEXT MESSAGE
// ─────────────────────────────────────────────
async function sendWhatsAppMessage(to, text) {
  await axios.post(
    `https://graph.facebook.com/v19.0/${process.env.PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: text }
    },
    {
      headers: {
        Authorization:  `Bearer ${process.env.WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json'
      }
    }
  );
}

// ─────────────────────────────────────────────
// KEEP-ALIVE PING — prevents Render free tier sleeping
// ─────────────────────────────────────────────
const RENDER_URL = process.env.RENDER_URL;
if (RENDER_URL) {
  setInterval(async () => {
    try {
      await axios.get(RENDER_URL);
      console.log('✅ Keep-alive ping sent');
    } catch (e) {
      console.log('⚠️ Keep-alive ping failed:', e.message);
    }
  }, 10 * 60 * 1000); // every 10 minutes
}

// ─────────────────────────────────────────────
// START SERVER
// ─────────────────────────────────────────────
app.listen(3000, () => console.log('✅ e-Mediabiz WhatsApp Bot running on port 3000'));