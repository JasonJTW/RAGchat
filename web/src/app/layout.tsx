import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { AccountMenu, AuthProvider } from "@/components/auth";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "大量交織團隊 wiki",
  description: "大量交織團隊的共享知識庫",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="zh-Hant"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <AuthProvider>
          <header className="mx-auto flex w-full max-w-3xl items-center justify-end gap-4 px-4 pt-4 text-sm">
            <Link href="/">對話</Link>
            <AccountMenu />
          </header>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
