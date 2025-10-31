import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { DarkModeToggle } from "@/components/DarkModeToggle";
import { StatusBadge } from "@/components/StatusBadge";
import ToasterClient from "@/components/ToasterClient";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Pooleno Trading App",
  description: "Live trading micro-app with real-time order book and price charts",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                const theme = localStorage.getItem('theme') || 
                  (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
                document.documentElement.classList.remove('light', 'dark');
                document.documentElement.classList.add(theme);
              } catch (e) {
                // Fallback to dark theme if localStorage is not available
                document.documentElement.classList.add('dark');
              }
            `,
          }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ThemeProvider>
          <div className="min-h-screen dark-mode-bg dark-mode-text">
            <ToasterClient />
            {/* Header */}
            <header className="dark-mode-bg-secondary border-b dark-mode-border">
              <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex items-center justify-between h-16">
                  <div className="flex items-center space-x-4">
                    <h1 className="text-xl font-bold dark-mode-text">Pooleno Trading</h1>
                    <div className="text-sm dark-mode-text-secondary">BTC/USDT</div>
                  </div>

                  <div className="flex items-center space-x-4">
                    <DarkModeToggle />
                    <StatusBadge />
                  </div>
                </div>
              </div>
            </header>
            {children}
          </div>
        </ThemeProvider>

      </body>
    </html>
  );
}
