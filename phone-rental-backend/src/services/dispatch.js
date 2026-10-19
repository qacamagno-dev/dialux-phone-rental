// ============================================================
// DiaLux — automatic rider dispatch
// Deterministic hub matching + least-loaded on-duty rider.
// ============================================================

const Delivery = require('../models/Delivery');
const User = require('../models/User');
const { notify } = require('./notify');

const ACTIVE_DELIVERY_STATUSES = [
  'unassigned',
  'assigned',
  'picked-up',
  'in-transit',
  'arriving',
];

const HUBS = [
  {
    id: 'katipunan',
    aliases: [
      'katipunan',
      'loyola heights',
      'loyola',
      'ateneo',
      'miriam',
      'up diliman',
      'diliman',
      'teacher village',
      'teachers village',
      'krus na ligas',
      'balara',
      'project 2',
      'project 3',
      '1101',
      '1108',
    ],
  },

  {
    id: 'cubao',
    aliases: [
      'cubao',
      'araneta',
      'aurora boulevard',
      'aurora blvd',
      'new manila',
      'kamuning',
      'kamias',
      'project 4',
      'socorro',
      'e rodriguez',
      '1111',
      '1109',
      '1102',

      // Eastern Metro Manila / Rizal service area
      'antipolo',
      'cainta',
      'taytay',
      'masinag',
      'cogeo',
      'marikina',
      '1870',
    ],
  },

  {
    id: 'fairview',
    aliases: [
      'fairview',
      'commonwealth',
      'novaliches',
      'lagro',
      'north fairview',
      'greater lagro',
      'batasan',
      'payatas',
      'holy spirit',
      'tandang sora',
      'sauyo',
      'talipapa',
      '1118',
      '1121',
      '1122',
      '1123',
      '1124',
      '1126',
      '1127',
      '1128',
    ],
  },
];

const normalize = value =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/* ============================================================
   HUB DETECTION
============================================================ */

function determineHub(order) {
  if (
    order?.pickupHub &&
    HUBS.some(h => h.id === order.pickupHub)
  ) {
    return order.pickupHub;
  }

  const text = normalize(
    [
      order?.address,
      order?.meetupLocation,
    ]
      .filter(Boolean)
      .join(' ')
  );

  /*
   * Cubao is the fallback hub for addresses which do not
   * explicitly match another DiaLux service zone.
   */
  let best = {
    id: 'cubao',
    score: 0,
  };

  for (const hub of HUBS) {
    let score = 0;

    for (const alias of hub.aliases) {
      const normalizedAlias =
        normalize(alias);

      if (
        normalizedAlias &&
        text.includes(normalizedAlias)
      ) {
        score +=
          /^\d{4}$/.test(alias)
            ? 3
            : 1;
      }
    }

    if (score > best.score) {
      best = {
        id: hub.id,
        score,
      };
    }
  }

  return best.id;
}

/* ============================================================
   RIDER LOAD
============================================================ */

async function activeLoads(riderIds) {
  if (!riderIds.length) {
    return new Map();
  }

  const rows =
    await Delivery.aggregate([
      {
        $match: {
          rider: {
            $in: riderIds,
          },

          status: {
            $in:
              ACTIVE_DELIVERY_STATUSES,
          },
        },
      },

      {
        $group: {
          _id: '$rider',

          count: {
            $sum: 1,
          },
        },
      },
    ]);

  return new Map(
    rows.map(row => [
      String(row._id),
      row.count,
    ])
  );
}

/* ============================================================
   CHOOSE RIDER
============================================================ */

async function findBestRider(hubId) {
  /*
   * IMPORTANT:
   * A rider must explicitly be On Duty.
   *
   * Missing onDuty fields are NOT considered available.
   */
  const riders =
    await User.find({
      role: 'rider',

      'riderDispatch.homeHub':
        hubId,

      'riderDispatch.onDuty':
        true,
    }).select(
      'name email profile.phone riderDispatch createdAt'
    );

  if (!riders.length) {
    return null;
  }

  const loads =
    await activeLoads(
      riders.map(
        rider =>
          rider._id
      )
    );

  riders.sort((a, b) => {
    const loadA =
      loads.get(
        String(a._id)
      ) || 0;

    const loadB =
      loads.get(
        String(b._id)
      ) || 0;

    if (loadA !== loadB) {
      return loadA - loadB;
    }

    /*
     * Tie breaker:
     * older rider account first.
     */
    return (
      new Date(
        a.createdAt || 0
      ) -
      new Date(
        b.createdAt || 0
      )
    );
  });

  const rider =
    riders[0];

  return {
    rider,

    activeJobs:
      loads.get(
        String(rider._id)
      ) || 0,
  };
}

/* ============================================================
   ADMIN ALERT
============================================================ */

async function notifyAdminsNoRider(
  order,
  hubId
) {
  const admins =
    await User.find({
      role: 'admin',
    }).select('_id');

  await Promise.all(
    admins.map(
      admin =>
        notify(
          admin._id,
          {
            type:
              'status',

            title:
              `Waiting for rider — ${order.invoiceNo}`,

            message:
              `No on-duty ${hubId} rider is available yet. ` +
              'Use Retry auto-dispatch after a rider becomes available.',

            link:
              '/admin.html#orders',
          }
        )
    )
  );
}

/* ============================================================
   OUTBOUND DELIVERY
============================================================ */

async function autoAssignOutbound(
  order,
  {
    source = 'system',
  } = {}
) {
  if (!order?._id) {
    return {
      assigned: false,
      reason: 'missing-order',
    };
  }

  /*
   * Customer pickup orders do not need an outbound rider.
   */
  if (
    order.orderType ===
    'pickup'
  ) {
    return {
      assigned: false,
      reason:
        'hub-pickup-no-rider',
    };
  }

  const existing =
    await Delivery.findOne({
      order:
        order._id,

      type:
        'delivery',
    });

  /*
   * If there is already a real active assignment,
   * do not create a duplicate Delivery.
   */
  if (
    existing &&
    existing.status !==
      'failed' &&
    existing.status !==
      'unassigned' &&
    existing.rider
  ) {
    if (
      !order.deliveryJob ||
      !order.rider
    ) {
      order.deliveryJob =
        existing._id;

      order.rider =
        existing.rider;

      await order.save();
    }

    return {
      assigned: true,
      reason:
        'already-assigned',
      delivery:
        existing,
    };
  }

  const hubId =
    determineHub(order);

  const choice =
    await findBestRider(
      hubId
    );

  if (!choice) {
    await notifyAdminsNoRider(
      order,
      hubId
    ).catch(
      () => {}
    );

    return {
      assigned: false,
      reason:
        'no-on-duty-rider',
      hub:
        hubId,
    };
  }

  let delivery =
    existing;

  /*
   * Reuse an existing failed/unassigned record.
   */
  if (delivery) {
    delivery.rider =
      choice.rider._id;

    delivery.status =
      'assigned';

    delivery.completedAt =
      undefined;

    delivery.checkpoints.push({
      status:
        'assigned',

      at:
        new Date(),

      note:
        `Auto-dispatched from ${hubId} (${source})`,
    });

    await delivery.save();
  } else {
    delivery =
      await Delivery.create({
        order:
          order._id,

        rider:
          choice.rider._id,

        type:
          'delivery',

        status:
          'assigned',

        checkpoints: [
          {
            status:
              'assigned',

            at:
              new Date(),

            note:
              `Auto-dispatched from ${hubId} (${source})`,
          },
        ],
      });
  }

  order.rider =
    choice.rider._id;

  order.deliveryJob =
    delivery._id;

  await order.save();

  await Promise.all([
    notify(
      order.user,
      {
        type:
          'status',

        title:
          `Rider assigned — ${order.invoiceNo}`,

        message:
          `${choice.rider.name || 'Your rider'} has been assigned to your delivery.`,

        link:
          `/order.html?id=${order.id}`,
      }
    ),

    notify(
      choice.rider._id,
      {
        type:
          'status',

        title:
          `New delivery — ${order.invoiceNo}`,

        message:
          `${order.userName || order.userEmail} · ${order.address || order.meetupLocation || ''}`,

        link:
          '/rider.html',
      }
    ),
  ]).catch(
    () => {}
  );

  return {
    assigned: true,

    hub:
      hubId,

    rider:
      choice.rider,

    delivery,

    activeJobsBeforeAssignment:
      choice.activeJobs,
  };
}

/* ============================================================
   RETURN PICKUP
============================================================ */

async function autoAssignReturn(
  order,
  {
    source = 'system',
  } = {}
) {
  if (!order?._id) {
    return {
      assigned: false,
      reason:
        'missing-order',
    };
  }

  /*
   * Only rider-return plans need rider dispatch.
   */
  if (
    order.returnPlan
      ?.method !==
    'rider'
  ) {
    return {
      assigned: false,

      reason:
        'return-does-not-need-rider',
    };
  }

  const existing =
    await Delivery.findOne({
      order:
        order._id,

      type:
        'return',
    });

  /*
   * An unassigned return Delivery is only a placeholder.
   * It must NOT be treated as already assigned.
   */
  if (
    existing &&
    existing.status !==
      'failed' &&
    existing.status !==
      'unassigned' &&
    existing.rider
  ) {
    if (
      !order.returnDeliveryJob
    ) {
      order.returnDeliveryJob =
        existing._id;

      await order.save();
    }

    return {
      assigned: true,

      reason:
        'already-assigned',

      delivery:
        existing,
    };
  }

  const hubId =
    determineHub(order);

  const choice =
    await findBestRider(
      hubId
    );

  if (!choice) {
    await notifyAdminsNoRider(
      order,
      hubId
    ).catch(
      () => {}
    );

    return {
      assigned: false,

      reason:
        'no-on-duty-rider',

      hub:
        hubId,
    };
  }

  let delivery =
    existing;

  /*
   * Return scheduling creates an unassigned Delivery first.
   * Reuse that Delivery instead of creating a duplicate one.
   */
  if (delivery) {
    delivery.rider =
      choice.rider._id;

    delivery.status =
      'assigned';

    delivery.completedAt =
      undefined;

    delivery.checkpoints.push({
      status:
        'assigned',

      at:
        new Date(),

      note:
        `Auto-dispatched return from ${hubId} (${source})`,
    });

    await delivery.save();
  } else {
    delivery =
      await Delivery.create({
        order:
          order._id,

        rider:
          choice.rider._id,

        type:
          'return',

        status:
          'assigned',

        checkpoints: [
          {
            status:
              'assigned',

            at:
              new Date(),

            note:
              `Auto-dispatched return from ${hubId} (${source})`,
          },
        ],
      });
  }

  order.returnDeliveryJob =
    delivery._id;

  await order.save();

  await Promise.all([
    notify(
      choice.rider._id,
      {
        type:
          'return',

        title:
          `New return pickup — ${order.invoiceNo}`,

        message:
          `${order.userName || order.userEmail} · ${order.address || ''}`,

        link:
          '/rider.html',
      }
    ),

    notify(
      order.user,
      {
        type:
          'return',

        title:
          `Return rider assigned — ${order.invoiceNo}`,

        message:
          `${choice.rider.name || 'Your rider'} has been assigned to collect your returned device.`,

        link:
          `/order.html?id=${order.id}`,
      }
    ),
  ]).catch(
    () => {}
  );

  return {
    assigned: true,

    hub:
      hubId,

    rider:
      choice.rider,

    delivery,

    activeJobsBeforeAssignment:
      choice.activeJobs,
  };
}

/* ============================================================
   PUBLIC DISPATCH ENTRY
============================================================ */

async function dispatchOrder(
  order,
  leg = 'outbound',
  options = {}
) {
  if (
    leg === 'return'
  ) {
    return autoAssignReturn(
      order,
      options
    );
  }

  return autoAssignOutbound(
    order,
    options
  );
}

module.exports = {
  ACTIVE_DELIVERY_STATUSES,
  determineHub,
  findBestRider,
  autoAssignOutbound,
  autoAssignReturn,
  dispatchOrder,
};