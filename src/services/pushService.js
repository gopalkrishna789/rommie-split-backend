import webpush from 'web-push';
import dotenv from 'dotenv';

dotenv.config();

// Configure VAPID keys for Web Push
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    process.env.VAPID_EMAIL || 'mailto:admin@roomiesplit.app',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

// Initialize Firebase Admin (optional — graceful if not configured)
let firebaseAdmin = null;
async function getFirebaseAdmin() {
  if (firebaseAdmin) return firebaseAdmin;
  try {
    const { default: admin } = await import('firebase-admin');
    const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
      ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
      : null;

    if (!serviceAccount || !serviceAccount.project_id) {
      console.warn('Firebase service account not configured — FCM push disabled');
      return null;
    }

    if (!admin.apps.length) {
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    }
    firebaseAdmin = admin;
    return admin;
  } catch (err) {
    console.warn('Firebase Admin init failed:', err.message);
    return null;
  }
}

/**
 * Send a Web Push notification to a subscription
 * @param {object} subscription - push_subscription from DB
 * @param {object} payload - { title, body, icon, data }
 */
export async function sendWebPush(subscription, payload) {
  if (!subscription) return;
  try {
    await webpush.sendNotification(
      typeof subscription === 'string' ? JSON.parse(subscription) : subscription,
      JSON.stringify(payload)
    );
  } catch (err) {
    if (err.statusCode === 410 || err.statusCode === 404) {
      // Subscription expired — caller should remove it
      console.warn('Web Push subscription expired:', err.statusCode);
    } else {
      console.error('Web Push send error:', err.message);
    }
  }
}

/**
 * Send an FCM notification via Firebase Admin
 * @param {string} fcmToken
 * @param {object} payload - { title, body, icon, data }
 */
export async function sendFCM(fcmToken, payload) {
  if (!fcmToken) return;
  const admin = await getFirebaseAdmin();
  if (!admin) return;

  try {
    await admin.messaging().send({
      token: fcmToken,
      notification: {
        title: payload.title,
        body: payload.body,
      },
      webpush: {
        notification: {
          icon: payload.icon || '/icons/icon-192.png',
          badge: '/icons/icon-192.png',
        },
        fcmOptions: {
          link: payload.data?.expenseId ? `/` : '/',
        },
      },
      data: payload.data
        ? Object.fromEntries(Object.entries(payload.data).map(([k, v]) => [k, String(v)]))
        : {},
    });
  } catch (err) {
    console.error('FCM send error:', err.message);
  }
}

/**
 * Notify all debtors when a new expense is added
 * @param {object[]} members - members with push_subscription and fcm_token
 * @param {string} payerName
 * @param {number} totalAmount - paise
 * @param {string} purpose
 * @param {string} expenseId
 * @param {object[]} splits - split rows with member_id, share, carry_forward
 */
export async function notifyExpenseAdded(members, payerName, totalAmount, purpose, expenseId, splits) {
  for (const split of splits) {
    if (split.paid) continue; // skip payer's own split

    const member = members.find((m) => m.id === split.member_id);
    if (!member) continue;

    const amountDue = split.share + split.carry_forward;
    const payload = {
      title: 'Roomie Split 💸',
      body: `${payerName} paid ₹${(totalAmount / 100).toFixed(0)} for ${purpose} — you owe ₹${(amountDue / 100).toFixed(0)}`,
      icon: '/icons/icon-192.png',
      data: {
        expenseId,
        payerUpiId: split.payer_upi_id || '',
        amount: String(amountDue),
        type: 'expense_added',
      },
    };

    await Promise.allSettled([
      sendWebPush(member.push_subscription, payload),
      sendFCM(member.fcm_token, payload),
    ]);
  }
}

/**
 * Notify payer when someone marks their split as paid
 * @param {object} payer - member row with push_subscription, fcm_token
 * @param {string} memberName - who paid
 * @param {number} amount - paise
 * @param {string} purpose
 * @param {string} expenseId
 */
export async function notifyPaymentReceived(payer, memberName, amount, purpose, expenseId) {
  if (!payer) return;
  const payload = {
    title: 'Roomie Split ✅',
    body: `${memberName} paid you ₹${(amount / 100).toFixed(0)} for ${purpose}`,
    icon: '/icons/icon-192.png',
    data: { expenseId, type: 'payment_received' },
  };

  await Promise.allSettled([
    sendWebPush(payer.push_subscription, payload),
    sendFCM(payer.fcm_token, payload),
  ]);
}
