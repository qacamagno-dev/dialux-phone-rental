// ============================================================
// DiaLux — browser notification bridge
//
// The database notification bell remains the source of truth. While a DiaLux
// tab is open, page.js polls that bell and this module mirrors newly-arrived
// unread rows into the browser Notification API after the user opts in.
// No third-party push provider or paid service is required.
// ============================================================

const ENABLED_KEY = 'dialux_browser_alerts';
let knownIds = new Set();

export function browserNotificationsSupported() {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function browserNotificationsEnabled() {
  return browserNotificationsSupported()
    && Notification.permission === 'granted'
    && localStorage.getItem(ENABLED_KEY) === '1';
}

export function browserNotificationState() {
  if (!browserNotificationsSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  if (browserNotificationsEnabled()) return 'enabled';
  return 'available';
}

export async function enableBrowserNotifications() {
  if (!browserNotificationsSupported()) {
    return { ok: false, error: 'Browser notifications are not supported on this device.' };
  }

  let permission = Notification.permission;
  if (permission === 'default') permission = await Notification.requestPermission();

  if (permission !== 'granted') {
    localStorage.removeItem(ENABLED_KEY);
    return {
      ok: false,
      error: permission === 'denied'
        ? 'Browser notifications are blocked. Allow them in your browser site settings.'
        : 'Browser notification permission was not granted.',
    };
  }

  localStorage.setItem(ENABLED_KEY, '1');
  return { ok: true };
}

export function disableBrowserNotifications() {
  localStorage.removeItem(ENABLED_KEY);
}

/** Mark already-loaded rows as known so old bell history is never replayed. */
export function seedBrowserNotifications(rows = []) {
  knownIds = new Set(rows.map(n => String(n.id || n._id || '')).filter(Boolean));
}

/**
 * Show browser alerts only for notification rows that were not seen in the
 * previous poll. The alert is a convenience mirror; reading/dismissing still
 * happens through the normal DiaLux bell API.
 */
export function announceNewBrowserNotifications(rows = []) {
  const fresh = [];

  for (const row of rows) {
    const id = String(row.id || row._id || '');
    if (!id) continue;
    if (!knownIds.has(id) && !row.read) fresh.push(row);
    knownIds.add(id);
  }

  if (!browserNotificationsEnabled()) return fresh.length;

  // Oldest first produces a natural sequence if several updates landed
  // between polls.
  fresh.reverse().forEach(row => {
    try {
      const alert = new Notification(row.title || 'DiaLux update', {
        body: row.message || 'You have a new DiaLux notification.',
        icon: '/assets/dialux-logo.png',
        tag: `dialux-${row.id || row._id}`,
      });

      alert.onclick = () => {
        window.focus();
        if (row.link) window.location.href = row.link;
        alert.close();
      };
    } catch (err) {
      console.warn('[DiaLux] browser notification failed:', err.message);
    }
  });

  return fresh.length;
}
