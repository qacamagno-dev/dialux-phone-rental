require('dotenv').config();
const { sendMail, mailDiagnostics } = require('../src/services/mailer');

const to = String(process.argv[2] || '').trim();
if (!to) {
  console.error('Usage: npm run mail:test -- you@example.com');
  process.exit(2);
}

(async () => {
  const info = mailDiagnostics();
  console.log(`Transport: ${info.transport}`);
  console.log(`Sender:    ${info.sender}`);

  const result = await sendMail({
    to,
    subject: 'DiaLux email test',
    text: 'If you received this, DiaLux transactional email is working.',
    html: '<p>If you received this, <strong>DiaLux transactional email is working.</strong></p>',
  });

  if (!result.delivered) {
    console.error(`Email was not accepted: ${result.error || result.transport}`);
    process.exit(1);
  }

  console.log(`Accepted by Brevo${result.id ? `: ${result.id}` : '.'}`);
})().catch(err => {
  console.error(err.message);
  process.exit(1);
});
