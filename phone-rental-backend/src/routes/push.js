const express =
  require('express');

const User =
  require('../models/User');

const auth =
  require('../middlewares/auth');


const router =
  express.Router();


router.use(
  auth
);


const MIN_TOKEN_LENGTH =
  20;

const MAX_TOKEN_LENGTH =
  4096;


/*
 * POST /api/push/register
 *
 * Register or refresh an FCM token
 * for the currently logged-in user.
 */
router.post(
  '/register',

  async (
    req,
    res,
    next
  ) => {

    try {

      const token =
        String(
          req.body.token ||
          ''
        ).trim();


      if (
        token.length <
          MIN_TOKEN_LENGTH ||
        token.length >
          MAX_TOKEN_LENGTH
      ) {

        return res
          .status(
            400
          )
          .json({
            error:
              'Invalid push notification token',
          });

      }


      const user =
        await User
          .findByIdAndUpdate(
            req.userId,
            {
              $addToSet: {
                fcmTokens:
                  token,
              },
            },
            {
              new:
                true,
            }
          );


      if (!user) {

        return res
          .status(
            401
          )
          .json({
            error:
              'Account no longer exists',
          });

      }


      return res.json({
        ok:
          true,
      });

    } catch (error) {

      return next(
        error
      );

    }

  }
);


/*
 * DELETE /api/push/register
 *
 * Remove one device token.
 */
router.delete(
  '/register',

  async (
    req,
    res,
    next
  ) => {

    try {

      const token =
        String(
          req.body.token ||
          ''
        ).trim();


      if (!token) {

        return res
          .status(
            400
          )
          .json({
            error:
              'Push token is required',
          });

      }


      await User.updateOne(
        {
          _id:
            req.userId,
        },
        {
          $pull: {
            fcmTokens:
              token,
          },
        }
      );


      return res.json({
        ok:
          true,
      });

    } catch (error) {

      return next(
        error
      );

    }

  }
);


module.exports =
  router;
  