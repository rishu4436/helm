export function HelmMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden>
      <circle cx="20" cy="20" r="12" fill="none" stroke="var(--color-amber-helm)" strokeWidth="3" />
      {Array.from({ length: 8 }).map((_, i) => {
        const a = (Math.PI / 4) * i
        return <line key={i} x1={20 + Math.cos(a) * 4} y1={20 + Math.sin(a) * 4} x2={20 + Math.cos(a) * 18} y2={20 + Math.sin(a) * 18} stroke="var(--color-amber-helm)" strokeWidth="2.5" strokeLinecap="round" />
      })}
      <circle cx="20" cy="20" r="3.5" fill="var(--color-amber-helm)" />
    </svg>
  )
}
