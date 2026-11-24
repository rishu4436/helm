'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { getToken } from '@/lib/api'
import { HelmMark } from '../brand'

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  const [authed, setAuthed] = useState(false)
  useEffect(() => { setAuthed(!!getToken()) }, [])
  return (
    <>
      <header className="sticky top-0 z-20 border-b border-graphite-800 bg-graphite-950/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-5">
          <Link href="/" className="flex items-center gap-2 font-semibold tracking-[0.18em]"><HelmMark size={24} /> HELM</Link>
          <nav className="hidden gap-1 text-sm sm:flex">
            <a href="/#demo" className="rounded-md px-3 py-1.5 text-graphite-300 hover:text-graphite-100">Interactive demo</a>
            <a href="/#how" className="rounded-md px-3 py-1.5 text-graphite-300 hover:text-graphite-100">How it works</a>
            <a href="/#safety" className="rounded-md px-3 py-1.5 text-graphite-300 hover:text-graphite-100">Safety</a>
            <a href="/#exchanges" className="rounded-md px-3 py-1.5 text-graphite-300 hover:text-graphite-100">Exchanges</a>
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <span className="pill hidden bg-amber-helm/15 text-amber-helm md:inline" title="Signed requests are restricted to demo, paper and sandbox endpoints">Live trading off</span>
            {authed ? <Link className="btn btn-amber" href="/dashboard">Open dashboard</Link> : <><Link className="btn btn-ghost" href="/login">Sign in</Link><Link className="btn btn-amber" href="/login?mode=register">Get started</Link></>}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-5 pb-24">{children}</main>
      <footer className="border-t border-graphite-800 py-8 text-center text-xs text-graphite-500">HELM hackathon build · demo, paper and sandbox environments only · not financial advice · funds never leave your exchange</footer>
    </>
  )
}
