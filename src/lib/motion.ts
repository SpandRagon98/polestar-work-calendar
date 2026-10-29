// How much animation the app uses. Smooth motion depends on the browser drawing
// with the graphics processor; when it can't (graphics acceleration off, or a
// software renderer), large shadows, fades and slides are painted by the CPU and
// stutter. "Lite" keeps short opacity fades and drops the expensive effects.
//
//   full — every animation
//   lite — quick fades only: no slides, scaling, lifting or calendar glides
//   off  — no animation (also used when the OS asks for reduced motion)

export type MotionPref = 'auto' | 'full' | 'lite' | 'off'
export type MotionLevel = 'full' | 'lite' | 'off'

const KEY = 'pwc.motion'

export function readMotionPref(): MotionPref {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'full' || v === 'lite' || v === 'off' ? v : 'auto'
  } catch {
    return 'auto'
  }
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

export function resolveMotion(pref: MotionPref = readMotionPref()): MotionLevel {
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return 'off'
  if (pref !== 'auto') return pref
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
  try {
    if (pref === 'auto') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, pref)
  } catch {
    /* preference is a convenience */
  }
  return applyMotion(pref)
}

export function motionLevel(): MotionLevel {
  return current
}
