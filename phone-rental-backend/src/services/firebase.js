const {
  cert,
  getApps,
  initializeApp,
} = require('firebase-admin/app');

const {
  getMessaging,
} = require('firebase-admin/messaging');


let messagingInstance = null;


function firebaseConfigured() {
  return Boolean(
    process.env.FIREBASE_PROJECT_ID &&
    process.env.FIREBASE_CLIENT_EMAIL &&
    process.env.FIREBASE_PRIVATE_KEY
  );
}


function getFirebaseMessaging() {

  if (messagingInstance) {
    return messagingInstance;
  }


  if (!firebaseConfigured()) {

    console.warn(
      '⚠️ Firebase push is not configured.'
    );

    return null;
  }


  try {

    const privateKey =
      String(
        process.env.FIREBASE_PRIVATE_KEY
      )
        .replace(
          /\\n/g,
          '\n'
        )
        .trim();


    if (!getApps().length) {

      initializeApp({
        credential: cert({
          projectId:
            process.env.FIREBASE_PROJECT_ID,

          clientEmail:
            process.env.FIREBASE_CLIENT_EMAIL,

          privateKey,
        }),
      });

    }


    messagingInstance =
      getMessaging();


    console.log(
      '✅ Firebase Admin initialized'
    );


    return messagingInstance;

  } catch (error) {

    console.error(
      '❌ Firebase Admin initialization failed:',
      error.message
    );


    return null;

  }

}


module.exports = {
  firebaseConfigured,
  getFirebaseMessaging,
};