import { describe, expect, it, vi } from 'vitest'
import { isSoftwareRendering, resolveMotion } from '../lib/motion'

describe('motion level', () => {
  it('recognises software renderers', () => {
    expect(isSoftwareRendering('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)')).toBe(true)
    expect(isSoftwareRendering('llvmpipe (LLVM 15.0.7, 256 bits)')).toBe(true)
    expect(isSoftwareRendering('ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11)')).toBe(true)
    expect(isSoftwareRendering('none')).toBe(true)
    expect(isSoftwareRendering('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe(false)
    expect(isSoftwareRendering('ANGLE (NVIDIA, NVIDIA GeForce RTX 3050 Laptop GPU Direct3D11)')).toBe(false)
  })

  it('honours an explicit choice', () => {
    expect(resolveMotion('lite')).toBe('lite')
    expect(resolveMotion('off')).toBe('off')
    expect(resolveMotion('full')).toBe('full')
  })

  it('uses gentle fades for OS reduced motion in auto, and an explicit choice overrides it', () => {
    vi.stubGlobal('window', { matchMedia: (q: string) => ({ matches: q.includes('reduce') }) as MediaQueryList })
    try {
      expect(resolveMotion('auto')).toBe('lite')
      expect(resolveMotion('full')).toBe('full')
      expect(resolveMotion('lite')).toBe('lite')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
