const express = require('express');
const mongoose = require('mongoose');
const crypto = require('crypto');

const Order = require('../models/Order');
const Cart = require('../models/Cart');
const Product = require('../models/Product');
const User = require('../models/User');
const Settings = require('../models/Settings');
const Delivery = require('../models/Delivery');

const auth = require('../middlewares/auth');
const admin = require('../middlewares/admin');
const staff = require('../middlewares/staff');
const customerOnly = require('../middlewares/customerOnly');

const {
  notify,
  notifyOrderStatus,
} = require('../services/notify');

const {
  audit,
} = require('../services/audit');

const {
  orderConfirmationMail,
} = require('../services/mailer');

const {
  alertLowStock,
} = require('../services/stockAlert');

const {
  settle,
  rentalClock,
} = require('../services/settlement');

const {
  progressOrder,
  progressOrders,
} = require('../services/orderProgressor');

const {
  dispatchOrder,
} = require('../services/dispatch');

const {
  PLANS,
  PLAN_DAYS,
  ORDER_STATUSES,
  OPEN_STATUSES,
  PAYMENT_METHODS,
  ORDER_TYPES,
  PICKUP_HUBS,
  bestValue,
  daysBetween,
  orderTypeFeeFor,
  protectionFeeFor,
  looksLikeQC,
  INSPECTION_CHECKLIST,
  RETURN_SLOTS,
} = require('../constants');


const router =
  express.Router();

router.use(auth);


const isValidId =
  id =>
    mongoose.Types
      .ObjectId
      .isValid(id);


const CLOSED_STATUSES = [
  'cancelled',
  'completed',
  'refunded',
];


const RETURNABLE_STATUSES = [
  'delivered',
  'active',
];


const RETURN_REQUEST_STATUSES = [
  'received',
  'active',
];


const MAX_PHOTO_CHARS =
  700_000;


const cleanPhotos =
  value =>
    (
      Array.isArray(value)
        ? value
        : []
    )
      .filter(
        photo =>
          typeof photo ===
            'string' &&
          photo
      )
      .slice(
        0,
        6
      )
      .map(
        photo =>
          photo.slice(
            0,
            MAX_PHOTO_CHARS
          )
      );


const money =
  (
    settings,
    number
  ) =>
    `${settings.currencySymbol || '₱'}${Number(number || 0).toLocaleString('en-PH')}`;


/**
 * Push a status change onto an order.
 *
 * Caller is responsible for save().
 */
function setStatus(
  order,
  status,
  note = '',
  byEmail = ''
) {
  order.status =
    status;

  order.statusHistory.push({
    status,
    at: new Date(),
    note,
    byEmail,
  });
}


/**
 * Send a notification to every admin.
 */
async function notifyAdmins(
  payload
) {
  const admins =
    await User.find({
      role:
        'admin',
    }).select(
      '_id'
    );

  await Promise.all(
    admins.map(
      adminUser =>
        notify(
          adminUser._id,
          payload
        )
    )
  );
}


/**
 * Automatic dispatch must remain best-effort.
 *
 * Payment / checkout must not fail just because all riders are off duty.
 */
async function dispatchBestEffort(
  order,
  options = {},
  source = 'order flow'
) {
  try {
    const leg =
      options.leg === 'return'
        ? 'return'
        : 'outbound';

    return await dispatchOrder(
      order,
      leg,
      {
        source,
      }
    );
  } catch (err) {
    console.warn(
      `[DiaLux] automatic rider dispatch failed during ${source} for ${order?.invoiceNo || order?.id}:`,
      err.message
    );

    return {
      assigned:
        false,

      reason:
        'dispatch-error',

      error:
        err.message,
    };
  }
}


function rentalDepositFor(
  product,
  plan
) {
  if (
    plan === 'Daily'
  ) {
    return 500;
  }

  if (
    plan === 'Monthly'
  ) {
    return 5000;
  }

  return 2500;
}


/* ============================================================
   ORDER DECORATION
   ============================================================ */

/**
 * Add live rider-leg and rental-clock information without storing it
 * redundantly on the order document.
 */
async function decorate(
  order,
  settings
) {
  const json =
    order.toJSON();

  json.rentalClock =
    rentalClock(
      order,
      settings
    );

  const legIds = [
    order.deliveryJob,
    order.returnDeliveryJob,
  ].filter(Boolean);

  json.legs =
    {};

  if (
    legIds.length
  ) {
    const deliveries =
      await Delivery.find({
        _id: {
          $in:
            legIds,
        },
      });

    const riders =
      await User.find({
        _id: {
          $in:
            deliveries
              .map(
                delivery =>
                  delivery.rider
              )
              .filter(Boolean),
        },
      }).select(
        'name profile phone'
      );

    for (
      const delivery of
      deliveries
    ) {
      const riderUser =
        riders.find(
          rider =>
            String(
              rider._id
            ) ===
            String(
              delivery.rider
            )
        );

      const last =
        delivery.checkpoints[
          delivery.checkpoints.length -
          1
        ];

      let eta =
        delivery.scheduledAt
          ? new Date(
              delivery.scheduledAt
            )
          : null;

      if (
        !eta &&
        last &&
        [
          'picked-up',
          'in-transit',
        ].includes(
          delivery.status
        )
      ) {
        eta =
          new Date(
            new Date(
              last.at
            ).getTime() +
            45 *
              60_000
          );
      }

      if (
        !eta &&
        last &&
        delivery.status ===
          'arriving'
      ) {
        eta =
          new Date(
            new Date(
              last.at
            ).getTime() +
            10 *
              60_000
          );
      }

      json.legs[
        delivery.type
      ] = {
        id:
          delivery.id,

        status:
          delivery.status,

        riderName:
          riderUser?.name ||
          '',

        riderPhone:
          riderUser
            ?.profile
            ?.phone ||
          riderUser?.phone ||
          '',

        eta:
          [
            'delivered',
            'failed',
          ].includes(
            delivery.status
          )
            ? null
            : eta,

        checkpoints:
          delivery.checkpoints,
      };
    }
  }

  return json;
}


/* ============================================================
   DATE HELPERS
   ============================================================ */

function isoDate(
  date = new Date()
) {
  return date
    .toISOString()
    .slice(
      0,
      10
    );
}


function addDays(
  dateStr,
  days
) {
  const date =
    new Date(
      `${dateStr}T00:00:00Z`
    );

  date.setUTCDate(
    date.getUTCDate() +
    days
  );

  return date
    .toISOString()
    .slice(
      0,
      10
    );
}


const isValidDateStr =
  value =>
    /^\d{4}-\d{2}-\d{2}$/.test(
      value
    ) &&
    !Number.isNaN(
      Date.parse(
        `${value}T00:00:00Z`
      )
    );


function isoWeekKey(
  date
) {
  const d =
    new Date(
      Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate()
      )
    );

  const day =
    d.getUTCDay() ||
    7;

  d.setUTCDate(
    d.getUTCDate() +
    4 -
    day
  );

  const yearStart =
    new Date(
      Date.UTC(
        d.getUTCFullYear(),
        0,
        1
      )
    );

  const week =
    Math.ceil(
      (
        (
          d -
          yearStart
        ) /
          86_400_000 +
        1
      ) /
        7
    );

  return (
    `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
  );
}


/* ============================================================
   STOCK
   ============================================================ */

/**
 * Give reserved devices back to inventory exactly once.
 */
async function releaseStock(
  order
) {
  if (
    order.stockReleased
  ) {
    return;
  }

  await Promise.all(
    order.items.map(
      item =>
        Product.updateOne(
          {
            _id:
              item.product,
          },
          {
            $inc: {
              stock:
                item.qty,
            },
          }
        )
    )
  );

  order.stockReleased =
    true;
}


/* ============================================================
   ADDRESS / DELIVERY
   ============================================================ */

function resolveDelivery(
  user,
  body = {}
) {
  if (
    body.addressId
  ) {
    const picked =
      user.addresses
        ?.id
        ?.(body.addressId);

    if (picked) {
      return {
        address: [
          picked.address,
          picked.city,
          picked.zip,
        ]
          .filter(Boolean)
          .join(', '),

        phone:
          picked.phone ||
          user.profile
            ?.phone ||
          '',
      };
    }
  }

  if (
    body.address
  ) {
    return {
      address:
        String(
          body.address
        ).trim(),

      phone:
        String(
          body.phone ||
          user.profile
            ?.phone ||
          ''
        ).trim(),
    };
  }

  const defaultAddress =
    user.defaultAddress
      ?.();

  if (
    defaultAddress
  ) {
    return {
      address: [
        defaultAddress.address,
        defaultAddress.city,
        defaultAddress.zip,
      ]
        .filter(Boolean)
        .join(', '),

      phone:
        defaultAddress.phone ||
        user.profile
          ?.phone ||
        '',
    };
  }

  return null;
}


/* ============================================================
   RENTAL WINDOW
   ============================================================ */

function resolveWindow(
  body,
  settings
) {
  const startDate =
    body.startDate ||
    isoDate();

  if (
    !isValidDateStr(
      startDate
    )
  ) {
    return {
      error:
        'startDate must be YYYY-MM-DD',
    };
  }

  if (
    startDate <
    isoDate()
  ) {
    return {
      error:
        'startDate cannot be in the past',
    };
  }

  const endDate =
    body.endDate ||
    addDays(
      startDate,
      7
    );

  if (
    !isValidDateStr(
      endDate
    )
  ) {
    return {
      error:
        'endDate must be YYYY-MM-DD',
    };
  }

  if (
    endDate <
    startDate
  ) {
    return {
      error:
        'endDate cannot be before startDate',
    };
  }

  const days =
    daysBetween(
      startDate,
      endDate
    );

  const min =
    Number(
      settings.minRentalDays
    ) ||
    1;

  const max =
    Number(
      settings.maxRentalDays
    ) ||
    365;

  if (
    days <
    min
  ) {
    return {
      error:
        `The minimum rental is ${min} day${min === 1 ? '' : 's'}`,
    };
  }

  if (
    days >
    max
  ) {
    return {
      error:
        `The maximum rental is ${max} days`,
    };
  }

  return {
    startDate,
    endDate,
    days,
  };
}


/* ============================================================
   ORDER TYPE
   ============================================================ */

function resolveOrderType(
  body
) {
  const orderType =
    ORDER_TYPES.includes(
      body.orderType
    )
      ? body.orderType
      : 'delivery';

  const timeSlot =
    String(
      body.timeSlot ||
      ''
    )
      .trim()
      .slice(
        0,
        120
      );


  if (
    orderType ===
    'pickup'
  ) {
    const hub =
      PICKUP_HUBS.find(
        item =>
          item.id ===
          body.pickupHub
      );

    if (!hub) {
      return {
        error:
          `pickupHub must be one of: ${PICKUP_HUBS.map(h => h.id).join(', ')}`,
      };
    }

    if (!timeSlot) {
      return {
        error:
          'A pickup time slot is required',
      };
    }

    return {
      orderType,

      pickupHub:
        hub.id,

      address:
        `${hub.name}, ${hub.address}`,

      timeSlot,
    };
  }


  if (
    orderType ===
    'meetup'
  ) {
    const meetupLocation =
      String(
        body.meetupLocation ||
        ''
      )
        .trim()
        .slice(
          0,
          300
        );

    if (
      !meetupLocation
    ) {
      return {
        error:
          'A meet-up location is required',
      };
    }

    if (
      !looksLikeQC(
        meetupLocation
      )
    ) {
      return {
        error:
          'Meet-ups are only available inside Quezon City — please mention Quezon City (or QC) in the location',
      };
    }

    if (
      !timeSlot
    ) {
      return {
        error:
          'A preferred meet-up time is required',
      };
    }

    return {
      orderType,

      meetupLocation,

      address:
        `Meet-up: ${meetupLocation}`,

      timeSlot,
    };
  }


  return {
    orderType:
      'delivery',

    timeSlot,
  };
}


function orderTypeSummary(
  typeInfo
) {
  if (
    typeInfo.orderType ===
    'pickup'
  ) {
    const hub =
      PICKUP_HUBS.find(
        item =>
          item.id ===
          typeInfo.pickupHub
      );

    return (
      `Pickup at ${hub?.name || typeInfo.pickupHub}` +
      (
        typeInfo.timeSlot
          ? `, ${typeInfo.timeSlot}`
          : ''
      ) +
      '.'
    );
  }

  if (
    typeInfo.orderType ===
    'meetup'
  ) {
    return (
      `Meet-up at ${typeInfo.meetupLocation}` +
      (
        typeInfo.timeSlot
          ? `, ${typeInfo.timeSlot}`
          : ''
      ) +
      '.'
    );
  }

  return (
    'Courier delivery to your saved address.'
  );
}


/* ============================================================
   CART CHECKOUT
   ============================================================ */

router.post(
  '/',
  customerOnly,
  async (
    req,
    res,
    next
  ) => {
    const reserved =
      [];

    try {
      const settings =
        await Settings.get();

      const user =
        await User.findById(
          req.userId
        );

      if (!user) {
        return res
          .status(401)
          .json({
            error:
              'Account no longer exists',
          });
      }

      const cart =
        await Cart
          .findOne({
            user:
              req.userId,
          })
          .populate(
            'items.product'
          );

      if (
        !cart ||
        !cart.items.length
      ) {
        return res
          .status(400)
          .json({
            error:
              'Your cart is empty',
          });
      }

      const typeInfo =
        resolveOrderType(
          req.body
        );

      if (
        typeInfo.error
      ) {
        return res
          .status(400)
          .json({
            error:
              typeInfo.error,
          });
      }

      let delivery;

      if (
        typeInfo.orderType ===
        'delivery'
      ) {
        delivery =
          resolveDelivery(
            user,
            req.body
          );

        if (
          !delivery
            ?.address
        ) {
          return res
            .status(400)
            .json({
              error:
                'A delivery address is required',
            });
        }
      } else {
        delivery = {
          address:
            typeInfo.address,

          phone:
            String(
              req.body.phone ||
              user.profile
                ?.phone ||
              ''
            ).trim(),
        };
      }

      const window =
        resolveWindow(
          req.body,
          settings
        );

      if (
        window.error
      ) {
        return res
          .status(400)
          .json({
            error:
              window.error,
          });
      }

      const {
        startDate,
        endDate,
        days,
      } =
        window;

      const live =
        cart.items.filter(
          line =>
            line.product &&
            line.product.active
        );

      if (
        !live.length
      ) {
        return res
          .status(409)
          .json({
            error:
              'Every item in your cart is no longer available',
          });
      }

      const items =
        [];

      for (
        const line of
        live
      ) {
        const product =
          line.product;

        const updated =
          await Product.findOneAndUpdate(
            {
              _id:
                product._id,

              stock: {
                $gte:
                  line.qty,
              },
            },
            {
              $inc: {
                stock:
                  -line.qty,
              },
            },
            {
              returnDocument:
                'after',
            }
          );

        if (!updated) {
          await Promise.all(
            reserved.map(
              row =>
                Product.updateOne(
                  {
                    _id:
                      row.product,
                  },
                  {
                    $inc: {
                      stock:
                        row.qty,
                    },
                  }
                )
            )
          );

          return res
            .status(409)
            .json({
              error:
                `${product.name} no longer has ${line.qty} unit${line.qty === 1 ? '' : 's'} available`,
            });
        }

        reserved.push({
          product:
            product._id,

          qty:
            line.qty,

          before:
            updated.stock +
            line.qty,

          after:
            updated,
        });

        items.push({
          product:
            product._id,

          name:
            product.name,

          cat:
            product.cat,

          image:
            product.image ||
            product.cardImage ||
            product.images?.[0] ||
            '',

          plan:
            line.plan,

          qty:
            line.qty,

          rate:
            bestValue(
              product,
              days
            ),

          deposit:
            rentalDepositFor(
              product,
              line.plan
            ),
        });
      }


      const rent =
        items.reduce(
          (
            total,
            item
          ) =>
            total +
            item.rate *
              item.qty,
          0
        );


      const deposit =
        items.reduce(
          (
            total,
            item
          ) =>
            total +
            item.deposit *
              item.qty,
          0
        );


      const deliveryFee =
        orderTypeFeeFor(
          typeInfo.orderType,
          rent,
          settings
        );


      const wantsProtection =
        Boolean(
          req.body.protection
        );


      const protectionFee =
        wantsProtection
          ? protectionFeeFor(
              rent,
              settings.protectionFeePct
            )
          : 0;


      const order =
        await Order.create({
          user:
            user._id,

          userEmail:
            user.email,

          userName:
            user.name,

          items,

          rent,

          deposit,

          delivery:
            deliveryFee,

          protection:
            wantsProtection,

          protectionFee,

          total:
            rent +
            deposit +
            deliveryFee +
            protectionFee,

          orderType:
            typeInfo.orderType,

          pickupHub:
            typeInfo.pickupHub ||
            '',

          meetupLocation:
            typeInfo.meetupLocation ||
            '',

          timeSlot:
            typeInfo.timeSlot ||
            '',

          address:
            delivery.address,

          phone:
            delivery.phone,

          startDate,

          endDate,

          days,

          status:
            'pending',

          statusHistory: [
            {
              status:
                'pending',

              at:
                new Date(),
            },
          ],
        });


      cart.items =
        [];

      await cart.save();


      await notify(
        user._id,
        {
          type:
            'order',

          title:
            `Booking #${String(order.id).slice(-6).toUpperCase()} placed`,

          message:
            `${items.length} device${items.length === 1 ? '' : 's'} held for ${startDate} → ${endDate}. Complete payment to confirm.`,

          link:
            `/order.html?id=${order.id}`,
        }
      );


      await audit(
        req,
        'order.orderType',
        {
          targetType:
            'Order',

          targetId:
            order.id,

          targetLabel:
            order.invoiceNo,

          details: {
            orderType:
              typeInfo.orderType,

            pickupHub:
              typeInfo.pickupHub,

            meetupLocation:
              typeInfo.meetupLocation,

            timeSlot:
              typeInfo.timeSlot,
          },
        }
      );


      await notify(
        user._id,
        {
          type:
            'order',

          title:
            `Fulfilment: ${typeInfo.orderType} — ${order.invoiceNo}`,

          message:
            orderTypeSummary(
              typeInfo
            ),

          link:
            `/order.html?id=${order.id}`,
        }
      );


      await Promise.all(
        reserved.map(
          row =>
            alertLowStock(
              row.after,
              row.before
            )
        )
      );


      res
        .status(201)
        .json(order);
    } catch (err) {
      await Promise.all(
        reserved.map(
          row =>
            Product.updateOne(
              {
                _id:
                  row.product,
              },
              {
                $inc: {
                  stock:
                    row.qty,
                },
              }
            )
        )
      ).catch(
        () => {}
      );

      next(err);
    }
  }
);


/* ============================================================
   DIRECT / ORDER NOW
   ============================================================ */

router.post(
  '/direct',
  customerOnly,
  async (
    req,
    res,
    next
  ) => {
    let reserved =
      null;

    try {
      const settings =
        await Settings.get();

      const user =
        await User.findById(
          req.userId
        );

      if (!user) {
        return res
          .status(401)
          .json({
            error:
              'Account no longer exists',
          });
      }

      const {
        productId,
      } =
        req.body;

      if (
        !isValidId(
          productId
        )
      ) {
        return res
          .status(400)
          .json({
            error:
              'Invalid product id',
          });
      }

      const plan =
        PLANS.includes(
          req.body.plan
        )
          ? req.body.plan
          : 'Weekly';

      const qty =
        Math.round(
          Number(
            req.body.qty ??
            1
          )
        );

      if (
        !Number.isFinite(
          qty
        ) ||
        qty <
          1
      ) {
        return res
          .status(400)
          .json({
            error:
              'qty must be 1 or more',
          });
      }

      const typeInfo =
        resolveOrderType(
          req.body
        );

      if (
        typeInfo.error
      ) {
        return res
          .status(400)
          .json({
            error:
              typeInfo.error,
          });
      }

      let delivery;

      if (
        typeInfo.orderType ===
        'delivery'
      ) {
        delivery =
          resolveDelivery(
            user,
            req.body
          );

        if (
          !delivery
            ?.address
        ) {
          return res
            .status(400)
            .json({
              error:
                'A delivery address is required',
            });
        }
      } else {
        delivery = {
          address:
            typeInfo.address,

          phone:
            String(
              req.body.phone ||
              user.profile
                ?.phone ||
              ''
            ).trim(),
        };
      }

      const window =
        resolveWindow(
          req.body,
          settings
        );

      if (
        window.error
      ) {
        return res
          .status(400)
          .json({
            error:
              window.error,
          });
      }

      const {
        startDate,
        endDate,
        days,
      } =
        window;


      const product =
        await Product.findById(
          productId
        );

      if (
        !product ||
        !product.active
      ) {
        return res
          .status(404)
          .json({
            error:
              'Product not found',
          });
      }


      const updated =
        await Product.findOneAndUpdate(
          {
            _id:
              product._id,

            stock: {
              $gte:
                qty,
            },
          },
          {
            $inc: {
              stock:
                -qty,
            },
          },
          {
            returnDocument:
              'after',
          }
        );


      if (!updated) {
        return res
          .status(409)
          .json({
            error:
              `${product.name} no longer has ${qty} unit${qty === 1 ? '' : 's'} available`,
          });
      }


      reserved = {
        product:
          product._id,

        qty,
      };


      const rate =
        bestValue(
          product,
          days
        );


      const rent =
        rate *
        qty;


      const unitDeposit =
        rentalDepositFor(
          product,
          plan
        );


      const deposit =
        unitDeposit *
        qty;


      const deliveryFee =
        orderTypeFeeFor(
          typeInfo.orderType,
          rent,
          settings
        );


      const wantsProtection =
        Boolean(
          req.body.protection
        );


      const protectionFee =
        wantsProtection
          ? protectionFeeFor(
              rent,
              settings.protectionFeePct
            )
          : 0;


      const order =
        await Order.create({
          user:
            user._id,

          userEmail:
            user.email,

          userName:
            user.name,

          items: [
            {
              product:
                product._id,

              name:
                product.name,

              cat:
                product.cat,

              image:
                product.image ||
                product.cardImage ||
                product.images?.[0] ||
                '',

              plan,

              qty,

              rate,

              deposit:
                unitDeposit,
            },
          ],

          rent,

          deposit,

          delivery:
            deliveryFee,

          protection:
            wantsProtection,

          protectionFee,

          total:
            rent +
            deposit +
            deliveryFee +
            protectionFee,

          orderType:
            typeInfo.orderType,

          pickupHub:
            typeInfo.pickupHub ||
            '',

          meetupLocation:
            typeInfo.meetupLocation ||
            '',

          timeSlot:
            typeInfo.timeSlot ||
            '',

          address:
            delivery.address,

          phone:
            delivery.phone,

          startDate,

          endDate,

          days,

          status:
            'pending',

          statusHistory: [
            {
              status:
                'pending',

              at:
                new Date(),
            },
          ],
        });


      await notify(
        user._id,
        {
          type:
            'order',

          title:
            `Booking #${String(order.id).slice(-6).toUpperCase()} placed`,

          message:
            `${product.name} held for ${startDate} → ${endDate}. Complete payment to confirm.`,

          link:
            `/order.html?id=${order.id}`,
        }
      );


      await audit(
        req,
        'order.orderType',
        {
          targetType:
            'Order',

          targetId:
            order.id,

          targetLabel:
            order.invoiceNo,

          details: {
            orderType:
              typeInfo.orderType,

            pickupHub:
              typeInfo.pickupHub,

            meetupLocation:
              typeInfo.meetupLocation,

            timeSlot:
              typeInfo.timeSlot,
          },
        }
      );


      await notify(
        user._id,
        {
          type:
            'order',

          title:
            `Fulfilment: ${typeInfo.orderType} — ${order.invoiceNo}`,

          message:
            orderTypeSummary(
              typeInfo
            ),

          link:
            `/order.html?id=${order.id}`,
        }
      );


      await alertLowStock(
        updated,
        updated.stock +
        qty
      );


      res
        .status(201)
        .json(order);
    } catch (err) {
      if (reserved) {
        await Product.updateOne(
          {
            _id:
              reserved.product,
          },
          {
            $inc: {
              stock:
                reserved.qty,
            },
          }
        ).catch(
          () => {}
        );
      }

      next(err);
    }
  }
);


/* ============================================================
   AVAILABILITY
   ============================================================ */

router.get(
  '/availability/:productId',
  async (
    req,
    res,
    next
  ) => {
    try {
      if (
        !isValidId(
          req.params
            .productId
        )
      ) {
        return res
          .status(400)
          .json({
            error:
              'Invalid product id',
          });
      }

      const product =
        await Product.findById(
          req.params
            .productId
        ).select(
          'name stock active'
        );

      if (!product) {
        return res
          .status(404)
          .json({
            error:
              'Product not found',
          });
      }

      const openOrders =
        await Order.find({
          'items.product':
            product._id,

          status: {
            $in:
              OPEN_STATUSES,
          },

          endDate: {
            $gte:
              isoDate(),
          },
        }).select(
          'items startDate endDate'
        );


      const windows =
        openOrders
          .map(
            order => ({
              startDate:
                order.startDate,

              endDate:
                order.endDate,

              qty:
                order.items
                  .filter(
                    item =>
                      String(
                        item.product
                      ) ===
                      String(
                        product._id
                      )
                  )
                  .reduce(
                    (
                      total,
                      item
                    ) =>
                      total +
                      item.qty,
                    0
                  ),
            })
          )
          .filter(
            window =>
              window.qty >
              0
          );


      res.json({
        productId:
          product.id,

        stockNow:
          product.stock,

        windows,
      });
    } catch (err) {
      next(err);
    }
  }
);


/* ============================================================
   READS
   ============================================================ */

router.get(
  '/mine',
  async (
    req,
    res,
    next
  ) => {
    try {
      const orders =
        await progressOrders(
          await Order.find({
            user:
              req.userId,
          }).sort({
            createdAt:
              -1,
          })
        );

      res.json({
        orders,
        count:
          orders.length,
      });
    } catch (err) {
      next(err);
    }
  }
);


/**
 * Admin order list.
 */
router.get(
  '/',
  auth,
  admin,
  async (
    req,
    res,
    next
  ) => {
    try {
      const filter =
        {};

      if (
        req.query.status &&
        ORDER_STATUSES.includes(
          req.query.status
        )
      ) {
        filter.status =
          req.query.status;
      }

      if (
        req.query.q
      ) {
        const safe =
          String(
            req.query.q
          ).replace(
            /[.*+?^${}()|[\]\\]/g,
            '\\$&'
          );

        const regex =
          new RegExp(
            safe,
            'i'
          );

        filter.$or = [
          {
            userEmail:
              regex,
          },

          {
            userName:
              regex,
          },

          {
            'items.name':
              regex,
          },
        ];
      }

      const orders =
        await progressOrders(
          await Order.find(
            filter
          ).sort({
            createdAt:
              -1,
          })
        );

      res.json({
        orders,
        count:
          orders.length,
      });
    } catch (err) {
      next(err);
    }
  }
);


/* ============================================================
   ADMIN REPORTS
   ============================================================ */

router.get(
  '/reports/summary',
  auth,
  admin,
  async (
    req,
    res,
    next
  ) => {
    try {
      const orders =
        await Order.find({});

      const billable =
        orders.filter(
          order =>
            order.status !==
            'cancelled'
        );

      const revenueOf =
        order =>
          order.rent +
          order.delivery +
          (
            order.protectionFee ||
            0
          );


      const revenue =
        billable.reduce(
          (
            total,
            order
          ) =>
            total +
            revenueOf(order),
          0
        );


      const depositsHeld =
        orders
          .filter(
            order =>
              !CLOSED_STATUSES.includes(
                order.status
              )
          )
          .reduce(
            (
              total,
              order
            ) =>
              total +
              order.deposit,
            0
          );


      const depositsRefunded =
        orders.reduce(
          (
            total,
            order
          ) =>
            total +
            (
              order.refund
                ?.amount ||
              0
            ),
          0
        );


      const depositsWithheld =
        orders.reduce(
          (
            total,
            order
          ) =>
            total +
            (
              order.refund
                ?.deducted ||
              0
            ),
          0
        );


      const protectionRevenue =
        billable.reduce(
          (
            total,
            order
          ) =>
            total +
            (
              order.protectionFee ||
              0
            ),
          0
        );


      const activeRentals =
        orders.filter(
          order =>
            [
              'delivered',
              'active',
            ].includes(
              order.status
            )
        ).length;


      const byDevice =
        {};

      const byCategory =
        {};

      billable.forEach(
        order =>
          order.items.forEach(
            item => {
              const value =
                item.rate *
                item.qty;

              byDevice[
                item.name
              ] =
                (
                  byDevice[
                    item.name
                  ] ||
                  0
                ) +
                value;

              byCategory[
                item.cat
              ] =
                (
                  byCategory[
                    item.cat
                  ] ||
                  0
                ) +
                value;
            }
          )
      );


      const byStatus =
        {};

      orders.forEach(
        order => {
          byStatus[
            order.status
          ] =
            (
              byStatus[
                order.status
              ] ||
              0
            ) +
            1;
        }
      );


      const byCustomer =
        {};

      billable.forEach(
        order => {
          const key =
            order.userName ||
            order.userEmail;

          byCustomer[
            key
          ] =
            (
              byCustomer[
                key
              ] ||
              0
            ) +
            revenueOf(
              order
            );
        }
      );


      const byWeek =
        {};

      const byMonth =
        {};

      const byYear =
        {};


      billable.forEach(
        order => {
          const when =
            order.paidAt ||
            order.createdAt;

          if (!when) {
            return;
          }

          const date =
            new Date(
              when
            );

          const value =
            revenueOf(
              order
            );

          const month =
            `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;

          const year =
            String(
              date.getUTCFullYear()
            );

          const week =
            isoWeekKey(
              date
            );

          byWeek[
            week
          ] =
            (
              byWeek[
                week
              ] ||
              0
            ) +
            value;

          byMonth[
            month
          ] =
            (
              byMonth[
                month
              ] ||
              0
            ) +
            value;

          byYear[
            year
          ] =
            (
              byYear[
                year
              ] ||
              0
            ) +
            value;
        }
      );


      const settings =
        await Settings.get();

      const lowStockAt =
        Number(
          settings.lowStockThreshold
        ) ||
        2;


      const products =
        await Product.find({
          active:
            true,
        }).select(
          'name grade stock'
        );


      const unitsOnShelf =
        products.reduce(
          (
            total,
            product
          ) =>
            total +
            product.stock,
          0
        );


      const unitsRentedOut =
        orders
          .filter(
            order =>
              OPEN_STATUSES.includes(
                order.status
              )
          )
          .reduce(
            (
              total,
              order
            ) =>
              total +
              order.items.reduce(
                (
                  count,
                  item
                ) =>
                  count +
                  item.qty,
                0
              ),
            0
          );


      const customers =
        await User.countDocuments(
          {}
        );


      const paidOrders =
        billable.filter(
          order =>
            order.paid
        ).length;


      res.json({
        revenue,

        protectionRevenue,

        depositsHeld,

        depositsRefunded,

        depositsWithheld,

        orderCount:
          orders.length,

        paidOrders,

        avgOrderValue:
          billable.length
            ? Math.round(
                revenue /
                billable.length
              )
            : 0,

        activeRentals,

        customers,

        unitsOnShelf,

        unitsRentedOut,

        lowStockAt,

        lowStock:
          products.filter(
            product =>
              product.stock >
                0 &&
              product.stock <=
                lowStockAt
          ).length,

        outOfStock:
          products.filter(
            product =>
              product.stock ===
              0
          ).length,

        byDevice,

        byCategory,

        byStatus,

        byCustomer,

        byWeek,

        byMonth,

        byYear,

        byGrade: {
          'Like New':
            products.filter(
              product =>
                product.grade ===
                'Like New'
            ).length,

          Good:
            products.filter(
              product =>
                product.grade ===
                'Good'
            ).length,

          Fair:
            products.filter(
              product =>
                product.grade ===
                'Fair'
            ).length,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);


/* ============================================================
   INSPECTION QUEUE
   ============================================================ */

router.get(
  '/inspection/queue',
  staff,
  async (
    _req,
    res,
    next
  ) => {
    try {
      const orders =
        await Order.find({
          status: {
            $in: [
              'returned',
              'inspection',
            ],
          },
        }).sort({
          updatedAt:
            1,
        });

      res.json(
        orders
      );
    } catch (err) {
      next(err);
    }
  }
);


/* ============================================================
   GET SINGLE ORDER
   ============================================================ */

router.get(
  '/:id',
  async (
    req,
    res,
    next
  ) => {
    try {
      if (
        !isValidId(
          req.params.id
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
          req.params.id
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
        String(
          order.user
        ) ===
        String(
          req.userId
        );

      if (
        !owns &&
        ![
          'admin',
          'technician',
        ].includes(
          me?.role
        )
      ) {
        return res
          .status(403)
          .json({
            error:
              'Not your order',
          });
      }

      await progressOrder(
        order
      );

      res.json(
        await decorate(
          order,
          await Settings.get()
        )
      );
    } catch (err) {
      next(err);
    }
  }
);


/* ============================================================
   LEGACY LOCAL PAYMENT
   ============================================================ */

router.post(
  '/:id/pay',
  async (
    req,
    res,
    next
  ) => {
    try {
      if (
        !isValidId(
          req.params.id
        )
      ) {
        return res
          .status(400)
          .json({
            error:
              'Invalid order id',
          });
      }

      if (
        process.env
          .PAYMONGO_SECRET_KEY
      ) {
        return res
          .status(410)
          .json({
            error:
              'Use the payment checkout instead (POST /api/payments/intent)',
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
        allowed.includes(
          req.body.method
        )
          ? req.body.method
          : allowed[0];


      const order =
        await Order.findById(
          req.params.id
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
        String(
          order.user
        ) !==
        String(
          req.userId
        )
      ) {
        return res
          .status(403)
          .json({
            error:
              'Not your order',
          });
      }


      if (
        order.paid ||
        order.status !==
          'pending'
      ) {
        return res
          .status(409)
          .json({
            error:
              'This booking has already been paid',
          });
      }


      order.paid =
        true;

      order.paidAt =
        new Date();


      order.payment = {
        gateway:
          'manual',

        method,

        status:
          'paid',

        paidAt:
          order.paidAt,

        referenceNo:
          `PAY-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
      };


      order.status =
        'payment-confirmed';


      order.statusHistory.push({
        status:
          'payment-confirmed',

        at:
          new Date(),
      });


      await order.save();


      await notify(
        order.user,
        {
          type:
            'payment',

          title:
            `Payment confirmed — ${order.invoiceNo}`,

          message:
            `${settings.currencySymbol}${order.total.toLocaleString('en-PH')} received via ${method}. We are preparing your device.`,

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


      await dispatchBestEffort(
        order,
        {},
        'legacy simulated payment'
      );


      res.json(order);
    } catch (err) {
      next(err);
    }
  }
);


/* ============================================================
   CONFIRM RECEIPT
   ============================================================ */

router.post(
  '/:id/confirm-receipt',
  async (
    req,
    res,
    next
  ) => {
    try {
      if (
        !isValidId(
          req.params.id
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
          req.params.id
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
        String(
          order.user
        ) !==
        String(
          req.userId
        )
      ) {
        return res
          .status(403)
          .json({
            error:
              'Not your order',
          });
      }

      if (
        ![
          'delivered',
          'ready-for-pickup',
        ].includes(
          order.status
        )
      ) {
        return res
          .status(409)
          .json({
            error:
              `Receipt cannot be confirmed while the order is "${order.status}"`,
          });
      }


      order.receivedAt =
        new Date();


      setStatus(
        order,
        'received',
        'Customer confirmed receipt',
        order.userEmail
      );


      setStatus(
        order,
        'active',
        'Rental clock started',
        ''
      );


      await order.save();


      await audit(
        req,
        'order.confirmReceipt',
        {
          targetType:
            'Order',

          targetId:
            order.id,

          targetLabel:
            order.invoiceNo,

          details: {
            receivedAt:
              order.receivedAt,
          },
        }
      );


      await notifyOrderStatus(
        order,
        'received'
      );


      const settings =
        await Settings.get();


      res.json(
        await decorate(
          order,
          settings
        )
      );
    } catch (err) {
      next(err);
    }
  }
);


/* ============================================================
   CUSTOMER DISPUTE
   ============================================================ */

router.post(
  '/:id/report-issue',
  async (
    req,
    res,
    next
  ) => {
    try {
      if (
        !isValidId(
          req.params.id
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
          req.params.id
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
        String(
          order.user
        ) !==
        String(
          req.userId
        )
      ) {
        return res
          .status(403)
          .json({
            error:
              'Not your order',
          });
      }


      if (
        ![
          'delivered',
          'ready-for-pickup',
        ].includes(
          order.status
        )
      ) {
        return res
          .status(409)
          .json({
            error:
              `A problem cannot be reported while the order is "${order.status}"`,
          });
      }


      const reason =
        String(
          req.body.reason ||
          ''
        )
          .trim()
          .slice(
            0,
            200
          );


      if (!reason) {
        return res
          .status(400)
          .json({
            error:
              'Tell us what went wrong',
          });
      }


      const details =
        String(
          req.body.details ||
          ''
        )
          .trim()
          .slice(
            0,
            2000
          );


      order.dispute = {
        reason,

        details,

        photos:
          cleanPhotos(
            req.body.photos
          ),

        at:
          new Date(),
      };


      setStatus(
        order,
        'disputed',
        reason,
        order.userEmail
      );


      await order.save();


      await audit(
        req,
        'order.dispute',
        {
          targetType:
            'Order',

          targetId:
            order.id,

          targetLabel:
            order.invoiceNo,

          details: {
            reason,

            customer:
              order.userEmail,
          },
        }
      );


      await notifyOrderStatus(
        order,
        'disputed'
      );


      await notifyAdmins({
        type:
          'status',

        title:
          `Delivery disputed: ${order.invoiceNo}`,

        message:
          `${order.userName || order.userEmail}: ${reason}`,

        link:
          '/admin.html#orders',
      });


      res.json(
        await decorate(
          order,
          await Settings.get()
        )
      );
    } catch (err) {
      next(err);
    }
  }
);


/* ============================================================
   RETURN REQUEST
   ============================================================ */

router.post(
  '/:id/return',
  async (
    req,
    res,
    next
  ) => {
    try {
      if (
        !isValidId(
          req.params.id
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
          req.params.id
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
        String(
          order.user
        ) !==
        String(
          req.userId
        )
      ) {
        return res
          .status(403)
          .json({
            error:
              'Not your order',
          });
      }


      if (
        !RETURN_REQUEST_STATUSES.includes(
          order.status
        )
      ) {
        return res
          .status(409)
          .json({
            error:
              `Cannot request a return while the order is "${order.status}"`,
          });
      }


      const note =
        String(
          req.body.note ||
          ''
        )
          .trim()
          .slice(
            0,
            1000
          );


      const date =
        String(
          req.body.date ||
          ''
        ).trim();


      const slot =
        String(
          req.body.slot ||
          ''
        )
          .trim()
          .slice(
            0,
            80
          );


      if (
        !isValidDateStr(
          date
        )
      ) {
        return res
          .status(400)
          .json({
            error:
              'Pick a return date',
          });
      }


      if (
        date <
        isoDate()
      ) {
        return res
          .status(400)
          .json({
            error:
              'The return date cannot be in the past',
          });
      }


      if (!slot) {
        return res
          .status(400)
          .json({
            error:
              'Pick a return time slot',
          });
      }


      const viaHub =
        order.orderType ===
        'pickup';


      let hub =
        '';


      if (viaHub) {
        hub =
          PICKUP_HUBS.some(
            item =>
              item.id ===
              req.body.hub
          )
            ? req.body.hub
            : (
                order.pickupHub ||
                PICKUP_HUBS[0].id
              );
      }


      let delivery =
        null;


      if (!viaHub) {
        delivery =
          order.returnDeliveryJob
            ? await Delivery.findById(
                order.returnDeliveryJob
              )
            : null;


        if (!delivery) {
          delivery =
            new Delivery({
              order:
                order._id,

              type:
                'return',

              status:
                'unassigned',

              scheduledAt:
                new Date(
                  `${date}T09:00:00+08:00`
                ),

              checkpoints: [
                {
                  status:
                    'unassigned',

                  at:
                    new Date(),

                  note:
                    `Return requested for ${date}, ${slot}`,
                },
              ],
            });


          await delivery.save();
        }


        order.returnDeliveryJob =
          delivery._id;
      }


      order.returnPlan = {
        method:
          viaHub
            ? 'hub'
            : 'rider',

        date,

        slot,

        hub,
      };


      if (note) {
        order.returnNote =
          note;
      }


      const detail =
        viaHub
          ? `Hub drop-off ${date}, ${slot} (${PICKUP_HUBS.find(h => h.id === hub)?.name || hub})`
          : `Return pickup requested for ${date}, ${slot}`;


      setStatus(
        order,
        viaHub
          ? 'return-scheduled'
          : 'return-requested',
        detail,
        order.userEmail
      );


      await order.save();


      let dispatch =
        null;


      if (!viaHub) {
        dispatch =
          await dispatchBestEffort(
            order,
            {
              leg:
                'return',
            },
            'return request'
          );


        if (
          dispatch.assigned &&
          order.status ===
            'return-requested'
        ) {
          setStatus(
            order,
            'return-scheduled',
            `Return rider automatically assigned${dispatch.rider?.name ? `: ${dispatch.rider.name}` : ''}`,
            'system'
          );


          await order.save();


          await notifyOrderStatus(
            order,
            'return-scheduled'
          );
        }
      }


      await audit(
        req,
        'order.returnRequest',
        {
          targetType:
            'Order',

          targetId:
            order.id,

          targetLabel:
            order.invoiceNo,

          details: {
            date,

            slot,

            method:
              order.returnPlan
                .method,

            customer:
              order.userEmail,

            autoDispatch:
              dispatch,
          },
        }
      );


      await notify(
        order.user,
        {
          type:
            'return',

          title:
            `${viaHub || dispatch?.assigned ? 'Return scheduled' : 'Return requested'} — ${order.invoiceNo}`,

          message:
            viaHub
              ? `Drop the device at ${PICKUP_HUBS.find(h => h.id === hub)?.name || 'your hub'} on ${date}, ${slot}. Your deposit is settled after inspection.`
              : dispatch?.assigned
                ? `${dispatch.rider?.name || 'Your rider'} will collect the device on ${date}, ${slot}. Your deposit is settled after inspection.`
                : `Your return is recorded for ${date}, ${slot}. No rider is currently available; we will assign one as soon as possible.`,

          link:
            `/order.html?id=${order.id}`,
        }
      );


      if (viaHub) {
        await notifyAdmins({
          type:
            'return',

          title:
            `Hub return scheduled: ${order.invoiceNo}`,

          message:
            `${order.userName || order.userEmail} · ${date}, ${slot}`,

          link:
            '/admin.html#orders',
        });
      }


      res.json(
        await decorate(
          order,
          await Settings.get()
        )
      );
    } catch (err) {
      next(err);
    }
  }
);


/* ============================================================
   EXTENSION
   ============================================================ */

router.post(
  '/:id/extend',
  async (
    req,
    res,
    next
  ) => {
    try {
      if (
        !isValidId(
          req.params.id
        )
      ) {
        return res
          .status(400)
          .json({
            error:
              'Invalid order id',
          });
      }


      const settings =
        await Settings.get();


      const order =
        await Order.findById(
          req.params.id
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
        String(
          order.user
        ) !==
        String(
          req.userId
        )
      ) {
        return res
          .status(403)
          .json({
            error:
              'Not your order',
          });
      }


      if (
        !RETURNABLE_STATUSES.includes(
          order.status
        )
      ) {
        return res
          .status(409)
          .json({
            error:
              'Only an active rental can be extended',
          });
      }


      const days =
        Math.max(
          ...order.items.map(
            item =>
              PLAN_DAYS[
                item.plan
              ] ||
              7
          )
        );


      const newTotalDays =
        daysBetween(
          order.startDate,
          addDays(
            order.endDate,
            days
          )
        );


      const max =
        Number(
          settings.maxRentalDays
        ) ||
        365;


      if (
        newTotalDays >
        max
      ) {
        return res
          .status(409)
          .json({
            error:
              `Extending would exceed the ${max}-day maximum rental. Please return and re-book.`,
          });
      }


      order.endDate =
        addDays(
          order.endDate,
          days
        );


      order.days =
        daysBetween(
          order.startDate,
          order.endDate
        );


      await order.save();


      await notify(
        order.user,
        {
          type:
            'order',

          title:
            `Rental extended — ${order.invoiceNo}`,

          message:
            `Your return date moved to ${order.endDate}.`,

          link:
            `/order.html?id=${order.id}`,
        }
      );


      res.json({
        order,
        days,
      });
    } catch (err) {
      next(err);
    }
  }
);


/* ============================================================
   CUSTOMER CANCELLATION
   ============================================================ */

router.post(
  '/:id/cancel',
  async (
    req,
    res,
    next
  ) => {
    try {
      if (
        !isValidId(
          req.params.id
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
          req.params.id
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
        String(
          order.user
        ) !==
        String(
          req.userId
        )
      ) {
        return res
          .status(403)
          .json({
            error:
              'Not your order',
          });
      }


      if (
        order.status !==
        'pending'
      ) {
        return res
          .status(409)
          .json({
            error:
              'Only a pending booking can be cancelled',
          });
      }


      await releaseStock(
        order
      );


      order.status =
        'cancelled';


      order.statusHistory.push({
        status:
          'cancelled',

        at:
          new Date(),
      });


      await order.save();


      await notify(
        order.user,
        {
          type:
            'order',

          title:
            `Booking cancelled — ${order.invoiceNo}`,

          message:
            'The units have been released back to the catalog. Nothing was charged.',

          link:
            '/products.html',
        }
      );


      res.json(order);
    } catch (err) {
      next(err);
    }
  }
);


/* ============================================================
   ADMIN STATUS EXCEPTION
   ============================================================ */

/**
 * Marketplace-style responsibility split:
 *
 * PAYMENT
 * payments.js
 *
 * PREPARING
 * orderProgressor.js
 *
 * DELIVERY
 * rider only
 *
 * INSPECTION
 * technician/staff inspection route
 *
 * REFUND
 * dedicated settlement route
 *
 * Therefore admin has NO generic fulfilment controls anymore.
 *
 * Only emergency cancellation is kept.
 */
const ADMIN_MANUAL_STATUSES = [
  'cancelled',
];


router.patch(
  '/:id/status',
  auth,
  admin,
  async (
    req,
    res,
    next
  ) => {
    try {
      if (
        !isValidId(
          req.params.id
        )
      ) {
        return res
          .status(400)
          .json({
            error:
              'Invalid order id',
          });
      }


      const {
        status,
      } =
        req.body;


      if (
        !ORDER_STATUSES.includes(
          status
        )
      ) {
        return res
          .status(400)
          .json({
            error:
              `status must be one of: ${ORDER_STATUSES.join(', ')}`,
          });
      }


      if (
        !ADMIN_MANUAL_STATUSES.includes(
          status
        )
      ) {
        return res
          .status(403)
          .json({
            error:
              'Admin does not manually control fulfilment statuses. Payment, dispatch, rider delivery and inspection each have their own workflow.',
          });
      }


      const order =
        await Order.findById(
          req.params.id
        );


      if (!order) {
        return res
          .status(404)
          .json({
            error:
              'Order not found',
          });
      }


      const from =
        order.status;


      if (
        from ===
        status
      ) {
        return res.json(
          order
        );
      }


      if (
        [
          'completed',
          'refunded',
          'cancelled',
        ].includes(
          from
        )
      ) {
        return res
          .status(409)
          .json({
            error:
              `A ${from} order cannot be changed here`,
          });
      }


      const note =
        String(
          req.body.note ||
          ''
        )
          .trim()
          .slice(
            0,
            1000
          );


      await releaseStock(
        order
      );


      order.status =
        'cancelled';


      order.statusHistory.push({
        status:
          'cancelled',

        at:
          new Date(),

        note:
          note ||
          'Cancelled by admin as an exception',

        byEmail:
          req.adminUser
            ?.email ||
          '',
      });


      await order.save();


      await audit(
        req,
        'order.status',
        {
          targetType:
            'Order',

          targetId:
            order.id,

          targetLabel:
            order.invoiceNo,

          details: {
            from,

            to:
              'cancelled',

            note,

            customer:
              order.userEmail,

            exceptionOnly:
              true,
          },
        }
      );


      await notifyOrderStatus(
        order,
        'cancelled'
      );


      res.json(order);
    } catch (err) {
      next(err);
    }
  }
);


/* ============================================================
   DEPOSIT REFUND
   ============================================================ */

router.post(
  '/:id/refund',
  auth,
  admin,
  async (
    req,
    res,
    next
  ) => {
    try {
      if (
        !isValidId(
          req.params.id
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
          req.params.id
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
        order.depositReturned ||
        order.refund
      ) {
        return res
          .status(409)
          .json({
            error:
              'This deposit has already been settled',
          });
      }


      if (
        order.status ===
        'cancelled'
      ) {
        return res
          .status(409)
          .json({
            error:
              'A cancelled booking never took a deposit',
          });
      }


      if (!order.paid) {
        return res
          .status(409)
          .json({
            error:
              'This booking was never paid, so there is no deposit to refund',
          });
      }


      const deducted =
        Math.max(
          0,
          Math.round(
            Number(
              req.body.deducted
            ) ||
            0
          )
        );


      if (
        deducted >
        order.deposit
      ) {
        return res
          .status(400)
          .json({
            error:
              `Deduction cannot exceed the ${order.deposit} deposit held`,
          });
      }


      const requested =
        req.body.amount ===
        undefined
          ? order.deposit -
            deducted
          : Math.round(
              Number(
                req.body.amount
              )
            );


      if (
        !Number.isFinite(
          requested
        ) ||
        requested <
          0
      ) {
        return res
          .status(400)
          .json({
            error:
              'amount must be zero or more',
          });
      }


      if (
        requested +
          deducted >
        order.deposit
      ) {
        return res
          .status(400)
          .json({
            error:
              `Refund plus deduction cannot exceed the ${order.deposit} deposit held`,
          });
      }


      const settings =
        await Settings.get();


      const note =
        String(
          req.body.note ||
          ''
        )
          .trim()
          .slice(
            0,
            1000
          );


      const method =
        PAYMENT_METHODS.includes(
          req.body.method
        )
          ? req.body.method
          : (
              order.payment
                ?.method ||
              'gcash'
            );


      await releaseStock(
        order
      );


      order.refund = {
        amount:
          requested,

        deducted,

        method,

        ref:
          `RFD-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,

        note,

        at:
          new Date(),

        byEmail:
          req.adminUser
            ?.email ||
          '',
      };


      order.depositReturned =
        true;


      order.status =
        'refunded';


      order.statusHistory.push({
        status:
          'refunded',

        at:
          new Date(),

        note:
          note ||
          `Refunded ${requested}${deducted ? `, withheld ${deducted}` : ''}`,

        byEmail:
          req.adminUser
            ?.email ||
          '',
      });


      await order.save();


      await audit(
        req,
        'order.refund',
        {
          targetType:
            'Order',

          targetId:
            order.id,

          targetLabel:
            order.invoiceNo,

          details: {
            amount:
              requested,

            deducted,

            method,

            note,

            customer:
              order.userEmail,
          },
        }
      );


      const symbol =
        settings.currencySymbol;


      await notify(
        order.user,
        {
          type:
            'refund',

          title:
            `Deposit refunded — ${order.invoiceNo}`,

          message:
            deducted
              ? `${symbol}${requested.toLocaleString('en-PH')} refunded. ${symbol}${deducted.toLocaleString('en-PH')} was withheld${note ? `: ${note}` : '.'}`
              : `${symbol}${requested.toLocaleString('en-PH')} refunded in full. Thank you for renting with DiaLux.`,

          link:
            `/order.html?id=${order.id}`,
        }
      );


      res.json(order);
    } catch (err) {
      next(err);
    }
  }
);


/* ============================================================
   AUTOMATIC RIDER DISPATCH
   ============================================================ */

/**
 * POST /api/orders/:id/dispatch
 *
 * Admin DOES NOT choose a rider.
 *
 * This endpoint only retries the automatic dispatcher when:
 *
 * - payment succeeded while all riders were off duty
 * - rider account was configured after payment
 * - a temporary dispatch error happened
 */
router.post(
  '/:id/dispatch',
  auth,
  admin,
  async (
    req,
    res,
    next
  ) => {
    try {
      if (
        !isValidId(
          req.params.id
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
          req.params.id
        );


      if (!order) {
        return res
          .status(404)
          .json({
            error:
              'Order not found',
          });
      }


      const leg =
        req.body.leg ===
        'return'
          ? 'return'
          : 'outbound';


      if (
        leg ===
        'outbound'
      ) {
        const canDispatch =
          order.payment
            ?.method ===
            'cash'
            ? [
                'approved',
                'payment-confirmed',
                'preparing',
              ].includes(
                order.status
              )
            : Boolean(
                order.paid ||
                order.payment
                  ?.status ===
                  'paid'
              );


        if (!canDispatch) {
          return res
            .status(409)
            .json({
              error:
                'This order is not ready for outbound dispatch yet',
            });
        }
      } else if (
        ![
          'return-requested',
          'return-scheduled',
        ].includes(
          order.status
        )
      ) {
        return res
          .status(409)
          .json({
            error:
              `No return is waiting for dispatch (order is "${order.status}")`,
          });
      }


      const result =
        await dispatchBestEffort(
          order,
          {
            leg,
          },
          'admin dispatch retry'
        );


      if (
        leg ===
          'return' &&
        result.assigned &&
        order.status ===
          'return-requested'
      ) {
        setStatus(
          order,
          'return-scheduled',
          `Return rider automatically assigned${result.rider?.name ? `: ${result.rider.name}` : ''}`,
          'system'
        );


        await order.save();


        await notifyOrderStatus(
          order,
          'return-scheduled'
        );
      }


      await audit(
        req,
        'order.dispatchRetry',
        {
          targetType:
            'Order',

          targetId:
            order.id,

          targetLabel:
            order.invoiceNo,

          details: {
            leg,

            assigned:
              Boolean(
                result.assigned
              ),

            hubId:
              result.hubId ||
              '',

            reason:
              result.reason ||
              '',

            riderId:
              result.rider
                ?.id ||
              '',

            riderName:
              result.rider
                ?.name ||
              '',
          },
        }
      );


      res.json({
        order:
          await decorate(
            order,
            await Settings.get()
          ),

        dispatch:
          result,
      });
    } catch (err) {
      next(err);
    }
  }
);


/**
 * OLD MANUAL ASSIGNMENT ENDPOINT
 *
 * Kept so cached frontend code receives a clear explanation instead
 * of silently failing.
 *
 * Manual assignment is disabled server-side.
 */
router.post(
  '/:id/assign-rider',
  auth,
  admin,
  async (
    _req,
    res
  ) => {
    res
      .status(410)
      .json({
        error:
          'Manual rider assignment has been retired. DiaLux now auto-assigns the nearest on-duty hub rider. Use Retry auto-dispatch if an exception needs another attempt.',
      });
  }
);


/* ============================================================
   HUB RETURN RECEIVED
   ============================================================ */

router.post(
  '/:id/hub-received',
  staff,
  async (
    req,
    res,
    next
  ) => {
    try {
      if (
        !isValidId(
          req.params.id
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
          req.params.id
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
        order.status !==
          'return-scheduled' ||
        order.returnPlan
          ?.method !==
          'hub'
      ) {
        return res
          .status(409)
          .json({
            error:
              'This order is not waiting for a hub drop-off',
          });
      }


      order.returnedAt =
        new Date();


      setStatus(
        order,
        'returned',
        'Received at the hub counter',
        req.staffUser.email
      );


      await order.save();


      await audit(
        req,
        'order.hubReceived',
        {
          targetType:
            'Order',

          targetId:
            order.id,

          targetLabel:
            order.invoiceNo,

          details: {
            customer:
              order.userEmail,
          },
        }
      );


      await notifyOrderStatus(
        order,
        'returned'
      );


      res.json(
        await decorate(
          order,
          await Settings.get()
        )
      );
    } catch (err) {
      next(err);
    }
  }
);


/* ============================================================
   INSPECTION / SETTLEMENT
   ============================================================ */

router.post(
  '/:id/inspection',
  staff,
  async (
    req,
    res,
    next
  ) => {
    try {
      if (
        !isValidId(
          req.params.id
        )
      ) {
        return res
          .status(400)
          .json({
            error:
              'Invalid order id',
          });
      }


      if (
        typeof req.body
          .passed !==
        'boolean'
      ) {
        return res
          .status(400)
          .json({
            error:
              'passed must be true or false',
          });
      }


      const passed =
        req.body.passed;


      const checklist =
        {};


      for (
        const key of
        INSPECTION_CHECKLIST
      ) {
        const value =
          req.body
            .checklist
            ?.[key];

        checklist[
          key
        ] =
          value ===
          undefined
            ? true
            : value ===
              true;
      }


      const notes =
        String(
          req.body.notes ||
          ''
        )
          .trim()
          .slice(
            0,
            2000
          );


      if (
        passed &&
        Object.values(
          checklist
        ).some(
          value =>
            !value
        )
      ) {
        return res
          .status(400)
          .json({
            error:
              'A device with a failed checklist item cannot pass inspection',
          });
      }


      if (
        !passed &&
        !notes
      ) {
        return res
          .status(400)
          .json({
            error:
              'Add a note explaining why the inspection failed',
          });
      }


      const damageCharge =
        Number(
          req.body
            .damageCharge ??
          0
        );


      if (
        !Number.isFinite(
          damageCharge
        ) ||
        damageCharge <
          0
      ) {
        return res
          .status(400)
          .json({
            error:
              'damageCharge must be zero or more',
          });
      }


      const order =
        await Order.findById(
          req.params.id
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
        ![
          'returned',
          'inspection',
        ].includes(
          order.status
        )
      ) {
        return res
          .status(409)
          .json({
            error:
              `Only a returned device can be inspected (order is "${order.status}")`,
          });
      }


      if (
        order.refund ||
        order.depositReturned
      ) {
        return res
          .status(409)
          .json({
            error:
              'This deposit has already been settled',
          });
      }


      if (
        !order.paid
      ) {
        return res
          .status(409)
          .json({
            error:
              'This booking was never paid, so there is no deposit to settle',
          });
      }


      const settings =
        await Settings.get();


      const by =
        req.staffUser.email;


      const at =
        order.returnedAt ||
        new Date();


      const settlement =
        settle(
          order,
          {
            passed,
            damageCharge,
          },
          settings,
          at
        );


      order.inspection = {
        passed,

        checklist,

        notes,

        damageCharge:
          settlement.damageCharge,

        photos:
          cleanPhotos(
            req.body.photos
          ),

        byEmail:
          by,

        at:
          new Date(),
      };


      order.inspectionNote =
        notes;


      order.returnedAt =
        order.returnedAt ||
        at;


      if (
        order.status ===
        'returned'
      ) {
        setStatus(
          order,
          'inspection',
          'Inspection started',
          by
        );
      }


      setStatus(
        order,
        passed
          ? 'inspection-passed'
          : 'inspection-failed',
        notes,
        by
      );


      const breakdown =
        [
          settlement.overduePenalty
            ? `late ${settlement.overdueDays}d ${money(settings, settlement.overduePenalty)}`
            : '',

          settlement.damageCharge
            ? `damage ${money(settings, settlement.damageCharge)}`
            : '',
        ]
          .filter(Boolean)
          .join(', ');


      setStatus(
        order,
        settlement.status,
        breakdown ||
          'Deposit returned in full',
        by
      );


      order.refund = {
        amount:
          settlement.refundAmount,

        deducted:
          settlement.deducted,

        deposit:
          settlement.deposit,

        overdueDays:
          settlement.overdueDays,

        overduePenalty:
          settlement.overduePenalty,

        damageCharge:
          settlement.damageCharge,

        shortfall:
          settlement.shortfall,

        method:
          order.payment
            ?.method ||
          'gcash',

        ref:
          `RFD-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,

        note:
          breakdown ||
          'Deposit returned in full',

        at:
          new Date(),

        byEmail:
          by,
      };


      order.depositReturned =
        true;


      await releaseStock(
        order
      );


      setStatus(
        order,
        'completed',
        `Refund ${money(settings, settlement.refundAmount)} issued`,
        by
      );


      await order.save();


      await audit(
        req,
        'order.inspection',
        {
          targetType:
            'Order',

          targetId:
            order.id,

          targetLabel:
            order.invoiceNo,

          details: {
            passed,

            checklist,

            ...settlement,

            customer:
              order.userEmail,

            role:
              req.staffRole,
          },
        }
      );


      await notifyOrderStatus(
        order,
        passed
          ? 'inspection-passed'
          : 'inspection-failed'
      );


      await notify(
        order.user,
        {
          type:
            'refund',

          title:
            `Deposit ${settlement.full ? 'refunded in full' : 'partly refunded'} — ${order.invoiceNo}`,

          message:
            settlement.full
              ? `${money(settings, settlement.refundAmount)} returned. Thank you for renting with DiaLux.`
              : `Deposit ${money(settings, settlement.deposit)}${settlement.overduePenalty ? ` − late fee ${money(settings, settlement.overduePenalty)} (${settlement.overdueDays} day${settlement.overdueDays === 1 ? '' : 's'})` : ''}${settlement.damageCharge ? ` − damage ${money(settings, settlement.damageCharge)}` : ''} = ${money(settings, settlement.refundAmount)} refunded.`,

          link:
            `/order.html?id=${order.id}`,
        }
      );


      await notifyOrderStatus(
        order,
        'completed'
      );


      res.json({
        order:
          await decorate(
            order,
            settings
          ),

        settlement,
      });
    } catch (err) {
      next(err);
    }
  }
);


module.exports = router;