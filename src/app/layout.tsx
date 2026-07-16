import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { SideNav } from '@/components/nav';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Hyperlearning',
  description: 'Personal long-term learning system',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full">
        <div className="flex min-h-screen">
          <aside className="fixed inset-y-0 left-0 flex w-52 flex-col border-r border-line bg-surface py-4">
            <div className="mb-4 px-4">
              <div className="text-[15px] font-semibold tracking-tight">Hyperlearning</div>
              <div className="text-[11px] text-muted">改善 · long-term training</div>
            </div>
            <SideNav />
          </aside>
          <main className="ml-52 min-w-0 flex-1 px-8 py-6">
            <div className="mx-auto max-w-6xl">{children}</div>
          </main>
        </div>
      </body>
    </html>
  );
}
