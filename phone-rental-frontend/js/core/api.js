// ============================================================
// API client – handles all backend calls for DiaLux
// ============================================================

// The Express backend also serves this frontend, so in the normal setup
// (npm run dev → http://localhost:5000) the API sits on the same origin.
// Opening the page any other way — VS Code Live Server, file:// — falls
// back to talking to the dev server directly.
//
// A deployed build is always same-origin: anything that is not a localhost
// dev server is treated as such, so no rebuild or edit is needed to ship.
const IS_LOCAL_DEV_SERVER = ['localhost', '127.0.0.1'].includes(location.hostname)
  && location.port !== '5000'
  && location.port !== '';

const SAME_ORIGIN = location.protocol.startsWith('http') && !IS_LOCAL_DEV_SERVER;

const API_ROOT = SAME_ORIGIN ? '/api' : 'http://localhost:5000/api';

// ---- Custom API error ----
export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

// ---- Token management ----
export function getToken() {
  return localStorage.getItem('authToken');
}

export function setToken(token) {
  if (token) {
    localStorage.setItem('authToken', token);
  } else {
    localStorage.removeItem('authToken');
  }
}

/**
 * One place for every call: attaches the bearer token when we have one,
 * JSON-encodes the body, and turns any non-2xx response into an ApiError
 * carrying the server's own message.
 *
 * @param {string} path    path under /api, e.g. "/cart/items"
 * @param {object} [opts]  { method, body, query, fallback }
 */
async function request(path, { method = 'GET', body, query, fallback = 'Request failed' } = {}) {
  const url = new URL(`${API_ROOT}${path}`, location.origin);

  if (query) {
    Object.entries(query).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') {
        url.searchParams.set(k, v);
      }
    });
  }

  const headers = {};
  const token = getToken();

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  let res;

  try {
    res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('Cannot reach the DiaLux server', 0);
  }

  if (!res.ok) {
    const data = await res.json().catch(() => null);

    if (res.status === 401) {
      setToken(null);
    }

    throw new ApiError(
      data?.error || fallback,
      res.status
    );
  }

  if (res.status === 204) {
    return null;
  }

  return res.json().catch(() => null);
}

export { request };

// ============================================================
// AUTH
// ============================================================

export const authApi = {
  login: (email, password) =>
    request('/auth/login', {
      method: 'POST',
      body: {
        email,
        password,
      },
      fallback: 'Login failed',
    }),

  register: (name, email, password) =>
    request('/auth/register', {
      method: 'POST',
      body: {
        name,
        email,
        password,
      },
      fallback: 'Registration failed',
    }),

  googleLogin: (credential) =>
    request('/auth/google', {
      method: 'POST',
      body: {
        token: credential,
      },
      fallback: 'Google sign-in failed',
    }),

  me: async () => {
    if (!getToken()) {
      throw new ApiError(
        'No token found',
        401
      );
    }

    try {
      return await request(
        '/auth/me',
        {
          fallback:
            'Failed to fetch user',
        }
      );
    } catch (err) {
      if (
        err instanceof ApiError &&
        err.status === 401
      ) {
        throw new ApiError(
          'Session expired',
          401
        );
      }

      throw err;
    }
  },

  forgotPassword: (email) =>
    request(
      '/auth/forgot-password',
      {
        method: 'POST',
        body: {
          email,
        },
        fallback:
          'Could not start the password reset',
      }
    ),

  resetPassword: (
    token,
    password
  ) =>
    request(
      '/auth/reset-password',
      {
        method: 'POST',
        body: {
          token,
          password,
        },
        fallback:
          'Could not reset your password',
      }
    ),

  changePassword: (
    currentPassword,
    newPassword
  ) =>
    request(
      '/auth/password',
      {
        method: 'PATCH',
        body: {
          currentPassword,
          newPassword,
        },
        fallback:
          'Could not change your password',
      }
    ),
};

// ============================================================
// PRODUCTS
// ============================================================

export const productsApi = {
  list: (params) =>
    request(
      '/products',
      {
        query: params,
        fallback:
          'Could not load the catalog',
      }
    ),

  one: (id) =>
    request(
      `/products/${id}`,
      {
        fallback:
          'Could not load that device',
      }
    ),

  create: (payload) =>
    request(
      '/products',
      {
        method: 'POST',
        body: payload,
        fallback:
          'Could not create the device',
      }
    ),

  update: (
    id,
    payload
  ) =>
    request(
      `/products/${id}`,
      {
        method: 'PUT',
        body: payload,
        fallback:
          'Could not save the device',
      }
    ),

  remove: (id) =>
    request(
      `/products/${id}`,
      {
        method: 'DELETE',
        fallback:
          'Could not delete the device',
      }
    ),

  restore: (id) =>
    request(
      `/products/${id}/restore`,
      {
        method: 'POST',
        fallback:
          'Could not restore the device',
      }
    ),

  adjustStock: (
    id,
    delta
  ) =>
    request(
      `/products/${id}/stock`,
      {
        method: 'PATCH',
        body: {
          delta,
        },
        fallback:
          'Could not adjust stock',
      }
    ),

  allIncludingInactive: () =>
    request(
      '/products/all/including-inactive',
      {
        fallback:
          'Could not load the full catalog',
      }
    ),
};

// ============================================================
// REVIEWS
// ============================================================

export const reviewsApi = {
  list: (productId) =>
    request(
      `/products/${productId}/reviews`,
      {
        fallback:
          'Could not load reviews',
      }
    ),

  create: (
    productId,
    {
      rating,
      comment,
    }
  ) =>
    request(
      `/products/${productId}/reviews`,
      {
        method: 'POST',
        body: {
          rating,
          comment,
        },
        fallback:
          'Could not submit your review',
      }
    ),
};

// ============================================================
// WISHLIST
// ============================================================

export const wishlistApi = {
  get: () =>
    request(
      '/wishlist',
      {
        fallback:
          'Could not load your wishlist',
      }
    ),

  add: (productId) =>
    request(
      `/wishlist/${productId}`,
      {
        method: 'POST',
        fallback:
          'Could not save that device',
      }
    ),

  remove: (productId) =>
    request(
      `/wishlist/${productId}`,
      {
        method: 'DELETE',
        fallback:
          'Could not remove that device',
      }
    ),

  clear: () =>
    request(
      '/wishlist',
      {
        method: 'DELETE',
        fallback:
          'Could not clear your wishlist',
      }
    ),
};

// ============================================================
// NOTIFICATIONS
// ============================================================

export const notificationsApi = {
  list: (params) =>
    request(
      '/notifications',
      {
        query: params,
        fallback:
          'Could not load notifications',
      }
    ),

  markRead: (id) =>
    request(
      `/notifications/${id}/read`,
      {
        method: 'PATCH',
        fallback:
          'Could not mark that as read',
      }
    ),

  markAllRead: () =>
    request(
      '/notifications/read-all',
      {
        method: 'POST',
        fallback:
          'Could not mark all as read',
      }
    ),

  remove: (id) =>
    request(
      `/notifications/${id}`,
      {
        method: 'DELETE',
        fallback:
          'Could not dismiss that',
      }
    ),

  clear: () =>
    request(
      '/notifications',
      {
        method: 'DELETE',
        fallback:
          'Could not clear your notifications',
      }
    ),

  broadcast: (payload) =>
    request(
      '/notifications/broadcast',
      {
        method: 'POST',
        body: payload,
        fallback:
          'Could not send the announcement',
      }
    ),
};

// ============================================================
// SUPPORT
// ============================================================

export const supportApi = {
  create: (payload) =>
    request(
      '/support',
      {
        method: 'POST',
        body: payload,
        fallback:
          'Could not send your message',
      }
    ),

  mine: () =>
    request(
      '/support/mine',
      {
        fallback:
          'Could not load your support requests',
      }
    ),

  one: (id) =>
    request(
      `/support/${id}`,
      {
        fallback:
          'Could not load that ticket',
      }
    ),

  reply: (
    id,
    message
  ) =>
    request(
      `/support/${id}/reply`,
      {
        method: 'POST',
        body: {
          message,
        },
        fallback:
          'Could not post your reply',
      }
    ),

  all: (status) =>
    request(
      '/support',
      {
        query: {
          status,
        },
        fallback:
          'Could not load support tickets',
      }
    ),

  setStatus: (
    id,
    status
  ) =>
    request(
      `/support/${id}/status`,
      {
        method: 'PATCH',
        body: {
          status,
        },
        fallback:
          'Could not update the ticket',
      }
    ),
};

// ============================================================
// CMS PAGES
// ============================================================

export const pagesApi = {
  all: () =>
    request(
      '/pages',
      {
        fallback:
          'Could not load page content',
      }
    ),

  one: (slug) =>
    request(
      `/pages/${slug}`,
      {
        fallback:
          'Could not load that page',
      }
    ),

  save: (
    slug,
    payload
  ) =>
    request(
      `/pages/${slug}`,
      {
        method: 'PUT',
        body: payload,
        fallback:
          'Could not save the page',
      }
    ),

  revert: (slug) =>
    request(
      `/pages/${slug}`,
      {
        method: 'DELETE',
        fallback:
          'Could not revert the page',
      }
    ),
};

// ============================================================
// SETTINGS
// ============================================================

export const settingsApi = {
  get: () =>
    request(
      '/settings',
      {
        fallback:
          'Could not load platform settings',
      }
    ),

  save: (payload) =>
    request(
      '/settings',
      {
        method: 'PUT',
        body: payload,
        fallback:
          'Could not save the settings',
      }
    ),
};

// ============================================================
// AUDIT
// ============================================================

export const auditApi = {
  list: (params) =>
    request(
      '/audit',
      {
        query: params,
        fallback:
          'Could not load the audit trail',
      }
    ),
};

// ============================================================
// CART
// ============================================================

export const cartApi = {
  get: () =>
    request(
      '/cart',
      {
        fallback:
          'Could not load your cart',
      }
    ),

  addItem: (
    productId,
    plan,
    qty
  ) =>
    request(
      '/cart/items',
      {
        method: 'POST',
        body: {
          productId,
          plan,
          qty,
        },
        fallback:
          'Could not add to cart',
      }
    ),

  updateItem: (
    productId,
    plan,
    patch
  ) =>
    request(
      '/cart/items',
      {
        method: 'PATCH',
        body: {
          productId,
          plan,
          ...patch,
        },
        fallback:
          'Could not update the cart',
      }
    ),

  removeItem: (
    productId,
    plan
  ) =>
    request(
      '/cart/items',
      {
        method: 'DELETE',
        body: {
          productId,
          plan,
        },
        fallback:
          'Could not remove the item',
      }
    ),

  clear: () =>
    request(
      '/cart',
      {
        method: 'DELETE',
        fallback:
          'Could not empty the cart',
      }
    ),

  setDates: (
    startDate,
    endDate
  ) =>
    request(
      '/cart',
      {
        method: 'PATCH',
        body: {
          startDate,
          endDate,
        },
        fallback:
          'Could not update your rental dates',
      }
    ),

  setProtection: (
    protection
  ) =>
    request(
      '/cart',
      {
        method: 'PATCH',
        body: {
          protection,
        },
        fallback:
          'Could not update damage protection',
      }
    ),

  merge: (
    items,
    dates = {}
  ) =>
    request(
      '/cart/merge',
      {
        method: 'POST',
        body: {
          items,
          ...dates,
        },
        fallback:
          'Could not merge your cart',
      }
    ),
};

// ============================================================
// ORDERS
// ============================================================

export const ordersApi = {
  create: ({
    address,
    addressId,
    startDate,
    endDate,
    protection,
  } = {}) =>
    request(
      '/orders',
      {
        method: 'POST',
        body: {
          address,
          addressId,
          startDate,
          endDate,
          protection,
        },
        fallback:
          'Checkout failed',
      }
    ),

  createDirect: ({
    productId,
    plan,
    qty,
    address,
    addressId,
    startDate,
    endDate,
    protection,
    orderType,
    pickupHub,
    meetupLocation,
    timeSlot,
  } = {}) =>
    request(
      '/orders/direct',
      {
        method: 'POST',

        body: {
          productId,
          plan,
          qty,
          address,
          addressId,
          startDate,
          endDate,
          protection,
          orderType,
          pickupHub,
          meetupLocation,
          timeSlot,
        },

        fallback:
          'Could not place the order',
      }
    ),

  mine: () =>
    request(
      '/orders/mine',
      {
        fallback:
          'Could not load your orders',
      }
    ),

  availability: (
    productId
  ) =>
    request(
      `/orders/availability/${productId}`,
      {
        fallback:
          'Could not load availability',
      }
    ),

  one: (id) =>
    request(
      `/orders/${id}`,
      {
        fallback:
          'Could not load that booking',
      }
    ),

  cancel: (id) =>
    request(
      `/orders/${id}/cancel`,
      {
        method: 'POST',
        fallback:
          'Could not cancel the booking',
      }
    ),

  pay: (
    id,
    method
  ) =>
    request(
      `/orders/${id}/pay`,
      {
        method: 'POST',
        body: {
          method,
        },
        fallback:
          'Payment could not be processed',
      }
    ),

  requestReturn: (
    id,
    {
      date,
      slot,
      note,
      hub,
    } = {}
  ) =>
    request(
      `/orders/${id}/return`,
      {
        method: 'POST',
        body: {
          date,
          slot,
          note,
          hub,
        },
        fallback:
          'Could not request a return',
      }
    ),

  confirmReceipt: (id) =>
    request(
      `/orders/${id}/confirm-receipt`,
      {
        method: 'POST',
        fallback:
          'Could not confirm receipt',
      }
    ),

  reportIssue: (
    id,
    {
      reason,
      details,
      photos,
    } = {}
  ) =>
    request(
      `/orders/${id}/report-issue`,
      {
        method: 'POST',
        body: {
          reason,
          details,
          photos,
        },
        fallback:
          'Could not send your report',
      }
    ),

  inspectionQueue: () =>
    request(
      '/orders/inspection/queue',
      {
        fallback:
          'Could not load the inspection queue',
      }
    ),

  hubReceived: (id) =>
    request(
      `/orders/${id}/hub-received`,
      {
        method: 'POST',
        fallback:
          'Could not mark it received',
      }
    ),

  inspect: (
    id,
    {
      passed,
      notes,
      damageCharge,
      photos,
      checklist,
    } = {}
  ) =>
    request(
      `/orders/${id}/inspection`,
      {
        method: 'POST',

        body: {
          passed,
          notes,
          damageCharge,
          photos,
          checklist,
        },

        fallback:
          'Could not save the inspection',
      }
    ),

  extend: (id) =>
    request(
      `/orders/${id}/extend`,
      {
        method: 'POST',
        fallback:
          'Could not extend the rental',
      }
    ),

  all: (
    status,
    q
  ) =>
    request(
      '/orders',
      {
        query: {
          status,
          q,
        },
        fallback:
          'Could not load orders',
      }
    ),

  /**
   * Emergency exception only.
   * The backend now rejects normal fulfilment statuses.
   */
  setStatus: (
    id,
    status,
    note
  ) =>
    request(
      `/orders/${id}/status`,
      {
        method: 'PATCH',
        body: {
          status,
          note,
        },
        fallback:
          'Could not update the order status',
      }
    ),

  refund: (
    id,
    {
      amount,
      deducted,
      note,
      method,
    } = {}
  ) =>
    request(
      `/orders/${id}/refund`,
      {
        method: 'POST',

        body: {
          amount,
          deducted,
          note,
          method,
        },

        fallback:
          'Could not record the refund',
      }
    ),

  reports: () =>
    request(
      '/orders/reports/summary',
      {
        fallback:
          'Could not load the report',
      }
    ),

  /**
   * Admin does NOT choose the rider.
   *
   * This only asks the backend to retry its automatic dispatcher.
   */
  dispatch: (
    id,
    leg = 'outbound'
  ) =>
    request(
      `/orders/${id}/dispatch`,
      {
        method: 'POST',

        body: {
          leg,
        },

        fallback:
          'Could not retry automatic rider dispatch',
      }
    ),
};

// ============================================================
// RIDERS
// ============================================================

export const ridersApi = {
  myDeliveries: () =>
    request(
      '/riders/me/deliveries',
      {
        fallback:
          'Could not load your deliveries',
      }
    ),

  setStatus: (
    deliveryId,
    status,
    note,
    lat,
    lng
  ) =>
    request(
      `/riders/deliveries/${deliveryId}/status`,
      {
        method: 'PATCH',

        body: {
          status,
          note,
          lat,
          lng,
        },

        fallback:
          'Could not update the delivery',
      }
    ),

  submitProof: (
    deliveryId,
    {
      proofUrl,
      signature,
      recipientName,
      cashCollected,
    } = {}
  ) =>
    request(
      `/riders/deliveries/${deliveryId}/proof`,
      {
        method: 'POST',

        body: {
          proofUrl,
          signature,
          recipientName,
          cashCollected,
        },

        fallback:
          'Could not confirm the delivery',
      }
    ),

  all: () =>
    request(
      '/riders',
      {
        fallback:
          'Could not load riders',
      }
    ),

  updateDispatchProfile: (
    riderId,
    {
      homeHub,
      onDuty,
    } = {}
  ) =>
    request(
      `/riders/${riderId}/dispatch-profile`,
      {
        method: 'PATCH',

        body: {
          homeHub,
          onDuty,
        },

        fallback:
          'Could not save rider dispatch settings',
      }
    ),
};

// ============================================================
// PAYMENTS
// ============================================================

export const paymentsApi = {
  intent: (
    orderId
  ) =>
    request(
      '/payments/intent',
      {
        method: 'POST',
        body: {
          orderId,
        },
        fallback:
          'Could not start payment',
      }
    ),

  method: (
    orderId,
    method,
    proofUrl
  ) =>
    request(
      '/payments/method',
      {
        method: 'POST',

        body: {
          orderId,
          method,
          proofUrl,
        },

        fallback:
          'Could not set the payment method',
      }
    ),

  status: (
    orderId
  ) =>
    request(
      `/payments/${orderId}/status`,
      {
        fallback:
          'Could not check payment status',
      }
    ),

  submitProof: (
    orderId,
    proofUrl
  ) =>
    request(
      `/payments/${orderId}/proof`,
      {
        method: 'POST',

        body: {
          proofUrl,
        },

        fallback:
          'Could not submit your proof of payment',
      }
    ),

  verify: (
    orderId
  ) =>
    request(
      `/payments/${orderId}/verify`,
      {
        method: 'POST',
        fallback:
          'Could not verify this payment',
      }
    ),
};

// ============================================================
// USERS
// ============================================================

export const usersApi = {
  all: () =>
    request(
      '/users',
      {
        fallback:
          'Could not load users',
      }
    ),

  updateRole: (
    userId,
    role
  ) =>
    request(
      `/users/${userId}/role`,
      {
        method: 'PATCH',

        body: {
          role,
        },

        fallback:
          'Could not update user role',
      }
    ),

  delete: (
    userId
  ) =>
    request(
      `/users/${userId}`,
      {
        method: 'DELETE',
        fallback:
          'Could not delete user',
      }
    ),

  updateMe: (
    patch
  ) =>
    request(
      '/users/me',
      {
        method: 'PATCH',
        body: patch,
        fallback:
          'Could not save your details',
      }
    ),

  saveProfile: (
    patch
  ) =>
    request(
      '/users/me/profile',
      {
        method: 'PATCH',
        body: patch,
        fallback:
          'Could not save your details',
      }
    ),

  addresses: () =>
    request(
      '/users/me/addresses',
      {
        fallback:
          'Could not load your addresses',
      }
    ),

  addAddress: (
    payload
  ) =>
    request(
      '/users/me/addresses',
      {
        method: 'POST',
        body: payload,
        fallback:
          'Could not add that address',
      }
    ),

  updateAddress: (
    addressId,
    payload
  ) =>
    request(
      `/users/me/addresses/${addressId}`,
      {
        method: 'PATCH',
        body: payload,
        fallback:
          'Could not update that address',
      }
    ),

  setDefaultAddress: (
    addressId
  ) =>
    request(
      `/users/me/addresses/${addressId}/default`,
      {
        method: 'POST',
        fallback:
          'Could not set the default address',
      }
    ),

  removeAddress: (
    addressId
  ) =>
    request(
      `/users/me/addresses/${addressId}`,
      {
        method: 'DELETE',
        fallback:
          'Could not remove that address',
      }
    ),
};