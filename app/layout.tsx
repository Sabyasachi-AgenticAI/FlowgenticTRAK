import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'FlowgenticTRAK — The agentic AI OS for freight operations',
  description:
    'FlowgenticTRAK tracks land, ocean, and air freight in real time and orchestrates AI agents to do the work — booking tenders, resolving exceptions, collecting invoices, and writing it all back to your TMS.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  )
}
