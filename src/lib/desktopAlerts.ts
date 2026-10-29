// Optional desktop (OS) notifications for when the app is in a background tab.
// Uses the browser Notification API — no push server needed. People opt in from
// the notifications panel; the choice is remembered per browser.

const PREF_KEY = 'pwc.desktopAlerts'

export type DesktopAlertState = 'unsupported' | 'off' | 'on' | 'blocked'

export function desktopAlertState(): DesktopAlertState {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported'
  if (Notification.permission === 'denied') return 'blocked'
  if (Notification.permission !== 'granted') return 'off'
  try {
    return localStorage.getItem(PREF_KEY) === 'off' ? 'off' : 'on'
  } catch {
    return 'on'
  }
}

export async function enableDesktopAlerts(): Promise<DesktopAlertState> {
  if (!('Notification' in window)) return 'unsupported'
  const result = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()
  try {
    localStorage.setItem(PREF_KEY, result === 'granted' ? 'on' : 'off')
  } catch {
    /* preference is a convenience */
  }
  return desktopAlertState()
}

export function disableDesktopAlerts(): DesktopAlertState {
  try {
    localStorage.setItem(PREF_KEY, 'off')
  } catch {
    /* preference is a convenience */
  }
  return desktopAlertState()
}

/** Show an OS notification if enabled and the app isn't currently in view. */
export function desktopAlert(title: string, body: string, tag: string, onClick: () => void): void {
  if (desktopAlertState() !== 'on' || document.visibilityState === 'visible') return
  try {
    const n = new Notification(title, { body, tag, icon: `${import.meta.env.BASE_URL}favicon.png` })
    n.onclick = () => {
      window.focus()
      onClick()
      n.close()
    }
  } catch {
    /* some browsers only allow notifications from a service worker */
  }
}
