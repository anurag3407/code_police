import type { Metadata } from "next";
import { Inter, Space_Grotesk, Syne, JetBrains_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { dark } from "@clerk/themes";
import { Toaster } from "sonner";
import { Providers } from "./providers";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: 'swap',
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  display: 'swap',
});

const syne = Syne({
  variable: "--font-syne",
  subsets: ["latin"],
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  display: 'swap',
});

export const metadata: Metadata = {
  title: "Code-Police - AI-Powered Code Police",
  description: "AI-powered code review agent. Automated security scanning, performance analysis, and auto-fix PRs for your GitHub repositories.",
  keywords: ["code review", "AI agent", "code police", "security scanning", "auto-fix", "GitHub"],
  authors: [{ name: "Code-Police Team" }],
  icons: {
    icon: "/zero3.png",
    shortcut: "/zero3.png",
    apple: "/zero3.png",
  },
  openGraph: {
    title: "Code-Police - AI-Powered Code Police",
    description: "AI-powered code review agent. Automated security scanning, performance analysis, and auto-fix PRs.",
    type: "website",
  },
};

/**
 * Root Layout with Clerk Authentication
 * ClerkProvider wraps the entire app for authentication context.
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider
      signInFallbackRedirectUrl="/dashboard"
      signUpFallbackRedirectUrl="/dashboard"
      appearance={{
        baseTheme: dark,
        variables: {
          colorPrimary: "#8b5cf6",
          colorBackground: "#18181b",
          colorInputBackground: "#27272a",
          colorInputText: "#ffffff",
        },
        elements: {
          formButtonPrimary: "bg-violet-600 hover:bg-violet-700",
          card: "bg-zinc-900 border-zinc-800",
          headerTitle: "text-white",
          headerSubtitle: "text-zinc-400",
          socialButtonsBlockButton: "bg-zinc-800 border-zinc-700 hover:bg-zinc-700",
          formFieldLabel: "text-zinc-300",
          formFieldInput: "bg-zinc-800 border-zinc-700",
          footerActionLink: "text-violet-400 hover:text-violet-300",
        },
      }}
    >
      <html lang="en" suppressHydrationWarning data-scroll-behavior="smooth">
        <body className={`${inter.variable} ${spaceGrotesk.variable} ${syne.variable} ${jetbrainsMono.variable} font-sans antialiased bg-neutral-950 text-white dark:bg-neutral-950 dark:text-white light:bg-white light:text-black`}>
          <Providers>
            {children}
          </Providers>
          <Toaster
            position="bottom-right"
            theme="dark"
            richColors
          />
        </body>
      </html>
    </ClerkProvider>
  );
}
