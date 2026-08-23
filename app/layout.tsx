import type { Metadata } from 'next'
import { ClerkProvider } from '@clerk/nextjs'
import './globals.css'

export const metadata: Metadata = {
  title: 'FlowgenticTRAK — The agentic AI OS for freight operations',
  description:
    'FlowgenticTRAK tracks land, ocean, and air freight in real time and orchestrates AI agents to do the work — booking tenders, resolving exceptions, collecting invoices, and writing it all back to your TMS.',
}

// Clerk UI inherits the TRAK brand: navy ink, safety-orange actions.
const clerkAppearance = {
  variables: {
    colorPrimary: '#E8590C',
    colorText: '#0F1F33',
    colorTextSecondary: '#46586C',
    colorBackground: '#FFFFFF',
    colorInputBackground: '#FFFFFF',
    colorInputText: '#0F1F33',
    borderRadius: '8px',
    fontFamily: "'Plus Jakarta Sans', system-ui, -apple-system, 'Segoe UI', sans-serif",
  },
  elements: {
    card: { boxShadow: '0 12px 32px -16px rgba(15, 31, 51, 0.18)', border: '1px solid #E3E9F0' },
    formButtonPrimary: { fontWeight: 600, textTransform: 'none' as const },
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider
      appearance={clerkAppearance}
      signInUrl="/signin"
      signUpUrl="/signup"
      signInFallbackRedirectUrl="/dashboard"
      signUpFallbackRedirectUrl="/dashboard"
      afterSignOutUrl="/"
    >
      <html lang="en" suppressHydrationWarning>
        <body>{children}</body>
      </html>
    </ClerkProvider>
  )
}
