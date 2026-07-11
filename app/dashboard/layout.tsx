import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Aria Demo Dashboard — Flowgentic × CSA',
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return children
}
