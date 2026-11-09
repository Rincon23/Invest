import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { ThemeProvider } from '@/components/providers/ThemeProvider';
import { RegisterServiceWorker } from '@/components/pwa/RegisterServiceWorker';
import { INSTALL_CAPTURE_SCRIPT } from '@/components/pwa/useInstallApp';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Capital + — Orçamento doméstico',
  description:
    'Organize sua renda em categorias e acompanhe quanto ainda pode gastar em cada uma, mês a mês.',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Capital +',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f4f4f6' },
    { media: '(prefers-color-scheme: dark)', color: '#0b0b0d' },
  ],
};

const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('capital:theme');var d=t==='dark'||(t!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches);if(d)document.documentElement.classList.add('dark');}catch(e){}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="pt-BR"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* Applied before hydration to avoid a light/dark flash on load. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        {/* Keeps the browser's install offer for the "Instalar o app" button (it comes only once). */}
        <script dangerouslySetInnerHTML={{ __html: INSTALL_CAPTURE_SCRIPT }} />
      </head>
      <body className="bg-background text-foreground flex min-h-full flex-col">
        <ThemeProvider>
          {children}
          <RegisterServiceWorker />
        </ThemeProvider>
      </body>
    </html>
  );
}
