const Notification =
  require('../models/Notification');

const {
  statusUpdateMail,
} = require('./mailer');

const {
  sendPushToUser,
  sendPushToUsers,
} = require('./push');


async function notify(
  userId,

  {
    type =
      'system',

    title,

    message =
      '',

    link =
      '',
  } = {}
) {

  if (
    !userId ||
    !title
  ) {

    return null;

  }


  const payload = {
    type,

    title:
      String(
        title
      ).slice(
        0,
        120
      ),

    message:
      String(
        message
      ).slice(
        0,
        500
      ),

    link:
      String(
        link ||
        ''
      ),
  };


  let notification =
    null;


  try {

    notification =
      await Notification.create({
        user:
          userId,

        ...payload,
      });

  } catch (error) {

    console.warn(
      '[DiaLux] notification not written:',
      error.message
    );

  }


  /*
   * Push is best-effort.
   * A failed FCM send must never
   * break checkout/order/support.
   */
  try {

    await sendPushToUser(
      userId,
      payload
    );

  } catch (error) {

    console.warn(
      '[DiaLux] push notification failed:',
      error.message
    );

  }


  return notification;

}


async function notifyMany(
  userIds = [],
  payload = {}
) {

  if (
    !Array.isArray(
      userIds
    ) ||
    !userIds.length ||
    !payload.title
  ) {

    return 0;

  }


  const cleanPayload = {
    type:
      payload.type ||
      'promo',

    title:
      String(
        payload.title
      ).slice(
        0,
        120
      ),

    message:
      String(
        payload.message ||
        ''
      ).slice(
        0,
        500
      ),

    link:
      String(
        payload.link ||
        ''
      ),
  };


  let writtenCount =
    0;


  try {

    const docs =
      userIds.map(
        user => ({
          user,

          ...cleanPayload,
        })
      );


    const written =
      await Notification.insertMany(
        docs,
        {
          ordered:
            false,
        }
      );


    writtenCount =
      written.length;

  } catch (error) {

    console.warn(
      '[DiaLux] broadcast partly failed:',
      error.message
    );

  }


  try {

    await sendPushToUsers(
      userIds,
      cleanPayload
    );

  } catch (error) {

    console.warn(
      '[DiaLux] push broadcast failed:',
      error.message
    );

  }


  return writtenCount;

}


const orderLink =
  order =>
    `/order.html?id=${
      order.id ||
      order._id
    }`;


const shortRef =
  order =>
    String(
      order.id ||
      order._id
    )
      .slice(
        -6
      )
      .toUpperCase();


const STATUS_COPY = {
  pending:
    'is waiting for payment.',

  'payment-confirmed':
    'is paid and confirmed. We are getting it ready.',

  approved:
    'has been approved by our team.',

  preparing:
    'is being prepared and data-wiped for you.',

  'ready-for-pickup':
    'is ready for pickup at your chosen hub.',

  shipped:
    'is on the way to your delivery address.',

  'out-for-delivery':
    'is out for delivery — expect it soon!',

  'picked-up':
    'has been picked up by your rider.',

  'in-transit':
    'is on the way with your rider.',

  arriving:
    'is almost there — your rider is arriving shortly.',

  delivered:
    'has been delivered. Enjoy the device!',

  received:
    'was confirmed as received. Your rental clock has started.',

  disputed:
    'was reported as a problem. Our team is looking into it and will contact you.',

  active:
    'is now an active rental.',

  'return-requested':
    'is queued for return pickup.',

  'return-scheduled':
    'has a confirmed return slot. Please have the device ready.',

  'return-in-transit':
    'is on its way back to us.',

  returned:
    'has arrived back with us. Inspection comes next.',

  'inspection-passed':
    'passed inspection.',

  'inspection-failed':
    'did not pass inspection. Charges may be deducted from your deposit.',

  'refund-processing':
    'is being refunded in full.',

  'refund-partial':
    'is being refunded, less late or damage charges.',

  inspection:
    'has arrived back with us and is being inspected.',

  refunded:
    'is closed and your deposit has been refunded.',

  completed:
    'is complete. Thank you for renting with DiaLux.',

  cancelled:
    'has been cancelled.',
};


async function notifyOrderStatus(
  order,
  status
) {

  const sentence =
    STATUS_COPY[
      status
    ] ||
    `is now "${status}".`;


  const notification =
    await notify(
      order.user,
      {
        type:
          'status',

        title:
          `Booking #${shortRef(
            order
          )} — ${status.replace(
            /-/g,
            ' '
          )}`,

        message:
          `Your booking ${sentence}`,

        link:
          orderLink(
            order
          ),
      }
    );


  if (
    order.userEmail
  ) {

    await statusUpdateMail({
      to:
        order.userEmail,

      name:
        order.userName,

      order:
        typeof order.toJSON ===
        'function'
          ? order.toJSON()
          : order,

      status,

      message:
        `Your booking ${sentence}`,
    });

  }


  return notification;

}


module.exports = {
  notify,
  notifyMany,
  notifyOrderStatus,
  STATUS_COPY,
};