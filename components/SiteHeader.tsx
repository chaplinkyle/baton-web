"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BatonLogo } from "./BatonLogo";
import { WalletButton } from "./WalletButton";

export function SiteHeader() {
  const pathname = usePathname();
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link className="brand" href="/" aria-label="Baton home">
          <BatonLogo className="brand-mark" />
          <span className="brand-wordmark">Baton</span>
        </Link>
        <nav aria-label="Primary navigation">
          {[["/plans", "My plans"], ["/how-it-works", "How it works"], ["/verify", "Verify a plan"], ["/risks", "Safety"]].map(([href, label]) => (
            <Link key={href} href={href} aria-current={pathname === href ? "page" : undefined}>{label}</Link>
          ))}
        </nav>
        <WalletButton />
      </div>
    </header>
  );
}
