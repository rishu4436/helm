import './globals.css'
import type { Metadata } from 'next'
import { Nav } from './components'

export const metadata: Metadata = { title: 'HELM — Universal trading command center for Even G2', description: 'One interface. Every supported exchange. Hands-free trading on Even Realities G2.' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <Nav />
        <main className="mx-auto max-w-6xl px-5 pb-24">{children}</main>
      </body>
    </html>
  )
}
