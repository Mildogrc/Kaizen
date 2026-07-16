'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV = [
  { href: '/', label: 'Dashboard', glyph: '◧' },
  { href: '/japanese', label: 'Japanese', glyph: '日' },
  { href: '/chinese', label: 'Chinese', glyph: '中' },
  { href: '/math', label: 'Math', glyph: '∑' },
  { href: '/skills', label: 'Random Skills', glyph: '⌨' },
  { href: '/books', label: 'Books', glyph: '⌘' },
  { href: '/schemas', label: 'Schema Designer', glyph: '⬡' },
  { href: '/daily', label: 'Daily Study', glyph: '☀' },
  { href: '/review', label: 'Review', glyph: '↻' },
  { href: '/import', label: 'Import', glyph: '⇥' },
  { href: '/analytics', label: 'Analytics', glyph: '∿' },
  { href: '/settings', label: 'Settings', glyph: '⚙' },
];

export function SideNav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-0.5 px-2">
      {NAV.map((item) => {
        const active =
          item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] transition-colors ${
              active
                ? 'bg-surface-2 text-foreground font-medium'
                : 'text-muted hover:bg-surface-2/60 hover:text-foreground'
            }`}
          >
            <span className="w-4 text-center text-xs opacity-70">{item.glyph}</span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
