// ============================================================
// DiaLux — default CMS content
//
// The six static pages ship with their copy in the HTML shells. This module
// mirrors that copy so the admin editor opens pre-filled with the real text
// instead of a blank form, and so GET /api/pages/:slug can answer before an
// administrator has ever saved anything.
//
// A page is only overridden in the browser once a Page document exists — see
// routes/pages.js (`isDefault`) and js/pages/static.js. That means editing
// this file changes what the editor starts from, never what a live visitor
// sees on an already-customised page.
// ============================================================

const PAGE_DEFAULTS = {
  about: {
    title: 'About DiaLux',
    intro: 'Technology when you need it, without the burden of ownership.',
    sections: [
      {
        heading: 'Our Mission',
        body: 'DiaLux exists to make premium technology accessible to everyone — not just those who can afford to buy. We believe in access over ownership, giving students, professionals and travellers the freedom to use the latest devices without the long-term commitment.',
      },
      {
        heading: 'Why DiaLux?',
        body: 'We combine trust, transparency and flexibility with a premium experience. Every device is graded (Like New / Good / Fair), thoroughly tested, and data-wiped before it reaches you. Our rental plans adapt to your schedule — daily, weekly or monthly.',
      },
      {
        heading: 'Built by students, for the community',
        body: 'DiaLux is a capstone project for IT 009 — Systems Integration and Architecture at the Technological Institute of the Philippines, Quezon City.',
      },
      {
        heading: 'Our Values',
        body: 'Trust — device grading, data wiping and transparent policies.\nSustainability — extending device life through reuse and responsible maintenance.\nAccessibility — making premium tech affordable and flexible.\nSupport — responsive help whenever a rental needs attention.',
      },
    ],
  },

  team: {
    title: 'The Developers',
    intro: 'The team behind DiaLux — built for IT 009 at TIP Quezon City.',
    sections: [
      {
        heading: 'Project team',
        body: 'Buenaflor, John Harold D. — Team Leader\nLacson, Ian Mathew A. — Member\nLico, Kirby Matthew A. — Member\nMagno, Arlou Clyde A. — Member\nSalinas, Xynex Vixen J. — Member\nVergara, Rowan Jared J. — Member',
      },
      {
        heading: 'About the build',
        body: 'DiaLux is a full-stack rental platform: an Express and MongoDB API behind a dependency-free ES-module frontend. Every feature on the site — catalog, cart, bookings, returns, reviews and the admin dashboard — was written for this course.',
      },
    ],
  },

  contact: {
    title: 'Get in Touch',
    intro: "Questions about a booking, device or return? We're here to help.",
    sections: [
      {
        heading: 'Customer Support',
        body: 'Email: support@dialux.ph\nPhone: +63 900 000 0000\nService area: Quezon City, Metro Manila',
      },
      {
        heading: 'Before contacting support',
        body: 'Have your booking reference ready.\nFor device issues, describe the problem and when it started.\nFor returns, check the current status on your My Rentals page first.',
      },
    ],
  },

  help: {
    title: 'Help Center',
    intro: 'Quick answers for common rental questions.',
    sections: [
      {
        heading: 'How do I rent a device?',
        body: 'Choose a device from the catalog, add it to your cart, sign in, pick your rental window, and complete checkout. You can also use "Order now" on any device to book it on its own without touching your cart.',
      },
      {
        heading: 'Can I extend a rental?',
        body: 'Yes. Active rentals carry an "Extend rental" action on your My Rentals page, which pushes the return date out by one more rental period.',
      },
      {
        heading: 'How do returns work?',
        body: 'Request a return from My Rentals. The device enters the technician queue for inspection and secure data wiping, and your deposit is refunded once it passes.',
      },
      {
        heading: 'What happens to my data?',
        body: 'Returned devices are factory-reset and the wipe is logged before the device becomes available again. Your personal data is never left on a device after return.',
      },
      {
        heading: 'What is the security deposit?',
        body: 'The deposit is shown separately at checkout and is fully refundable once the returned device passes inspection. It is held, not spent.',
      },
      {
        heading: 'What does damage protection cover?',
        body: 'Optional protection can be added at checkout for a small percentage of the rent. It reduces the risk of unexpected repair charges during your rental. See the Terms for details.',
      },
    ],
  },

  terms: {
    title: 'Terms & Conditions',
    intro: 'Please read these terms carefully before renting a device.',
    sections: [
      {
        heading: 'Rental Agreement',
        body: 'By renting a device from DiaLux, you agree to the terms below.',
      },
      {
        heading: '1. Rental Period',
        body: 'The rental period begins on the start date selected at checkout and ends on the return date. Extensions may be requested through your account, subject to availability.',
      },
      {
        heading: '2. Security Deposit',
        body: 'A refundable security deposit is collected at checkout. It is refunded in full after the device is returned, inspected and found to be in acceptable condition. Normal wear is exempt.',
      },
      {
        heading: '3. Device Condition & Grading',
        body: 'All devices are graded Like New, Good or Fair based on visible wear and battery health. The grade you rent is the grade you receive, and condition is documented before each rental.',
      },
      {
        heading: '4. Returns & Inspections',
        body: 'Return the device by the agreed date, with the accessories it shipped with. Every return is inspected and securely wiped before the deposit is released.',
      },
      {
        heading: '5. Damage & Loss',
        body: 'You are responsible for the device during the rental period. Optional damage protection can be added at checkout to reduce repair costs. Lost or unreturned devices are charged at full replacement cost.',
      },
      {
        heading: '6. Cancellation',
        body: 'Bookings can be cancelled before payment for a full release of the hold. Cancellations after the start date are subject to prorated charges.',
      },
      {
        heading: '7. Data Privacy',
        body: 'We never access or store your personal data on rented devices. See the Privacy Policy for how we handle your information.',
      },
      {
        heading: '8. Governing Law',
        body: 'These terms are governed by the laws of the Republic of the Philippines. Any disputes are handled in the courts of Quezon City, Metro Manila.',
      },
    ],
  },

  privacy: {
    title: 'Privacy Policy',
    intro: 'How we handle your data — with transparency and care.',
    sections: [
      {
        heading: 'Our Commitment',
        body: 'Your privacy matters. DiaLux collects the minimum data needed to run a rental, and never sells or shares your personal information with third parties.',
      },
      {
        heading: '1. What We Collect',
        body: 'Your name and email address, a delivery address and contact number, and your booking history. Payment in this build is simulated, so no card details are ever collected or stored.',
      },
      {
        heading: '2. How We Use Your Data',
        body: 'To fulfil and deliver your bookings, keep you informed about a rental, answer support requests, and — only when you opt in — send promotional emails about DiaLux devices and rental offers.',
      },
      {
        heading: '3. Secure Data Wiping',
        body: 'Every device returned to DiaLux undergoes a factory reset and secure wipe before it is rented again, logged by the technician team. Your data never stays on a device after return.',
      },
      {
        heading: '4. Data Retention',
        body: 'Your account data is kept while your account is active. You may request deletion of your account and its data at any time by contacting support.',
      },
      {
        heading: '5. Security',
        body: 'Passwords are stored as bcrypt hashes, sessions use signed JWTs, and password-reset links are stored only as one-way hashes so they cannot be replayed from the database.',
      },
      {
        heading: '6. Third-Party Services',
        body: 'We use MongoDB Atlas for the database and Google OAuth as an optional sign-in method. No other third party receives your data.',
      },
      {
        heading: '7. Your Rights',
        body: 'You can view and correct your details from your profile, change or withdraw your promotional-email choice from Privacy & Communications, request a copy of your data, or ask for your account to be deleted. Contact support and we will action it.',
      },
    ],
  },
};

/** A fresh, mutable copy of the defaults for one slug, or null. */
function defaultPage(slug) {
  const src = PAGE_DEFAULTS[slug];
  if (!src) return null;
  return {
    slug,
    title: src.title,
    intro: src.intro,
    sections: src.sections.map(s => ({ ...s })),
    published: true,
  };
}

module.exports = { PAGE_DEFAULTS, defaultPage };
