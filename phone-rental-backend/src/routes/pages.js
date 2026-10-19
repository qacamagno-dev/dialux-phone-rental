const express = require('express');
const Page = require('../models/Page');
const auth = require('../middlewares/auth');
const admin = require('../middlewares/admin');
const { audit, diff } = require('../services/audit');
const { PAGE_SLUGS } = require('../constants');
const { defaultPage } = require('../data/pageDefaults');

const router = express.Router();

/**
 * Trim a request body down to the editable page fields.
 * Sections are capped so a runaway paste cannot balloon the document.
 */
function pickPageFields(body) {
  const out = {};

  if (body.title !== undefined) out.title = String(body.title).trim().slice(0, 160);
  if (body.intro !== undefined) out.intro = String(body.intro).trim().slice(0, 1000);
  if (body.published !== undefined) out.published = Boolean(body.published);

  if (Array.isArray(body.sections)) {
    out.sections = body.sections
      .slice(0, 30)
      .map(s => ({
        heading: String(s?.heading || '').trim().slice(0, 160),
        body: String(s?.body || '').trim().slice(0, 8000),
      }))
      // A block with neither heading nor body is just an empty row in the
      // editor — drop it rather than storing noise.
      .filter(s => s.heading || s.body);
  }

  return out;
}

/* ---------------- public reads ---------------- */

/**
 * GET /api/pages
 *
 * All six pages. Each row carries `saved`: false means no administrator has
 * edited it yet and the content shown is the built-in default. The frontend
 * uses that flag to decide whether to override the copy baked into the HTML
 * shell — so an unedited page keeps its hand-written markup.
 */
router.get('/', async (req, res, next) => {
  try {
    const saved = await Page.find({});
    const bySlug = new Map(saved.map(p => [p.slug, p]));

    const pages = PAGE_SLUGS.map(slug => {
      const doc = bySlug.get(slug);
      if (doc) return { ...doc.toJSON(), slug, saved: true, isDefault: false };
      return { ...defaultPage(slug), saved: false, isDefault: true, updatedAt: null };
    });

    res.json({ pages, count: pages.length });
  } catch (err) { next(err); }
});

router.get('/:slug', async (req, res, next) => {
  try {
    const slug = String(req.params.slug || '').toLowerCase();
    if (!PAGE_SLUGS.includes(slug)) {
      return res.status(404).json({ error: `Unknown page "${slug}"` });
    }

    const doc = await Page.findOne({ slug });
    if (!doc) {
      return res.json({ ...defaultPage(slug), saved: false, isDefault: true, updatedAt: null });
    }
    res.json({ ...doc.toJSON(), saved: true, isDefault: false });
  } catch (err) { next(err); }
});

/* ---------------- admin writes ---------------- */

/**
 * PUT /api/pages/:slug
 * Upserts, so the first save on an unedited page creates the document from
 * whatever the editor had loaded (the defaults) plus the changes.
 */
router.put('/:slug', auth, admin, async (req, res, next) => {
  try {
    const slug = String(req.params.slug || '').toLowerCase();
    if (!PAGE_SLUGS.includes(slug)) {
      return res.status(400).json({ error: `Unknown page "${slug}" — editable pages are: ${PAGE_SLUGS.join(', ')}` });
    }

    const fields = pickPageFields(req.body);
    if (!fields.title) {
      return res.status(400).json({ error: 'A page title is required' });
    }

    const before = await Page.findOne({ slug });

    const doc = await Page.findOneAndUpdate(
      { slug },
      {
        $set: {
          ...fields,
          slug,
          updatedByEmail: req.adminUser?.email || '',
        },
      },
      { returnDocument: 'after', upsert: true, runValidators: true, setDefaultsOnInsert: true }
    );

    await audit(req, 'page.update', {
      targetType: 'Page',
      targetId: doc.id,
      targetLabel: doc.title,
      details: {
        slug,
        created: !before,
        changed: before
          ? diff(
              { title: before.title, intro: before.intro, sections: before.sections?.length, published: before.published },
              { title: doc.title, intro: doc.intro, sections: doc.sections?.length, published: doc.published }
            )
          : { sections: { from: null, to: doc.sections.length } },
      },
    });

    res.json({ ...doc.toJSON(), saved: true, isDefault: false });
  } catch (err) { next(err); }
});

/**
 * DELETE /api/pages/:slug
 * Reverts a page to the built-in copy by dropping the override document. The
 * page never goes blank — the HTML shell and the defaults are still there.
 */
router.delete('/:slug', auth, admin, async (req, res, next) => {
  try {
    const slug = String(req.params.slug || '').toLowerCase();
    if (!PAGE_SLUGS.includes(slug)) {
      return res.status(400).json({ error: `Unknown page "${slug}"` });
    }

    const gone = await Page.findOneAndDelete({ slug });
    if (!gone) return res.status(404).json({ error: 'That page has no saved edits to revert' });

    await audit(req, 'page.revert', {
      targetType: 'Page',
      targetId: gone.id,
      targetLabel: gone.title,
      details: { slug },
    });

    res.json({ ...defaultPage(slug), saved: false, isDefault: true, reverted: true });
  } catch (err) { next(err); }
});

module.exports = router;
