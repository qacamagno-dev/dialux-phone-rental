// ============================================================
// DiaLux — rider routes
// ============================================================

const express = require('express');
const mongoose = require('mongoose');

const Delivery = require('../models/Delivery');
const Order = require('../models/Order');
const User = require('../models/User');

const auth = require('../middlewares/auth');
const admin = require('../middlewares/admin');
const rider = require('../middlewares/rider');

const {
  notify,
  notifyOrderStatus,
} = require('../services/notify');

const {
  audit,
} = require('../services/audit');

const {
  DELIVERY_STATUSES,
  PICKUP_HUBS,
} = require('../constants');

const router =
  express.Router();

const isValidId =
  id =>
    mongoose.Types.ObjectId.isValid(id);

function orderStatusFor(delivery) {
  const isReturn =
    delivery.type === 'return';

  switch (delivery.status) {
    case 'picked-up':
      return isReturn
        ? 'return-in-transit'
        : 'picked-up';

    case 'in-transit':
      return isReturn
        ? 'return-in-transit'
        : 'in-transit';

    case 'arriving':
      return isReturn
        ? 'return-in-transit'
        : 'arriving';

    case 'delivered':
      return isReturn
        ? 'returned'
        : 'delivered';

    default:
      return null;
  }
}

/* ================================================================
   GET /api/riders/me/deliveries
================================================================ */

router.get(
  '/me/deliveries',
  auth,
  rider,
  async (req, res, next) => {
    try {
      const deliveries =
        await Delivery.find({
          rider:
            req.riderUser._id,
        })
          .sort({
            scheduledAt: 1,
            createdAt: 1,
          })
          .populate(
            'order',
            'invoiceNo userName phone address orderType pickupHub meetupLocation timeSlot items total status payment'
          );

      res.json({
        deliveries,
        count:
          deliveries.length,
      });
    } catch (err) {
      next(err);
    }
  }
);

/* ================================================================
   PATCH /api/riders/deliveries/:id/status
================================================================ */

router.patch(
  '/deliveries/:id/status',
  auth,
  rider,
  async (req, res, next) => {
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
              'Invalid delivery id',
          });
      }

      const {
        status,
        lat,
        lng,
      } = req.body;

      const note =
        String(
          req.body.note ||
          ''
        )
          .trim()
          .slice(0, 500);

      const advanceable =
        DELIVERY_STATUSES.filter(
          s =>
            s !== 'unassigned' &&
            s !== 'assigned' &&
            s !== 'delivered'
        );

      if (
        !advanceable.includes(
          status
        )
      ) {
        return res
          .status(400)
          .json({
            error:
              `status must be one of: ${advanceable.join(', ')}`,
          });
      }

      if (
        status === 'failed' &&
        !note
      ) {
        return res
          .status(400)
          .json({
            error:
              'A reason is required to record a failed delivery',
          });
      }

      const delivery =
        await Delivery.findById(
          req.params.id
        );

      if (!delivery) {
        return res
          .status(404)
          .json({
            error:
              'Delivery not found',
          });
      }

      if (
        String(delivery.rider) !==
        String(
          req.riderUser._id
        )
      ) {
        return res
          .status(403)
          .json({
            error:
              'This delivery is not assigned to you',
          });
      }

      if (
        [
          'delivered',
          'failed',
        ].includes(
          delivery.status
        )
      ) {
        return res
          .status(409)
          .json({
            error:
              'This delivery is already closed out',
          });
      }

      delivery.addCheckpoint({
        status,
        note,
        lat,
        lng,
      });

      await delivery.save();

      const order =
        await Order.findById(
          delivery.order
        );

      if (order) {
        const mapped =
          orderStatusFor(
            delivery
          );

        if (
          mapped &&
          mapped !== order.status
        ) {
          order.status =
            mapped;

          order.statusHistory.push({
            status:
              mapped,
            at:
              new Date(),
            note,
            byEmail:
              req.riderUser.email,
          });

          await order.save();

          await notifyOrderStatus(
            order,
            mapped
          );
        } else if (
          status === 'failed'
        ) {
          await notify(
            order.user,
            {
              type:
                'status',

              title:
                `Delivery attempt unsuccessful — ${order.invoiceNo}`,

              message:
                `Our rider could not complete the ${
                  delivery.type ===
                  'return'
                    ? 'pickup'
                    : 'delivery'
                }: ${note}`,

              link:
                `/order.html?id=${order.id}`,
            }
          );
        }
      }

      await audit(
        req,
        'delivery.status',
        {
          targetType:
            'Delivery',

          targetId:
            delivery.id,

          targetLabel:
            order?.invoiceNo ||
            delivery.id,

          details: {
            status,
            note,
            orderId:
              order?.id,
          },
        }
      );

      res.json(
        delivery
      );
    } catch (err) {
      next(err);
    }
  }
);

/* ================================================================
   POST /api/riders/deliveries/:id/proof
================================================================ */

router.post(
  '/deliveries/:id/proof',
  auth,
  rider,
  async (req, res, next) => {
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
              'Invalid delivery id',
          });
      }

      const delivery =
        await Delivery.findById(
          req.params.id
        );

      if (!delivery) {
        return res
          .status(404)
          .json({
            error:
              'Delivery not found',
          });
      }

      if (
        String(delivery.rider) !==
        String(
          req.riderUser._id
        )
      ) {
        return res
          .status(403)
          .json({
            error:
              'This delivery is not assigned to you',
          });
      }

      if (
        [
          'delivered',
          'failed',
        ].includes(
          delivery.status
        )
      ) {
        return res
          .status(409)
          .json({
            error:
              'This delivery is already closed out',
          });
      }

      const order =
        await Order.findById(
          delivery.order
        );

      if (!order) {
        return res
          .status(404)
          .json({
            error:
              'Order not found',
          });
      }

      const proofUrl =
        String(
          req.body.proofUrl ||
          ''
        ).slice(
          0,
          700_000
        );

      const signature =
        String(
          req.body.signature ||
          ''
        ).slice(
          0,
          700_000
        );

      const recipientName =
        String(
          req.body.recipientName ||
          ''
        )
          .trim()
          .slice(
            0,
            120
          );

      if (!proofUrl) {
        return res
          .status(400)
          .json({
            error:
              'A proof photo is required',
          });
      }

      if (
        !signature &&
        !recipientName
      ) {
        return res
          .status(400)
          .json({
            error:
              'A signature or a typed recipient name is required',
          });
      }

      let cashCollected;

      const cashProvided =
        req.body.cashCollected !==
          undefined &&
        req.body.cashCollected !==
          null &&
        req.body.cashCollected !==
          '';

      if (cashProvided) {
        cashCollected =
          Number(
            req.body.cashCollected
          );

        if (
          !Number.isFinite(
            cashCollected
          ) ||
          cashCollected < 0
        ) {
          return res
            .status(400)
            .json({
              error:
                'cashCollected must be a non-negative number',
            });
        }
      }

      /*
       * IMPORTANT:
       * Validate COD before changing delivery/order status.
       */
      if (
        delivery.type !==
          'return' &&
        order.payment?.method ===
          'cash'
      ) {
        if (!cashProvided) {
          return res
            .status(400)
            .json({
              error:
                `Cash collection is required for this COD order. Expected at least ₱${Number(order.total || 0).toLocaleString('en-PH')}.`,
            });
        }

        if (
          cashCollected <
          Number(
            order.total ||
            0
          )
        ) {
          return res
            .status(400)
            .json({
              error:
                `Insufficient cash collected. Expected at least ₱${Number(order.total || 0).toLocaleString('en-PH')}.`,
            });
        }
      }

      delivery.proofUrl =
        proofUrl;

      delivery.signature =
        signature;

      delivery.recipientName =
        recipientName;

      if (
        delivery.type !==
          'return' &&
        cashProvided
      ) {
        delivery.cashCollected =
          cashCollected;
      }

      delivery.addCheckpoint({
        status:
          'delivered',

        note:
          `Received by ${
            recipientName ||
            'recipient'
          }`,
      });

      await delivery.save();

      const mapped =
        orderStatusFor(
          delivery
        );

      order.status =
        mapped;

      order.statusHistory.push({
        status:
          mapped,

        at:
          new Date(),

        note:
          `Received by ${
            recipientName ||
            'recipient'
          }`,

        byEmail:
          req.riderUser.email,
      });

      if (
        delivery.type ===
        'return'
      ) {
        order.returnedAt =
          new Date();

        order.proofOfReturnUrl =
          proofUrl;
      } else {
        order.proofOfDeliveryUrl =
          proofUrl;

        if (
          order.payment?.method ===
          'cash'
        ) {
          order.cashCollected =
            true;

          order.paid =
            true;

          order.paidAt =
            new Date();

          order.payment.status =
            'paid';

          order.payment.paidAt =
            order.paidAt;

          order.payment.referenceNo =
            order.payment.referenceNo ||
            `COD-${order.id
              .slice(-8)
              .toUpperCase()}`;
        } else if (
          cashProvided
        ) {
          order.cashCollected =
            true;
        }
      }

      await order.save();

      await notifyOrderStatus(
        order,
        mapped
      );

      await audit(
        req,
        'delivery.proof',
        {
          targetType:
            'Delivery',

          targetId:
            delivery.id,

          targetLabel:
            order.invoiceNo ||
            delivery.id,

          details: {
            recipientName,
            cashCollected,
            orderId:
              order.id,
          },
        }
      );

      res.json(
        delivery
      );
    } catch (err) {
      next(err);
    }
  }
);

/* ================================================================
   GET /api/riders
================================================================ */

router.get(
  '/',
  auth,
  admin,
  async (req, res, next) => {
    try {
      const riders =
        await User.find({
          role: 'rider',
        })
          .select(
            'name email profile.phone riderDispatch createdAt'
          )
          .sort({
            name: 1,
          });

      const loads =
        riders.length
          ? await Delivery.aggregate([
              {
                $match: {
                  rider: {
                    $in:
                      riders.map(
                        r =>
                          r._id
                      ),
                  },

                  status: {
                    $in: [
                      'unassigned',
                      'assigned',
                      'picked-up',
                      'in-transit',
                      'arriving',
                    ],
                  },
                },
              },

              {
                $group: {
                  _id:
                    '$rider',

                  activeJobs: {
                    $sum: 1,
                  },
                },
              },
            ])
          : [];

      const byRider =
        new Map(
          loads.map(row => [
            String(
              row._id
            ),
            row.activeJobs,
          ])
        );

      res.json({
        riders:
          riders.map(r => {
            const json =
              r.toJSON();

            json.riderDispatch = {
              homeHub:
                json.riderDispatch?.homeHub ||
                'cubao',

              onDuty:
                json.riderDispatch?.onDuty ===
                true,
            };

            json.activeJobs =
              byRider.get(
                String(
                  r._id
                )
              ) ||
              0;

            return json;
          }),

        hubs:
          PICKUP_HUBS.map(
            ({
              id,
              name,
              address,
            }) => ({
              id,
              name,
              address,
            })
          ),

        count:
          riders.length,
      });
    } catch (err) {
      next(err);
    }
  }
);

async function updateDispatchProfile(
  req,
  res,
  next
) {
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
            'Invalid rider id',
        });
    }

    const validHubIds =
      PICKUP_HUBS.map(
        h =>
          h.id
      );

    const homeHub =
      req.body.homeHub ===
      undefined
        ? undefined
        : String(
            req.body.homeHub ||
            ''
          ).trim();

    if (
      homeHub !==
        undefined &&
      !validHubIds.includes(
        homeHub
      )
    ) {
      return res
        .status(400)
        .json({
          error:
            `homeHub must be one of: ${validHubIds.join(', ')}`,
        });
    }

    if (
      req.body.onDuty !==
        undefined &&
      typeof req.body.onDuty !==
        'boolean'
    ) {
      return res
        .status(400)
        .json({
          error:
            'onDuty must be true or false',
        });
    }

    const user =
      await User.findById(
        req.params.id
      );

    if (
      !user ||
      user.role !== 'rider'
    ) {
      return res
        .status(404)
        .json({
          error:
            'Rider not found',
        });
    }

    if (!user.riderDispatch) {
      user.riderDispatch = {};
    }

    if (
      homeHub !==
      undefined
    ) {
      user.riderDispatch.homeHub =
        homeHub;
    }

    if (
      req.body.onDuty !==
      undefined
    ) {
      user.riderDispatch.onDuty =
        req.body.onDuty;
    }

    await user.save();

    await audit(
      req,
      'rider.dispatchProfile',
      {
        targetType:
          'User',

        targetId:
          user.id,

        targetLabel:
          user.email,

        details: {
          homeHub:
            user.riderDispatch.homeHub,

          onDuty:
            user.riderDispatch.onDuty,
        },
      }
    );

    res.json({
      rider:
        user,

      riderDispatch:
        user.riderDispatch,
    });
  } catch (err) {
    next(err);
  }
}

router.patch(
  '/:id/dispatch-profile',
  auth,
  admin,
  updateDispatchProfile
);

/*
 * Backward-compatible endpoint for any older api.js.
 */
router.patch(
  '/:id/dispatch',
  auth,
  admin,
  updateDispatchProfile
);

module.exports = router;