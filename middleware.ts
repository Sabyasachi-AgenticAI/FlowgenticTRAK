import { clerkMiddleware } from '@clerk/nextjs/server'

// Everything under /dashboard requires a signed-in operator. The landing,
// sign-in, and sign-up pages stay public.
export default clerkMiddleware(
  async (auth, req) => {
    if (req.nextUrl.pathname.startsWith('/dashboard')) {
      await auth.protect()
    }
  },
  // Send unauthenticated visitors to our branded pages, not Clerk's hosted portal.
  { signInUrl: '/signin', signUpUrl: '/signup' },
)

export const config = {
  matcher: [
    // Skip Next.js internals and static assets
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
}
