import React from 'react';
import type { Metadata, Viewport } from 'next';
import { JetBrains_Mono, Rajdhani, Manrope, Syncopate } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';
import { APP_WINDOW_TITLE } from '@/lib/app-version';

const jetbrainsMono = JetBrains_Mono({ 
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});

const rajdhani = Rajdhani({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-rajdhani',
  display: 'swap',
});

const manrope = Manrope({
  subsets: ['latin'],
  variable: '--font-manrope',
  display: 'swap',
});

const syncopate = Syncopate({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-syncopate',
  display: 'swap',
});

export const metadata: Metadata = {
  title: APP_WINDOW_TITLE,
  description: 'AI Audio Extraction Studio — isolate vocals, instruments, drums, and more with professional-grade AI models',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${jetbrainsMono.variable} ${rajdhani.variable} ${manrope.variable} ${syncopate.variable}`}>
       <body className="font-mono bg-slate-950 text-slate-200 antialiased overflow-hidden">
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
