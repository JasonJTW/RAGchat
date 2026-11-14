import { ClerkProvider, SignIn, UserButton } from "@clerk/nextjs";
import { Suspense, type ReactNode } from "react";
import { clerkConfigured, stubAuth } from "@/lib/auth-mode";

// The one place the web app touches Clerk's components. With stub sign-in
// (tests, E2E) or without Clerk keys they render plain stand-ins.

/** Wraps the app in Clerk's provider when Clerk is in use. */
export function AuthProvider({ children }: { children: ReactNode }) {
  if (stubAuth() || !clerkConfigured()) return children;
  return (
    <ClerkProvider signInUrl="/sign-in" afterSignOutUrl="/sign-in">
      {children}
    </ClerkProvider>
  );
}

/** The signed-in user's account menu (sign out, profile). */
export function AccountMenu() {
  if (stubAuth() || !clerkConfigured()) return null;
  return <UserButton />;
}

/** The sign-in form (Google, via Clerk). */
export function SignInForm() {
  if (stubAuth()) return <p>測試模式：以測試用的 stub_session cookie 登入。</p>;
  if (!clerkConfigured())
    return (
      <p role="alert">
        登入尚未設定：請在 .env 設定 NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY 與
        CLERK_SECRET_KEY。
      </p>
    );
  // SignIn reads the URL, which Next.js only allows inside Suspense.
  return (
    <Suspense>
      <SignIn />
    </Suspense>
  );
}
