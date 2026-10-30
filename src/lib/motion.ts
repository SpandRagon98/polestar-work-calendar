// How much animation the app uses. Smooth motion depends on the browser drawing
// with the graphics processor and running scripts quickly; on locked-down or
// low-powered machines (graphics acceleration off, Edge "enhanced security" which
// disables the JavaScript JIT, remote desktops) slides, scaling and soft shadows
// stutter. "Lite" keeps short opacity fades and drops the expensive effects.
//
//   full — every animation
//   lite — quick fades only: no slides, scaling, lifting or calendar glides
//   off  — no animation
//
// "Auto" follows the OS reduced-motion setting by using Lite (fades only) (Windows: Settings › Accessibility ›
// Visual effects › Animation effects). An explicit choice overrides it, so someone
// whose machine has animations turned off can still opt back in.
//
// With "auto" the app starts from what it can detect up front, then keeps
// measuring real animations and settles on Lite if this device keeps dropping
// frames (remembered per browser).

export type MotionPref = 'auto' | 'full' | 'lite' | 'off'
export type MotionLevel = 'full' | 'lite' | 'off'

const KEY = 'pwc.motion'
const LEARNED_KEY = 'pwc.motion.learned'

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    /* preferences are a convenience */
  }
}

export function readMotionPref(): MotionPref {
  const v = read(KEY)
  return v === 'full' || v === 'lite' || v === 'off' ? v : 'auto'
}

/** True when Auto has learned (from measured frames) that this device needs Lite. */
export function learnedLite(): boolean {
  return read(LEARNED_KEY) === 'lite'
}

/** The WebGL renderer name, e.g. "ANGLE (Intel, Intel(R) UHD Graphics …)" or "SwiftShader". */
export function graphicsRenderer(): string {
  try {
    const canvas = document.createElement('canvas')
    const gl = (canvas.getContext('webgl') ?? canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null
    if (!gl) return 'none'
    const info = gl.getExtension('WEBGL_debug_renderer_info')
    const name = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return String(name ?? 'unknown')
  } catch {
    return 'unknown'
  }
}

/** True when the browser is drawing without a graphics processor. */
export function isSoftwareRendering(renderer = graphicsRenderer()): boolean {
  return renderer === 'none' || /swiftshader|llvmpipe|softpipe|software|basic render driver|mesa offscreen/i.test(renderer)
}

/**
 * True when the OS asks apps to reduce motion — e.g. Windows "Animation effects"
 * off, common on office laptops and remote desktop sessions.
 */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

export function resolveMotion(pref: MotionPref = readMotionPref()): MotionLevel {
  // An explicit choice always wins.
  if (pref !== 'auto') return pref
  // Reduced motion: keep gentle fades (no sliding, scaling or gliding) rather than none.
  if (prefersReducedMotion()) return 'lite'
  if (learnedLite()) return 'lite'
  if (isSoftwareRendering()) return 'lite'
  // Very small machines: few cores and little memory.
  const nav = navigator as Navigator & { deviceMemory?: number }
  if ((nav.hardwareConcurrency ?? 8) <= 2 || (nav.deviceMemory ?? 8) <= 2) return 'lite'
  return 'full'
}

let current: MotionLevel = 'full'

/** Apply the motion level to <html data-motion="…"> (CSS keys off it). */
export function applyMotion(pref: MotionPref = readMotionPref()): MotionLevel {
  current = resolveMotion(pref)
  document.documentElement.dataset.motion = current
  return current
}

export function setMotionPref(pref: MotionPref): MotionLevel {
  write(KEY, pref === 'auto' ? null : pref)
  // Choosing Auto again means "measure afresh".
  if (pref === 'auto') write(LEARNED_KEY, null)
  return applyMotion(pref)
}

export function motionLevel(): MotionLevel {
  return current
}

// ── Measuring ──────────────────────────────────────────────────────────────

export interface FrameStats {
  frames: number
  fps: number
  /** Share of frames that took over 25 ms (a visible stutter at 60 Hz). */
  slowRatio: number
  worstMs: number
}

/** Frame timings for the next `ms` milliseconds. Null if the tab was hidden or throttled. */
export function sampleFrames(ms: number): Promise<FrameStats | null> {
  return new Promise((resolve) => {
    const times: number[] = []
    const start = performance.now()
    const tick = (t: number) => {
      times.push(t)
      if (t - start < ms) requestAnimationFrame(tick)
      else {
        const d = times.slice(1).map((x, i) => x - times[i])
        // Background tabs pause rAF for long stretches — not a real measurement.
        if (document.visibilityState !== 'visible' || d.length < 4 || Math.max(...d) > 400) return resolve(null)
        const total = d.reduce((a, b) => a + b, 0)
        resolve({
          frames: d.length,
          fps: Math.round((d.length / total) * 1000),
          slowRatio: d.filter((x) => x > 25).length / d.length,
          worstMs: Math.round(Math.max(...d)),
        })
      }
    }
    requestAnimationFrame(tick)
  })
}

/**
 * Rough script speed: milliseconds for a fixed chunk of typical UI work (object
 * building, string work, sorting). ~5–15 ms on a normal laptop; several times
 * more when the JIT is disabled (Edge enhanced security) or the CPU is throttled.
 */
export function scriptSpeedMs(): number {
  const t0 = performance.now()
  let acc = 0
  for (let r = 0; r < 4; r++) {
    const rows = Array.from({ length: 4000 }, (_, i) => ({ id: `t${i}`, v: (i * 7919) % 1000, s: `task ${i}` }))
    rows.sort((a, b) => a.v - b.v || a.s.localeCompare(b.s))
    acc += rows.filter((x) => x.v % 3 === 0).map((x) => x.s.length).reduce((a, b) => a + b, 0)
  }
  if (acc < 0) console.log(acc) // keep the work from being optimised away
  return Math.round(performance.now() - t0)
}

/**
 * Watch real animations (dialogs, panels, popovers) while the app is used. If,
 * after the first couple (which include one-off setup work), most of them stutter,
 * switch Auto to Lite, remember it, and tell the caller once.
 */
export function startSmoothnessMonitor(onDowngrade: () => void): () => void {
  if (readMotionPref() !== 'auto' || current !== 'full' || typeof document === 'undefined') return () => {}
  let seen = 0
  let sampling = false
  const results: number[] = []
  const onStart = (e: AnimationEvent) => {
    if (!e.animationName.startsWith('pw-') || sampling || current !== 'full') return
    seen += 1
    if (seen <= 2) return
    sampling = true
    void sampleFrames(320).then((s) => {
      sampling = false
      if (!s) return
      results.push(s.slowRatio)
      const recent = results.slice(-6)
      const stuttery = recent.filter((r) => r > 0.25).length
      if (recent.length >= 4 && stuttery / recent.length >= 0.6) {
        write(LEARNED_KEY, 'lite')
        applyMotion('auto')
        document.removeEventListener('animationstart', onStart)
        onDowngrade()
      }
    })
  }
  document.addEventListener('animationstart', onStart)
  return () => document.removeEventListener('animationstart', onStart)
}
