import { useId } from 'react'

export interface LogoProps {
  className?: string
}

/**
 * The Codox logo, inlined as SVG so it renders crisp at any size and
 * needs no asset fetch. Same artwork as public/logo.svg (the favicon and
 * the source every raster icon is generated from). Gradient/filter ids
 * are namespaced per instance so repeated logos never collide.
 */
export function Logo({ className }: LogoProps) {
  const uid = useId()
  const night = `${uid}-night`
  const beam = `${uid}-beam`
  const glow = `${uid}-glow`

  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 512 512"
    >
      <defs>
        <linearGradient id={night} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#1b2559" />
          <stop offset="1" stopColor="#0a0f2e" />
        </linearGradient>
        <linearGradient id={beam} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#22d3ee" />
          <stop offset="0.5" stopColor="#a78bfa" />
          <stop offset="1" stopColor="#f472b6" />
        </linearGradient>
        <filter height="220%" id={glow} width="220%" x="-60%" y="-60%">
          <feGaussianBlur stdDeviation="14" />
        </filter>
      </defs>
      <rect fill={`url(#${night})`} height="512" width="512" />
      <rect fill="#ffffff" height="264" rx="18" width="200" x="156" y="76" />
      <rect fill="#c7cdf0" height="16" rx="8" width="110" x="184" y="112" />
      <rect fill="#c7cdf0" height="16" rx="8" width="144" x="184" y="144" />
      <rect fill="#c7cdf0" height="16" rx="8" width="96" x="184" y="176" />
      <rect fill="#22d3ee" height="18" rx="9" width="42" x="184" y="264" />
      <rect fill="#a78bfa" height="18" rx="9" width="42" x="236" y="264" />
      <rect fill="#f472b6" height="18" rx="9" width="42" x="288" y="264" />
      <rect
        fill={`url(#${beam})`}
        filter={`url(#${glow})`}
        height="40"
        opacity="0.7"
        rx="20"
        width="280"
        x="116"
        y="212"
      />
      <rect fill={`url(#${beam})`} height="40" rx="20" width="280" x="116" y="212" />
      <rect fill="#22d3ee" height="52" rx="13" width="52" x="164" y="384" />
      <rect fill="#a78bfa" height="52" rx="13" width="52" x="230" y="384" />
      <rect fill="#f472b6" height="52" rx="13" width="52" x="296" y="384" />
      <path d="M 420 108 l 7 18 l 18 7 l -18 7 l -7 18 l -7 -18 l -18 -7 l 18 -7 z" fill="#22d3ee" />
      <path d="M 96 340 l 6 15 l 15 6 l -15 6 l -6 15 l -6 -15 l -15 -6 l 15 -6 z" fill="#f472b6" />
    </svg>
  )
}
