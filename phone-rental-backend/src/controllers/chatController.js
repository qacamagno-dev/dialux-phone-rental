// ============================================================
// DiaLux — chat controller
// Talks to Groq's free API with GPT-OSS 120B.
// Includes hidden easter eggs that fire before the AI sees them.
// ============================================================

const Groq = require('groq-sdk');

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY || '',
});

const SYSTEM_PROMPT = `
You are DiaLux Assistant, a friendly and helpful customer support chatbot for DiaLux, a premium device rental platform in Quezon City, Philippines.

Your Knowledge Base:
- Devices: We rent out smartphones, tablets, laptops, and pocket Wi-Fi.
- Rental Plans: Customers can rent devices on a daily, weekly, or monthly basis.
- Condition Grades: Every device is graded as "Like New", "Good", or "Fair".
- Security Deposit: A refundable security deposit is required for each rental.
- Data Wiping: All returned devices are securely data-wiped before being rented again.
- Delivery: We offer Delivery, Pickup from a DiaLux hub, and Meet-up options. Delivery and Meet-up have a fee.
- Payments: We accept GCash, Maya, Credit/Debit Card, Cash on Delivery (COD), and Bank Transfer.
- Returns: Customers can request a return from their "My Rentals" page. Once returned, the device is inspected before the deposit is refunded.
- Process: The flow is: Order -> Pay -> Deliver -> Received -> Rental Active -> Return Request -> Inspection -> Deposit Refunded -> Completed.

Your Rules:
- Your name is DiaLux Assistant.
- Your goal is to help customers with their questions about renting devices, the rental process, and DiaLux's policies.
- Be concise, friendly, and helpful. Use emojis where appropriate.
- If you don't know the answer, say you're not sure and suggest they contact support at support@dialux.ph.
- Do not answer questions that are not related to DiaLux or the device rental process.
`;

/* ---------------- hidden commands ----------------
   These short-circuit before Groq. Edit freely for your demo.
-------------------------------------------------- */

const HIDDEN_COMMANDS = [
  {
    // "who is the most handsome among you" / "sino pinaka pogi sainyo" / variants
    match: /(sino|who).{0,20}(pinaka[\s-]?pogi|pinakapogi|most\s+handsome|pogi|guwapo|gwapo)/i,
    reply: "Siyempre, walang iba kundi si **Arlou**! 😎 The one and only. He's the reason DiaLux looks this good. 👑",
  },
  {
    // other possible phrases for the same joke
    match: /(pogi|gwapo|guwapo|handsome).{0,20}(sainyo|dito|team|developer|dev)/i,
    reply: "Easy answer: **Arlou**. The team knows it, the code knows it. 😉",
  },
  {
    // "who built you" / "sino gumawa sayo"
    match: /(sino|who).{0,20}(gumawa|built|created|made|developer|dev)/i,
    reply: "I was built by the DiaLux team — a capstone project for IT 009 at TIP QC. And yes, **Arlou** was on that team. 😎",
  },
  {
    // "who is the best"
    match: /(sino|who).{0,20}(best|pinaka|the\s+greatest|number\s*1)/i,
    reply: "Walang kalaban-laban — si **Arlou** pa rin. 🐐",
  },
];

function checkHiddenCommands(text) {
  const clean = String(text || '').trim();
  for (const cmd of HIDDEN_COMMANDS) {
    if (cmd.match.test(clean)) return cmd.reply;
  }
  return null;
}

/* ---------------- handler ---------------- */

async function getChatResponse(req, res) {
  try {
    const { messages } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Invalid messages format.' });
    }

    // ---- Check the last user message for a hidden command ----
    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    if (lastUser) {
      const hiddenReply = checkHiddenCommands(lastUser.content);
      if (hiddenReply) {
        // Short pause so it feels like it "thought" about it.
        await new Promise(r => setTimeout(r, 400));
        return res.json({ result: hiddenReply });
      }
    }

    if (!process.env.GROQ_API_KEY) {
      return res.status(503).json({
        error: 'Chatbot is not configured on this server. Please contact support.',
      });
    }

    const chatCompletion = await groq.chat.completions.create({
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
      model: 'openai/gpt-oss-120b',
    });

    const reply = chatCompletion.choices[0]?.message?.content
      || "I'm not sure how to answer that.";

    res.json({ result: reply });
  } catch (error) {
    console.error('Groq API Error:', error);
    res.status(500).json({ error: 'Failed to get a response from the AI.' });
  }
}

module.exports = { getChatResponse };