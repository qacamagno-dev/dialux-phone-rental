// ============================================================
// DiaLux — payment routes (PayMongo)
// ============================================================

const express = require('express');
const crypto = require('crypto');
const mongoose = require('mongoose');

const Order = require('../models/Order');
const Settings = require('../models/Settings');
const User = require('../models/User');

const auth = require('../middlewares/auth');
const admin = require('../middlewares/admin');

const {
  notify,
} = require('../services/notify');

const {
  audit,
} = require('../services/audit');

const {
  orderConfirmationMail,
} = require('../services/mailer');

const {
  autoAssignOutbound,
} = require('../services/dispatch');

const {
  PAYMENT_METHODS,
  GATEWAY_PAYMENT_METHODS,
  PAYMONGO_METHOD_MAP,
} = require('../constants');

const router =
  express.Router();

const isValidId =
  id =>
    mongoose.Types.ObjectId.isValid(id);

const genRef =
  () =>
    `PAY-${crypto
      .randomBytes(4)
      .toString('hex')
      .toUpperCase()}`;

const toCentavos =
  pesos =>
    Math.round(
      Number(pesos) *
      100
    );

const BANK_TRANSFER_DETAILS = {
  bank:
    'BDO',

  accountName:
    'DiaLux Rentals Inc.',

  accountNumber:
    '0012-3456-7890',

  note:
    'Use your booking reference as the transfer note, then upload your proof of payment.',
};

/* ---------------- PayMongo client ---------------- */

function paymongoConfigured() {
  return Boolean(
    process.env
      .PAYMONGO_SECRET_KEY
  );
}

function paymongoAuth() {
  return Buffer.from(
    `${process.env.PAYMONGO_SECRET_KEY}:`
  ).toString(
    'base64'
  );
}

async function paymongoRequest(
  path,
  body
) {
  const res =
    await fetch(
      `https://api.paymongo.com/v2${path}`,
      {
        method:
          'POST',

        headers: {
          'Content-Type':
            'application/json',

          Authorization:
            `Basic ${paymongoAuth()}`,
        },

        body:
          JSON.stringify(
            body
          ),
      }
    );

  const json =
    await res
      .json()
      .catch(
        () =>
          null
      );

  if (!res.ok) {
    const detail =
      json?.errors?.[0]?.detail ||
      `PayMongo returned ${res.status}`;

    const err =
      new Error(
        detail
      );

    err.status =
      502;

    err.gateway =
      true;

    throw err;
  }

  return json;
}

async function paymongoGet(
  path
) {
  const res =
    await fetch(
      `https://api.paymongo.com/v1${path}`,
      {
        method:
          'GET',

        headers: {
          Authorization:
            `Basic ${paymongoAuth()}`,

          Accept:
            'application/json',
        },
      }
    );

  const json =
    await res
      .json()
      .catch(
        () =>
          null
      );

  if (!res.ok) {
    const detail =
      json?.errors?.[0]?.detail ||
      `PayMongo returned ${res.status}`;

    const err =
      new Error(
        detail
      );

    err.status =
      502;

    err.gateway =
      true;

    throw err;
  }

  return json;
}

function checkoutSessionPaid(
  session
) {
  const attrs =
    session?.data?.attributes ||
    {};

  const payments =
    Array.isArray(
      attrs.payments
    )
      ? attrs.payments
      : [];

  const paymentPaid =
    payments.some(p => {
      const status =
        String(
          p?.attributes?.status ||
          ''
        ).toLowerCase();

      return (
        status === 'paid' ||
        status === 'succeeded'
      );
    });

  const intentStatus =
    String(
      attrs
        .payment_intent
        ?.attributes
        ?.status ||
      ''
    ).toLowerCase();

  const sessionStatus =
    String(
      attrs.status ||
      ''
    ).toLowerCase();

  return (
    paymentPaid ||
    intentStatus ===
      'succeeded' ||
    intentStatus ===
      'paid' ||
    sessionStatus ===
      'paid'
  );
}

async function markGatewayPaid(
  order,
  {
    note,
    referenceNo,
    source,
  }
) {
  if (
    order.payment?.status ===
      'paid' ||
    order.paid
  ) {
    const dispatch =
      await autoAssignOutbound(
        order,
        {
          source,
        }
      ).catch(
        () =>
          null
      );

    return {
      changed:
        false,

      dispatch,
    };
  }

  const settings =
    await Settings.get();

  const now =
    new Date();

  order.payment.status =
    'paid';

  order.payment.paidAt =
    now;

  order.payment.referenceNo =
    referenceNo ||
    order.payment.referenceNo ||
    genRef();

  order.paid =
    true;

  order.paidAt =
    now;

  if (
    order.status ===
    'pending'
  ) {
    order.status =
      'payment-confirmed';

    order.statusHistory.push({
      status:
        'payment-confirmed',

      at:
        now,

      note,
    });
  }

  await order.save();

  await notify(
    order.user,
    {
      type:
        'payment',

      title:
        `Payment confirmed — ${order.invoiceNo}`,

      message:
        `${settings.currencySymbol}${order.total.toLocaleString('en-PH')} received via ${order.payment.method}. We are preparing your device.`,

      link:
        `/order.html?id=${order.id}`,
    }
  );

  await orderConfirmationMail({
    to:
      order.userEmail,

    name:
      order.userName,

    order:
      order.toJSON(),

    currency:
      settings.currencySymbol,
  });

  const dispatch =
    await autoAssignOutbound(
      order,
      {
        source,
      }
    ).catch(err => {
      console.warn(
        '[DiaLux] automatic rider assignment failed:',
        err.message
      );

      return null;
    });

  return {
    changed:
      true,

    dispatch,
  };
}

function originOf(req) {
  return (
    `${req.protocol}://${req.get('host')}`
  );
}

function paymentReturnUrls(
  req,
  orderId
) {
  const webBase =
    originOf(req);

  const requestedReturnUrl =
    String(
      req.body?.returnUrl ||
      ''
    ).trim();

  try {
    if (
      requestedReturnUrl
    ) {
      const parsed =
        new URL(
          requestedReturnUrl
        );

      const isMobileDev =
        (
          parsed.hostname ===
            'localhost' ||
          parsed.hostname ===
            '127.0.0.1'
        ) &&
        parsed.port ===
          '8100';

      if (isMobileDev) {
        return {
          successUrl:
            `${parsed.origin}/order/${orderId}?payment=success`,

          cancelUrl:
            `${parsed.origin}/order/${orderId}?payment=cancelled`,
        };
      }
    }
  } catch {
    // Invalid returnUrl:
    // fall back to web checkout.
  }

  return {
    successUrl:
      `${webBase}/order.html?id=${orderId}&payment=success`,

    cancelUrl:
      `${webBase}/order.html?id=${orderId}&payment=cancelled`,
  };
}

/* ---------------- payment guard ---------------- */

async function loadPayableOrder(
  req
) {
  const {
    orderId,
  } = req.body;

  if (
    !isValidId(
      orderId
    )
  ) {
    return {
      error:
        'Invalid order id',

      status:
        400,
    };
  }

  const order =
    await Order.findById(
      orderId
    );

  if (!order) {
    return {
      error:
        'Order not found',

      status:
        404,
    };
  }

  if (
    String(order.user) !==
    String(req.userId)
  ) {
    return {
      error:
        'Not your order',

      status:
        403,
    };
  }

  if (
    order.paid ||
    order.payment?.status ===
      'paid'
  ) {
    return {
      error:
        'This booking has already been paid',

      status:
        409,
    };
  }

  if (
    order.status !==
    'pending'
  ) {
    return {
      error:
        `This booking is "${order.status}" and can no longer be paid here`,

      status:
        409,
    };
  }

  return {
    order,
  };
}

/* ================================================================
   POST /api/payments/intent
================================================================ */

router.post(
  '/intent',
  auth,
  async (req, res, next) => {
    try {
      const {
        order,
        error,
        status,
      } =
        await loadPayableOrder(
          req
        );

      if (error) {
        return res
          .status(status)
          .json({
            error,
          });
      }

      const settings =
        await Settings.get();

      const allowed =
        settings.paymentMethods
          ?.length
          ? settings.paymentMethods
          : PAYMENT_METHODS;

      if (!order.payment) {
        order.payment = {
          gateway:
            'paymongo',

          status:
            'pending',
        };

        await order.save();
      }

      await audit(
        req,
        'payment.intent',
        {
          targetType:
            'Order',

          targetId:
            order.id,

          targetLabel:
            order.invoiceNo,

          details: {
            amount:
              order.total,
          },
        }
      );

      res.json({
        orderId:
          order.id,

        amount:
          order.total,

        currency:
          'PHP',

        methods:
          allowed,
      });
    } catch (err) {
      next(err);
    }
  }
);

/* ================================================================
   POST /api/payments/method
================================================================ */

router.post(
  '/method',
  auth,
  async (req, res, next) => {
    try {
      const {
        order,
        error,
        status,
      } =
        await loadPayableOrder(
          req
        );

      if (error) {
        return res
          .status(status)
          .json({
            error,
          });
      }

      const settings =
        await Settings.get();

      const allowed =
        settings.paymentMethods
          ?.length
          ? settings.paymentMethods
          : PAYMENT_METHODS;

      const method =
        String(
          req.body.method ||
          ''
        );

      if (
        !PAYMENT_METHODS.includes(
          method
        )
      ) {
        return res
          .status(400)
          .json({
            error:
              `method must be one of: ${PAYMENT_METHODS.join(', ')}`,
          });
      }

      if (
        !allowed.includes(
          method
        )
      ) {
        return res
          .status(400)
          .json({
            error:
              `${method} is not currently offered — try one of: ${allowed.join(', ')}`,
          });
      }

      /* ---------- COD ---------- */

      if (
        method ===
        'cash'
      ) {
        order.payment = {
          ...order.payment
            ?.toObject
            ?.(),

          gateway:
            'manual',

          method,

          status:
            'pending',
        };

        if (
          order.status ===
          'pending'
        ) {
          order.status =
            'approved';

          order.statusHistory.push({
            status:
              'approved',

            at:
              new Date(),

            note:
              'Cash on delivery selected',
          });
        }

        await order.save();

        await audit(
          req,
          'payment.method',
          {
            targetType:
              'Order',

            targetId:
              order.id,

            targetLabel:
              order.invoiceNo,

            details: {
              method,
            },
          }
        );

        await notify(
          order.user,
          {
            type:
              'payment',

            title:
              `Cash on delivery — ${order.invoiceNo}`,

            message:
              'Have the exact amount ready. A rider will collect payment when the device is handed over.',

            link:
              `/order.html?id=${order.id}`,
          }
        );

        const dispatch =
          await autoAssignOutbound(
            order,
            {
              source:
                'cash-on-delivery-selected',
            }
          ).catch(err => {
            console.warn(
              '[DiaLux] automatic rider assignment failed:',
              err.message
            );

            return null;
          });

        return res.json({
          order,
          dispatch,
          instructions:
            'cash-on-delivery',
        });
      }

      /* ---------- bank transfer ---------- */

      if (
        method ===
        'bank-transfer'
      ) {
        const proofUrl =
          typeof req.body
            .proofUrl ===
          'string'
            ? req.body
                .proofUrl
                .slice(
                  0,
                  700_000
                )
            : '';

        order.payment = {
          ...order.payment
            ?.toObject
            ?.(),

          gateway:
            'manual',

          method,

          status:
            'pending',

          proofUrl:
            proofUrl ||
            order.payment
              ?.proofUrl ||
            '',
        };

        await order.save();

        await audit(
          req,
          'payment.method',
          {
            targetType:
              'Order',

            targetId:
              order.id,

            targetLabel:
              order.invoiceNo,

            details: {
              method,

              hasProof:
                Boolean(
                  proofUrl
                ),
            },
          }
        );

        if (proofUrl) {
          const admins =
            await User.find({
              role:
                'admin',
            }).select(
              '_id'
            );

          await Promise.all(
            admins.map(a =>
              notify(
                a._id,
                {
                  type:
                    'payment',

                  title:
                    `Bank transfer proof submitted: ${order.invoiceNo}`,

                  message:
                    `${order.userName || order.userEmail} uploaded proof of payment — please verify.`,

                  link:
                    '/admin.html#orders',
                }
              )
            )
          );
        }

        return res.json({
          order,
          bankDetails:
            BANK_TRANSFER_DETAILS,
        });
      }

      /* ---------- gateway ---------- */

      if (
        !GATEWAY_PAYMENT_METHODS.includes(
          method
        )
      ) {
        return res
          .status(400)
          .json({
            error:
              `Don't know how to process payment method "${method}"`,
          });
      }

      /*
       * No PayMongo key:
       * local simulated payment.
       */
      if (
        !paymongoConfigured()
      ) {
        order.payment = {
          ...order.payment
            ?.toObject
            ?.(),

          gateway:
            'paymongo',

          method,

          intentId:
            `sim_${crypto.randomBytes(6).toString('hex')}`,

          status:
            'paid',

          paidAt:
            new Date(),

          referenceNo:
            genRef(),
        };

        order.paid =
          true;

        order.paidAt =
          order.payment.paidAt;

        order.status =
          'payment-confirmed';

        order.statusHistory.push({
          status:
            'payment-confirmed',

          at:
            new Date(),

          note:
            'Simulated payment (no PAYMONGO_SECRET_KEY configured)',
        });

        await order.save();

        await audit(
          req,
          'payment.simulated',
          {
            targetType:
              'Order',

            targetId:
              order.id,

            targetLabel:
              order.invoiceNo,

            details: {
              method,
            },
          }
        );

        await notify(
          order.user,
          {
            type:
              'payment',

            title:
              `Payment confirmed — ${order.invoiceNo}`,

            message:
              `${settings.currencySymbol}${order.total.toLocaleString('en-PH')} received via ${method} (simulated). We are preparing your device.`,

            link:
              `/order.html?id=${order.id}`,
          }
        );

        await orderConfirmationMail({
          to:
            order.userEmail,

          name:
            order.userName,

          order:
            order.toJSON(),

          currency:
            settings.currencySymbol,
        });

        const dispatch =
          await autoAssignOutbound(
            order,
            {
              source:
                'simulated-payment-confirmed',
            }
          ).catch(err => {
            console.warn(
              '[DiaLux] automatic rider assignment failed:',
              err.message
            );

            return null;
          });

        return res.json({
          simulated:
            true,

          order,

          dispatch,

          redirectUrl:
            `/order.html?id=${order.id}`,
        });
      }

      const {
        successUrl,
        cancelUrl,
      } =
        paymentReturnUrls(
          req,
          order.id
        );

      const session =
        await paymongoRequest(
          '/checkout_sessions',
          {
            data: {
              attributes: {
                line_items: [
                  {
                    name:
                      `DiaLux booking ${order.invoiceNo}`,

                    amount:
                      toCentavos(
                        order.total
                      ),

                    currency:
                      'PHP',

                    quantity:
                      1,
                  },
                ],

                payment_method_types: [
                  PAYMONGO_METHOD_MAP[
                    method
                  ],
                ],

                description:
                  `DiaLux booking ${order.invoiceNo}`,

                reference_number:
                  order.id,

                success_url:
                  successUrl,

                cancel_url:
                  cancelUrl,

                billing: {
                  name:
                    order.userName ||
                    undefined,

                  email:
                    order.userEmail,
                },
              },
            },
          }
        );

      order.payment = {
        ...order.payment
          ?.toObject
          ?.(),

        gateway:
          'paymongo',

        method,

        intentId:
          session.data.id,

        status:
          'pending',

        referenceNo:
          session.data
            .attributes
            ?.reference_number ||
          order.id,
      };

      await order.save();

      await audit(
        req,
        'payment.method',
        {
          targetType:
            'Order',

          targetId:
            order.id,

          targetLabel:
            order.invoiceNo,

          details: {
            method,

            intentId:
              session.data.id,
          },
        }
      );

      res.json({
        checkoutUrl:
          session.data
            .attributes
            .checkout_url,
      });
    } catch (err) {
      if (err.gateway) {
        return res
          .status(
            err.status
          )
          .json({
            error:
              `Payment gateway error: ${err.message}`,
          });
      }

      next(err);
    }
  }
);

/* ================================================================
   POST /api/payments/:orderId/proof
================================================================ */

router.post(
  '/:orderId/proof',
  auth,
  async (req, res, next) => {
    try {
      if (
        !isValidId(
          req.params
            .orderId
        )
      ) {
        return res
          .status(400)
          .json({
            error:
              'Invalid order id',
          });
      }

      const order =
        await Order.findById(
          req.params
            .orderId
        );

      if (!order) {
        return res
          .status(404)
          .json({
            error:
              'Order not found',
          });
      }

      if (
        String(order.user) !==
        String(req.userId)
      ) {
        return res
          .status(403)
          .json({
            error:
              'Not your order',
          });
      }

      if (
        order.payment
          ?.method !==
        'bank-transfer'
      ) {
        return res
          .status(409)
          .json({
            error:
              'This booking is not set to pay by bank transfer',
          });
      }

      if (
        order.payment.status ===
        'paid'
      ) {
        return res
          .status(409)
          .json({
            error:
              'This booking has already been paid',
          });
      }

      const proofUrl =
        String(
          req.body
            .proofUrl ||
          ''
        );

      if (!proofUrl) {
        return res
          .status(400)
          .json({
            error:
              'proofUrl is required',
          });
      }

      if (
        proofUrl.length >
        700_000
      ) {
        return res
          .status(413)
          .json({
            error:
              'Proof upload is too large',
          });
      }

      order.payment.proofUrl =
        proofUrl;

      await order.save();

      await audit(
        req,
        'payment.proof',
        {
          targetType:
            'Order',

          targetId:
            order.id,

          targetLabel:
            order.invoiceNo,
        }
      );

      const admins =
        await User.find({
          role:
            'admin',
        }).select(
          '_id'
        );

      await Promise.all(
        admins.map(a =>
          notify(
            a._id,
            {
              type:
                'payment',

              title:
                `Bank transfer proof submitted: ${order.invoiceNo}`,

              message:
                `${order.userName || order.userEmail} uploaded proof of payment — please verify.`,

              link:
                '/admin.html#orders',
            }
          )
        )
      );

      res.json(
        order
      );
    } catch (err) {
      next(err);
    }
  }
);

/* ================================================================
   POST /api/payments/:orderId/verify
================================================================ */

router.post(
  '/:orderId/verify',
  auth,
  admin,
  async (req, res, next) => {
    try {
      if (
        !isValidId(
          req.params
            .orderId
        )
      ) {
        return res
          .status(400)
          .json({
            error:
              'Invalid order id',
          });
      }

      const order =
        await Order.findById(
          req.params
            .orderId
        );

      if (!order) {
        return res
          .status(404)
          .json({
            error:
              'Order not found',
          });
      }

      if (
        order.payment
          ?.method !==
        'bank-transfer'
      ) {
        return res
          .status(409)
          .json({
            error:
              'Only a bank-transfer payment can be verified here',
          });
      }

      if (
        order.payment.status ===
        'paid'
      ) {
        return res
          .status(409)
          .json({
            error:
              'This booking has already been verified as paid',
          });
      }

      const settings =
        await Settings.get();

      order.payment.status =
        'paid';

      order.payment.paidAt =
        new Date();

      order.payment.referenceNo =
        order.payment.referenceNo ||
        genRef();

      order.payment.verifiedByEmail =
        req.adminUser.email;

      order.paid =
        true;

      order.paidAt =
        order.payment.paidAt;

      if (
        order.status ===
        'pending'
      ) {
        order.status =
          'payment-confirmed';

        order.statusHistory.push({
          status:
            'payment-confirmed',

          at:
            new Date(),

          byEmail:
            req.adminUser.email,

          note:
            'Bank transfer verified',
        });
      }

      await order.save();

      await audit(
        req,
        'payment.verify',
        {
          targetType:
            'Order',

          targetId:
            order.id,

          targetLabel:
            order.invoiceNo,

          details: {
            amount:
              order.total,

            customer:
              order.userEmail,
          },
        }
      );

      await notify(
        order.user,
        {
          type:
            'payment',

          title:
            `Payment verified — ${order.invoiceNo}`,

          message:
            `Your bank transfer of ${settings.currencySymbol}${order.total.toLocaleString('en-PH')} has been confirmed. We are preparing your device.`,

          link:
            `/order.html?id=${order.id}`,
        }
      );

      await orderConfirmationMail({
        to:
          order.userEmail,

        name:
          order.userName,

        order:
          order.toJSON(),

        currency:
          settings.currencySymbol,
      });

      const dispatch =
        await autoAssignOutbound(
          order,
          {
            source:
              'bank-transfer-verified',
          }
        ).catch(err => {
          console.warn(
            '[DiaLux] automatic rider assignment failed:',
            err.message
          );

          return null;
        });

      res.json({
        order,
        dispatch,
      });
    } catch (err) {
      next(err);
    }
  }
);

/* ================================================================
   GET /api/payments/:orderId/status

   IMPORTANT FIX:
   On localhost PayMongo cannot call the local webhook, so when the
   customer returns from PayMongo this endpoint directly retrieves the
   checkout session and reconciles it.
================================================================ */

router.get(
  '/:orderId/status',
  auth,
  async (req, res, next) => {
    try {
      if (
        !isValidId(
          req.params
            .orderId
        )
      ) {
        return res
          .status(400)
          .json({
            error:
              'Invalid order id',
          });
      }

      const order =
        await Order.findById(
          req.params
            .orderId
        );

      if (!order) {
        return res
          .status(404)
          .json({
            error:
              'Order not found',
          });
      }

      const me =
        await User.findById(
          req.userId
        ).select(
          'role'
        );

      const owns =
        String(order.user) ===
        String(req.userId);

      if (
        !owns &&
        me?.role !==
          'admin'
      ) {
        return res
          .status(403)
          .json({
            error:
              'Not your order',
          });
      }

      let dispatch =
        null;

      if (
        paymongoConfigured() &&
        order.payment
          ?.gateway ===
          'paymongo' &&
        GATEWAY_PAYMENT_METHODS.includes(
          order.payment
            ?.method
        ) &&
        order.payment
          ?.status !==
          'paid' &&
        order.payment
          ?.intentId
      ) {
        try {
          const session =
            await paymongoGet(
              `/checkout_sessions/${encodeURIComponent(order.payment.intentId)}`
            );

          const reference =
            String(
              session
                ?.data
                ?.attributes
                ?.reference_number ||
              ''
            );

          if (
            (
              !reference ||
              reference ===
                String(
                  order.id
                )
            ) &&
            checkoutSessionPaid(
              session
            )
          ) {
            const result =
              await markGatewayPaid(
                order,
                {
                  note:
                    'PayMongo checkout reconciled after redirect',

                  referenceNo:
                    session
                      ?.data
                      ?.id ||
                    order.payment
                      .referenceNo,

                  source:
                    'paymongo-return-reconcile',
                }
              );

            dispatch =
              result.dispatch;

            await audit(
              req,
              'payment.reconcile',
              {
                targetType:
                  'Order',

                targetId:
                  order.id,

                targetLabel:
                  order.invoiceNo,

                details: {
                  sessionId:
                    order.payment
                      .intentId,

                  paid:
                    true,
                },
              }
            );
          }
        } catch (err) {
          console.warn(
            '[DiaLux] PayMongo reconciliation failed:',
            err.message
          );
        }
      }

      res.json({
        status:
          order.payment
            ?.status ||
          (
            order.paid
              ? 'paid'
              : 'pending'
          ),

        method:
          order.payment
            ?.method ||
          '',

        referenceNo:
          order.payment
            ?.referenceNo ||
          '',

        paidAt:
          order.payment
            ?.paidAt ||
          null,

        orderStatus:
          order.status,

        dispatch,
      });
    } catch (err) {
      next(err);
    }
  }
);

/* ================================================================
   POST /api/payments/webhook
================================================================ */

function verifyPaymongoSignature(
  rawBody,
  header,
  secret
) {
  if (
    !header ||
    !secret ||
    !rawBody
  ) {
    return false;
  }

  const parts =
    {};

  for (
    const kv
    of header.split(',')
  ) {
    const i =
      kv.indexOf(
        '='
      );

    if (
      i ===
      -1
    ) {
      continue;
    }

    parts[
      kv
        .slice(0, i)
        .trim()
    ] =
      kv
        .slice(i + 1)
        .trim();
  }

  if (!parts.t) {
    return false;
  }

  const expectedHex =
    crypto
      .createHmac(
        'sha256',
        secret
      )
      .update(
        `${parts.t}.${rawBody}`
      )
      .digest(
        'hex'
      );

  const expected =
    Buffer.from(
      expectedHex,
      'hex'
    );

  const matches =
    candidate => {
      if (!candidate) {
        return false;
      }

      const given =
        Buffer.from(
          candidate,
          'hex'
        );

      return (
        given.length ===
          expected.length &&
        crypto.timingSafeEqual(
          expected,
          given
        )
      );
    };

  return (
    matches(parts.te) ||
    matches(parts.li)
  );
}

router.post(
  '/webhook',
  async (req, res) => {
    const secret =
      process.env
        .PAYMONGO_WEBHOOK_SECRET;

    const signatureHeader =
      req.header(
        'Paymongo-Signature'
      );

    const raw =
      req.rawBody
        ? req.rawBody.toString(
            'utf8'
          )
        : '';

    if (
      !verifyPaymongoSignature(
        raw,
        signatureHeader,
        secret
      )
    ) {
      console.warn(
        '[DiaLux] rejected a PayMongo webhook with a bad/missing signature'
      );

      return res
        .status(401)
        .json({
          error:
            'Invalid signature',
        });
    }

    res
      .status(200)
      .json({
        received:
          true,
      });

    try {
      const envelope =
        req.body?.data;

      const eventType =
        envelope
          ?.attributes
          ?.type ||
        '';

      const resource =
        envelope
          ?.attributes
          ?.data ||
        envelope
          ?.data ||
        {};

      const referenceNumber =
        resource
          ?.attributes
          ?.reference_number ||
        '';

      const sessionId =
        resource?.id ||
        '';

      if (
        !eventType.startsWith(
          'checkout_session.payment.'
        ) &&
        !eventType.startsWith(
          'payment.'
        )
      ) {
        return;
      }

      const order =
        referenceNumber &&
        isValidId(
          referenceNumber
        )
          ? await Order.findById(
              referenceNumber
            )
          : await Order.findOne({
              'payment.intentId':
                sessionId,
            });

      if (!order) {
        console.warn(
          `[DiaLux] webhook ${eventType} matched no order (ref=${referenceNumber}, session=${sessionId})`
        );

        return;
      }

      const paidEvent =
        eventType.endsWith(
          '.paid'
        );

      const failedEvent =
        eventType.endsWith(
          '.failed'
        );

      if (
        paidEvent &&
        order.payment
          ?.status !==
          'paid'
      ) {
        await markGatewayPaid(
          order,
          {
            note:
              `PayMongo webhook: ${eventType}`,

            referenceNo:
              resource?.id ||
              order.payment
                .referenceNo,

            source:
              `paymongo-webhook:${eventType}`,
          }
        );
      } else if (
        failedEvent
      ) {
        order.payment.status =
          'failed';

        order.payment.failReason =
          resource
            ?.attributes
            ?.last_payment_error
            ?.detail ||
          'Payment failed';

        await order.save();

        await notify(
          order.user,
          {
            type:
              'payment',

            title:
              `Payment failed — ${order.invoiceNo}`,

            message:
              'Your payment did not go through. You can try again from your profile.',

            link:
              `/order.html?id=${order.id}`,
          }
        );
      }
    } catch (err) {
      console.error(
        '[DiaLux] error processing PayMongo webhook:',
        err
      );
    }
  }
);

module.exports = router;