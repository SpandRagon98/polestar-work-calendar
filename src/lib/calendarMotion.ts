// Motion for events on the calendar. FullCalendar rebuilds event elements whenever
// the event list changes, so nothing can simply transition. Instead (FLIP): measure
// where each event is just before the update, then start the new element from that
// spot and let it glide home, using transform and opacity only. Added events scale
// in, removed ones fade from where they were, and a dropped event settles with a
// small spring. Lite plays the same motion, only shorter.

import { motionLevel } from './motion'

export const EASE_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)'
const SPRING = 'cubic-bezier(0.34, 1.56, 0.64, 1)'
const QUIET_AFTER_NAV_MS = 700
const QUIET_AFTER_START_MS = 1000
const MAX_ANIMATED = 80

const taskOf = (eventId: string) => eventId.split(':')[0]

export function createEventMotion(host: () => HTMLElement | null | undefined) {
  const live = new Map<string, HTMLElement>()
  const removed = new Map<string, Node>()
  const settling = new Set<string>()
  const handled = new Set<string>()
  const startedAt = performance.now()
  let before: Map<string, DOMRect> | null = null
  let lastNav = -Infinity

  const speed = () => (motionLevel() === 'full' ? 1 : 0.6)
  const quiet = () => motionLevel() === 'off' || performance.now() - lastNav < QUIET_AFTER_NAV_MS

  /** Let an event crossing columns pass over the others on its way. */
  const raise = (el: HTMLElement, anim: Animation) => {
    const column = el.closest<HTMLElement>('.fc-timegrid-col-events')
    if (!column) return
    column.style.zIndex = '5'
    anim.onfinish = anim.oncancel = () => column.style.removeProperty('z-index')
  }

  const glide = (el: HTMLElement, from: DOMRect, to: DOMRect) => {
    const dx = from.left - to.left
    const dy = from.top - to.top
    const sx = from.width / to.width
    const sy = from.height / to.height
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01) return
    // Text looks wrong when stretched a lot: then glide at the final size.
    const size = sx > 0.5 && sx < 2 && sy > 0.5 && sy < 2 ? ` scale(${sx}, ${sy})` : ''
    raise(
      el,
      el.animate(
        [
          { transformOrigin: '0 0', transform: `translate(${dx}px, ${dy}px)${size}` },
          { transformOrigin: '0 0', transform: 'none' },
        ],
        { duration: 340 * speed(), easing: EASE_OUT },
      ),
    )
  }

  const enter = (el: HTMLElement) => {
    el.animate(
      [
        { opacity: 0, transform: 'scale(0.9)' },
        { opacity: 1, transform: 'none' },
      ],
      { duration: 300 * speed(), easing: EASE_OUT },
    )
  }

  const leave = (node: Node, rect: DOMRect) => {
    const parent = host()
    if (!parent || !rect.width) return
    const box = parent.getBoundingClientRect()
    const el = node as HTMLElement
    el.style.cssText = `position:absolute;left:${rect.left - box.left}px;top:${rect.top - box.top}px;width:${rect.width}px;height:${rect.height}px;margin:0;z-index:6;pointer-events:none`
    parent.appendChild(el)
    el.animate(
      [
        { opacity: 1, transform: 'none' },
        { opacity: 0, transform: 'scale(0.92)' },
      ],
      { duration: 200 * speed(), easing: 'ease-in', fill: 'forwards' },
    ).onfinish = () => el.remove()
  }

  return {
    register(id: string, el: HTMLElement) {
      live.set(id, el)
    },
    unregister(id: string, el: HTMLElement) {
      if (live.get(id) !== el) return
      live.delete(id)
      if (before?.has(id)) removed.set(id, el.cloneNode(true))
    },
    noteNavigation() {
      lastNav = performance.now()
    },
    /** Call just before the event list changes. */
    capture() {
      removed.clear()
      handled.clear()
      if (motionLevel() === 'off' || live.size > MAX_ANIMATED) {
        before = null
        return
      }
      before = new Map()
      for (const [id, el] of live) before.set(id, el.getBoundingClientRect())
    },
    /** Call after the change: `last` is the final pass, once FullCalendar has drawn. */
    play(last: boolean) {
      if (!before) return
      if (!el_animatable(live)) {
        before = null
        return
      }
      const still = quiet()
      if (!still) {
        for (const [id, el] of live) {
          if (handled.has(id)) continue
          const from = before.get(id)
          const to = el.getBoundingClientRect()
          if (!to.width) continue
          if (from) {
            if (from.width && (from.left !== to.left || from.top !== to.top || from.width !== to.width || from.height !== to.height)) {
              handled.add(id)
              glide(el, from, to)
            }
          } else if (performance.now() - startedAt > QUIET_AFTER_START_MS) {
            handled.add(id)
            enter(el)
          }
        }
      }
      if (!last) return
      if (!still) {
        for (const [id, node] of removed) {
          if (!live.has(id)) leave(node, before.get(id)!)
        }
        for (const [id, el] of live) {
          if (settling.has(taskOf(id)) && !handled.has(id)) {
            el.animate([{ transform: 'scale(1.035)' }, { transform: 'none' }], { duration: 320 * speed(), easing: SPRING })
          }
        }
      }
      settling.clear()
      removed.clear()
      handled.clear()
      before = null
    },
    /** The next update of this task is the result of a drop: play the settle. */
    settle(taskId: string) {
      settling.add(taskId)
    },
    /** A move could not be saved and snapped back. */
    shake(taskId: string) {
      settling.delete(taskId)
      if (motionLevel() === 'off') return
      for (const [id, el] of live) {
        if (taskOf(id) !== taskId || !el.animate) continue
        el.animate(
          [{ transform: 'none' }, { transform: 'translateX(-5px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(-2px)' }, { transform: 'none' }],
          { duration: 320, easing: 'ease-out' },
        )
      }
    },
  }
}

/** Test environments have no Web Animations API. */
function el_animatable(live: Map<string, HTMLElement>): boolean {
  const first = live.values().next().value
  return !first || typeof first.animate === 'function'
}
