import { clerkMiddleware } from "@clerk/nextjs/server";
import {
  NextResponse,
  type NextFetchEvent,
  type NextRequest,
} from "next/server";
import {
  clerkConfigured,
  STUB_SESSION_COOKIE,
  stubAuth,
} from "@/lib/auth-mode";

// Pages need a signed-in user; /sign-in is open. /api/* is passed through to
// the Express server, which decides every API call itself (401/403).
const isOpen = (req: NextRequest) =>
  /^\/(sign-in|api)(\/|$)/.test(req.nextUrl.pathname);

const clerk = clerkMiddleware(
  async (auth, req) => {
    if (!isOpen(req)) await auth.protect();
  },
  { signInUrl: "/sign-in" },
);

function signIn(req: NextRequest) {
  return NextResponse.redirect(new URL("/sign-in", req.url));
}

export default function proxy(req: NextRequest, event: NextFetchEvent) {
  if (stubAuth())
    return isOpen(req) || req.cookies.has(STUB_SESSION_COOKIE)
      ? NextResponse.next()
      : signIn(req);
  if (clerkConfigured()) return clerk(req, event);
  // Without Clerk keys nobody can sign in: every page leads to /sign-in,
  // which says so.
  return isOpen(req) ? NextResponse.next() : signIn(req);
}

export const config = {
  matcher: [
    // Skip Next.js internals and static files.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
