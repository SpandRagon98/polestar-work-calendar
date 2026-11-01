// What you see while dragging an event's side handle across days: a copy of the
// event unrolls into each new day at its own time, days about to be dropped dim,
// and a label says what you will get. The copies stay until the save has finished,
// so the real events replace them without a gap.

import { DateTime } from 'luxon'
import { EASE_OUT } from './calendarMotion'
import { motionLevel } from './motion'

export interface StretchPreview {
  update(hover: string): void
  /** End the drag; the preview stays until `until` settles. */
  finish(until?: Promise<unknown>): void
}

export function startStretchPreview(source: HTMLElement | null, side: 'left' | 'right', first: string, last: string, taskId: string): StretchPreview {
  const root = source?.closest<HTMLElement>('.fc-timegrid-body')
  if (!source || !root) return { update() {}, finish() {} }

  const level = motionLevel()
  const box = root.getBoundingClientRect()
  const event = source.getBoundingClientRect()
  const top = event.top - box.top
  const columns = [...root.querySelectorAll<HTMLElement>('.fc-timegrid-col[data-date]')]

  const layer = document.createElement('div')
  layer.className = 'pw-stretch-layer'
  const label = document.createElement('div')
  label.className = 'pw-stretch-label'
  layer.appendChild(label)
  root.appendChild(layer)

  const template = source.querySelector('.pw-event-body')?.cloneNode(true) as HTMLElement | undefined
  template?.querySelectorAll('.pw-span-handle').forEach((h) => h.remove())

  const ghosts = new Map<string, HTMLElement>()

  const addGhost = (column: HTMLElement) => {
    const rect = column.getBoundingClientRect()
    const ghost = document.createElement('div')
    ghost.className = 'pw-stretch-ghost'
    ghost.style.cssText = `left:${rect.left - box.left + 3}px;top:${top}px;width:${rect.width - 9}px;height:${event.height}px`
    if (template) ghost.appendChild(template.cloneNode(true))
    layer.appendChild(ghost)
    ghosts.set(column.dataset.date!, ghost)
    if (level === 'off' || !ghost.animate) return
    ghost.animate(
      [
        { opacity: 0, transformOrigin: side === 'right' ? 'left center' : 'right center', transform: level === 'full' ? 'scaleX(0.5)' : 'none' },
        { opacity: 1, transformOrigin: side === 'right' ? 'left center' : 'right center', transform: 'none' },
      ],
      { duration: level === 'full' ? 240 : 130, easing: EASE_OUT },
    )
  }

  const fadeGhost = (ghost: HTMLElement) => {
    if (level === 'off' || !ghost.animate) return ghost.remove()
    ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 130, easing: 'ease-out', fill: 'forwards' }).onfinish = () => ghost.remove()
  }

  const segments = (date: string) => root.querySelectorAll<HTMLElement>(`[data-eid="${taskId}:${date}"]`)
  const short = (d: string) => DateTime.fromISO(d).toFormat('ccc d')

  return {
    update(hover) {
      const from = side === 'left' ? (hover < last ? hover : last) : first
      const to = side === 'right' ? (hover > first ? hover : first) : last
      for (const column of columns) {
        const date = column.dataset.date!
        const inRange = date >= from && date <= to
        const existing = date >= first && date <= last
        column.classList.toggle('pw-span-preview', inRange && !existing)
        segments(date).forEach((s) => s.classList.toggle('pw-slot-dropping', existing && !inRange))
        const ghost = ghosts.get(date)
        if (inRange && !existing && !ghost) addGhost(column)
        else if (ghost && !inRange) {
          ghosts.delete(date)
          fadeGhost(ghost)
        }
      }
      const days = Math.round(DateTime.fromISO(to).diff(DateTime.fromISO(from), 'days').days) + 1
      const changed = from !== first || to !== last
      label.textContent = days === 1 ? `One day · ${short(from)}` : `${days} days · ${short(from)} – ${short(to)}`
      label.classList.toggle('pw-on', changed)
      const edge = columns.find((c) => c.dataset.date === (side === 'right' ? to : from))
      if (edge) {
        const rect = edge.getBoundingClientRect()
        label.style.transform = `translate(${Math.max(4, rect.left - box.left + 3)}px, ${Math.max(4, top - 30)}px)`
      }
    },
    finish(until) {
      label.classList.remove('pw-on')
      for (const column of columns) column.classList.remove('pw-span-preview')
      const clear = () => {
        root.querySelectorAll<HTMLElement>('.pw-slot-dropping').forEach((s) => s.classList.remove('pw-slot-dropping'))
        ghosts.forEach(fadeGhost)
        ghosts.clear()
        window.setTimeout(() => layer.remove(), 200)
      }
      if (until) void until.finally(clear)
      else clear()
    },
  }
}
