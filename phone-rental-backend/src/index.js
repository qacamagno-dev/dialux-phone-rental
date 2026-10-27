require('dotenv').config();

const express =
  require('express');

const cors =
  require('cors');

const mongoose =
  require('mongoose');

const path =
  require('path');

const jwt =
  require('jsonwebtoken');


const authRoutes =
  require('./routes/auth');

const productRoutes =
  require('./routes/products');

const cartRoutes =
  require('./routes/cart');

const orderRoutes =
  require('./routes/orders');

const userRoutes =
  require('./routes/users');

const wishlistRoutes =
  require('./routes/wishlist');

const notificationRoutes =
  require('./routes/notifications');

const supportRoutes =
  require('./routes/support');

const pageRoutes =
  require('./routes/pages');

const settingsRoutes =
  require('./routes/settings');

const auditRoutes =
  require('./routes/audit');

const paymentRoutes =
  require('./routes/payments');

const riderRoutes =
  require('./routes/riders');

const chatRoutes =
  require('./routes/chat');

const pushRoutes =
  require('./routes/push');


const Settings =
  require('./models/Settings');

const User =
  require('./models/User');

const mailer =
  require('./services/mailer');

const {
  firebaseConfigured,
  getFirebaseMessaging,
} = require('./services/firebase');


/* ---------------- environment ---------------- */


const REQUIRED_ENV = [
  'MONGODB_URI',
  'JWT_SECRET',
];


const missing =
  REQUIRED_ENV.filter(
    key =>
      !process.env[key]
  );


if (
  missing.length
) {

  console.error(
    `❌ Missing required environment variable(s): ${missing.join(', ')}`
  );

  console.error(
    '   Copy phone-rental-backend/.env.example to .env and fill in the values.'
  );

  process.exit(
    1
  );

}


if (
  !process.env.GOOGLE_CLIENT_ID
) {

  console.warn(
    '⚠️ GOOGLE_CLIENT_ID is not set — Google login will fail.'
  );

}


if (
  !process.env.PAYMONGO_SECRET_KEY
) {

  console.warn(
    '⚠️ PAYMONGO_SECRET_KEY is not set.'
  );

}


if (
  !process.env.GROQ_API_KEY
) {

  console.warn(
    '⚠️ GROQ_API_KEY is not set — chatbot responses will fail.'
  );

}


if (
  !firebaseConfigured()
) {

  console.warn(
    '⚠️ Firebase push notifications are not configured.'
  );

} else {

  /*
   * Initialize early so deployment logs
   * immediately tell us whether the
   * service-account credentials work.
   */
  getFirebaseMessaging();

}


if (
  process.env.NODE_ENV !==
  'production'
) {

  console.warn(
    '⚠️ NODE_ENV is not "production".'
  );

}


const PORT =
  Number(
    process.env.PORT
  ) ||
  5000;


const FRONTEND_DIR =
  path.join(
    __dirname,
    '../../phone-rental-frontend'
  );


const app =
  express();


app.use(
  cors()
);


app.use(
  express.json({
    limit:
      '1mb',

    verify: (
      req,
      _res,
      buffer
    ) => {

      req.rawBody =
        buffer;

    },
  })
);


app.set(
  'trust proxy',
  1
);


app.use(
  (
    req,
    _res,
    next
  ) => {

    if (
      req.body ===
      undefined
    ) {

      req.body =
        {};

    }


    next();

  }
);


/* ---------------- database ---------------- */


mongoose
  .connect(
    process.env.MONGODB_URI
  )
  .then(
    async () => {

      console.log(
        '✅ MongoDB connected'
      );


      try {

        const settings =
          await Settings.get({
            fresh:
              true,
          });


        console.log(
          `⚙️ Settings loaded — delivery ${settings.currencySymbol}${settings.deliveryFee}, protection ${settings.protectionFeePct}%`
        );

      } catch (error) {

        console.warn(
          '⚠️ Could not load settings:',
          error.message
        );

      }

    }
  )
  .catch(
    error => {

      console.error(
        '❌ MongoDB error:',
        error.message
      );

    }
  );


/* ---------------- maintenance mode ---------------- */


const SAFE_DURING_MAINTENANCE = [
  '/api/auth',
  '/api/settings',
  '/api/payments/webhook',
];


app.use(
  '/api',

  async (
    req,
    res,
    next
  ) => {

    if (
      [
        'GET',
        'HEAD',
        'OPTIONS',
      ].includes(
        req.method
      )
    ) {

      return next();

    }


    if (
      SAFE_DURING_MAINTENANCE.some(
        prefix =>
          req.originalUrl.startsWith(
            prefix
          )
      )
    ) {

      return next();

    }


    try {

      const settings =
        await Settings.get();


      if (
        !settings.maintenanceMode
      ) {

        return next();

      }


      const token =
        req
          .header(
            'Authorization'
          )
          ?.replace(
            'Bearer ',
            ''
          );


      if (token) {

        try {

          const {
            userId,
          } =
            jwt.verify(
              token,
              process.env.JWT_SECRET
            );


          const me =
            await User
              .findById(
                userId
              )
              .select(
                'role'
              );


          if (
            me?.role ===
            'admin'
          ) {

            return next();

          }

        } catch {

          // Fall through.

        }

      }


      return res
        .status(
          503
        )
        .json({
          error:
            'DiaLux is in maintenance right now — bookings are paused. Please try again shortly.',
        });

    } catch {

      return next();

    }

  }
);


/* ---------------- API ---------------- */


app.get(
  '/api/health',

  (
    req,
    res
  ) => {

    const states = [
      'disconnected',
      'connected',
      'connecting',
      'disconnecting',
    ];


    res.json({
      ok:
        true,

      db:
        states[
          mongoose.connection
            .readyState
        ] ||
        'unknown',

      mail:
        mailer.currentTransport(),

      firebase:
        firebaseConfigured(),

      env:
        process.env.NODE_ENV ||
        'development',

      uptime:
        Math.round(
          process.uptime()
        ),
    });

  }
);


app.use(
  '/api/auth',
  authRoutes
);

app.use(
  '/api/products',
  productRoutes
);

app.use(
  '/api/cart',
  cartRoutes
);

app.use(
  '/api/orders',
  orderRoutes
);

app.use(
  '/api/users',
  userRoutes
);

app.use(
  '/api/wishlist',
  wishlistRoutes
);

app.use(
  '/api/notifications',
  notificationRoutes
);

app.use(
  '/api/support',
  supportRoutes
);

app.use(
  '/api/pages',
  pageRoutes
);

app.use(
  '/api/settings',
  settingsRoutes
);

app.use(
  '/api/audit',
  auditRoutes
);

app.use(
  '/api/payments',
  paymentRoutes
);

app.use(
  '/api/riders',
  riderRoutes
);

app.use(
  '/api/chat',
  chatRoutes
);

app.use(
  '/api/push',
  pushRoutes
);


app.use(
  '/api',

  (
    req,
    res
  ) => {

    res
      .status(
        404
      )
      .json({
        error:
          `No such endpoint: ${req.method} ${req.originalUrl}`,
      });

  }
);


/* ---------------- static frontend ---------------- */


app.use(
  express.static(
    FRONTEND_DIR
  )
);


app.use(
  (
    req,
    res
  ) => {

    res.sendFile(
      path.join(
        FRONTEND_DIR,
        'index.html'
      )
    );

  }
);


/* ---------------- errors ---------------- */


app.use(
  (
    err,
    req,
    res,
    _next
  ) => {

    if (
      err?.name ===
      'ValidationError'
    ) {

      const detail =
        Object.values(
          err.errors ||
          {}
        )
          .map(
            error =>
              error.message
          )
          .join(
            '; '
          );


      return res
        .status(
          400
        )
        .json({
          error:
            detail ||
            'Validation failed',
        });

    }


    if (
      err?.name ===
      'CastError'
    ) {

      return res
        .status(
          400
        )
        .json({
          error:
            `Invalid value for ${err.path}`,
        });

    }


    if (
      err?.code ===
      11000
    ) {

      return res
        .status(
          409
        )
        .json({
          error:
            'That record already exists',
        });

    }


    console.error(
      '❌ Unhandled error:',
      err
    );


    res
      .status(
        500
      )
      .json({
        error:
          'Internal server error',
      });

  }
);


app.listen(
  PORT,

  () => {

    console.log(
      `🚀 DiaLux server running on http://localhost:${PORT}`
    );

  }
);