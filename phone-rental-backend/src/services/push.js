const User =
  require('../models/User');

const {
  getFirebaseMessaging,
} = require('./firebase');


const MAX_BATCH =
  500;


function cleanPayload(
  payload = {}
) {

  return {
    type:
      String(
        payload.type ||
        'system'
      ),

    title:
      String(
        payload.title ||
        'DiaLux'
      )
        .slice(
          0,
          120
        ),

    message:
      String(
        payload.message ||
        ''
      )
        .slice(
          0,
          500
        ),

    link:
      String(
        payload.link ||
        ''
      ),
  };

}


function chunk(
  values,
  size
) {

  const groups =
    [];


  for (
    let index = 0;
    index < values.length;
    index += size
  ) {

    groups.push(
      values.slice(
        index,
        index + size
      )
    );

  }


  return groups;

}


function uniqueTokens(
  tokens = []
) {

  return [
    ...new Set(
      tokens
        .map(
          token =>
            String(
              token ||
              ''
            ).trim()
        )
        .filter(
          Boolean
        )
    ),
  ];

}


function isDeadTokenError(
  code = ''
) {

  return [
    'messaging/registration-token-not-registered',
    'messaging/invalid-registration-token',
  ].includes(
    String(
      code
    )
  );

}


async function removeDeadTokens(
  tokens = []
) {

  const dead =
    uniqueTokens(
      tokens
    );


  if (!dead.length) {

    return;

  }


  try {

    await User.updateMany(
      {
        fcmTokens: {
          $in: dead,
        },
      },
      {
        $pull: {
          fcmTokens: {
            $in: dead,
          },
        },
      }
    );

  } catch (error) {

    console.warn(
      '[DiaLux] Could not remove dead FCM tokens:',
      error.message
    );

  }

}


async function sendToTokens(
  tokens,
  payload = {}
) {

  const messaging =
    getFirebaseMessaging();


  if (!messaging) {

    return {
      sent: 0,
      failed: 0,
    };

  }


  const cleanTokens =
    uniqueTokens(
      tokens
    );


  if (!cleanTokens.length) {

    return {
      sent: 0,
      failed: 0,
    };

  }


  const clean =
    cleanPayload(
      payload
    );


  let sent =
    0;

  let failed =
    0;

  const deadTokens =
    [];


  for (
    const batch
    of chunk(
      cleanTokens,
      MAX_BATCH
    )
  ) {

    try {

      const result =
        await messaging
          .sendEachForMulticast({
            tokens:
              batch,

            notification: {
              title:
                clean.title,

              body:
                clean.message ||
                clean.title,
            },

            data: {
              type:
                clean.type,

              link:
                clean.link,
            },

            android: {
              priority:
                'high',

              notification: {
                channelId:
                  'dialux-updates',

                sound:
                  'default',
              },
            },
          });


      sent +=
        result.successCount;


      failed +=
        result.failureCount;


      result.responses
        .forEach(
          (
            response,
            index
          ) => {

            if (
              response.success
            ) {

              return;

            }


            const code =
              response.error?.code ||
              '';


            if (
              isDeadTokenError(
                code
              )
            ) {

              deadTokens.push(
                batch[index]
              );

            }


            console.warn(
              '[DiaLux] Push delivery failed:',
              code ||
              response.error?.message ||
              'unknown error'
            );

          }
        );

    } catch (error) {

      failed +=
        batch.length;


      console.warn(
        '[DiaLux] FCM batch failed:',
        error.message
      );

    }

  }


  if (
    deadTokens.length
  ) {

    await removeDeadTokens(
      deadTokens
    );

  }


  return {
    sent,
    failed,
  };

}


async function sendPushToUser(
  userId,
  payload = {}
) {

  if (!userId) {

    return {
      sent: 0,
      failed: 0,
    };

  }


  try {

    const user =
      await User
        .findById(
          userId
        )
        .select(
          '+fcmTokens'
        );


    if (!user) {

      return {
        sent: 0,
        failed: 0,
      };

    }


    return await sendToTokens(
      user.fcmTokens ||
      [],
      payload
    );

  } catch (error) {

    console.warn(
      '[DiaLux] Push lookup failed:',
      error.message
    );


    return {
      sent: 0,
      failed: 0,
    };

  }

}


async function sendPushToUsers(
  userIds = [],
  payload = {}
) {

  if (
    !Array.isArray(
      userIds
    ) ||
    !userIds.length
  ) {

    return {
      sent: 0,
      failed: 0,
    };

  }


  try {

    const users =
      await User
        .find({
          _id: {
            $in:
              userIds,
          },
        })
        .select(
          '+fcmTokens'
        );


    const tokens =
      users.flatMap(
        user =>
          user.fcmTokens ||
          []
      );


    return await sendToTokens(
      tokens,
      payload
    );

  } catch (error) {

    console.warn(
      '[DiaLux] Push broadcast lookup failed:',
      error.message
    );


    return {
      sent: 0,
      failed: 0,
    };

  }

}


module.exports = {
  sendPushToUser,
  sendPushToUsers,
  sendToTokens,
};