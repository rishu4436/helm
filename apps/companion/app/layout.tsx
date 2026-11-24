import './globals.css'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'HELM — Universal trading command center for Even G2', description: 'One interface. Every supported exchange. Hands-free trading on Even Realities G2. Demo and paper environments only.' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  )
}
