import type { Metadata } from "next";
import "@fontsource-variable/inter";
import "@fontsource/ibm-plex-mono/400.css";
import "./globals.css";
import { Providers } from "./providers";
import { BatonLogo } from "@/components/BatonLogo";
import { SiteHeader } from "@/components/SiteHeader";

export const metadata: Metadata = {
  metadataBase: new URL("https://baton.kyle770944.chatgpt.site"),
  title: { default: "Baton", template: "%s · Baton" },
  description:
    "Protect Cardano assets while you check in, then make them available through the handoff plan you chose.",
  icons: { icon: "/favicon.svg" },
  openGraph: {
    title: "Baton",
    description: "Keep what matters protected. Pass it on when the time comes.",
  },
  twitter: {
    card: "summary",
    title: "Baton",
    description: "Keep what matters protected. Pass it on when the time comes.",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <a className="skip-link" href="#main-content">Skip to content</a>
          <SiteHeader />
          <main id="main-content" tabIndex={-1}>{children}</main>
          <footer className="site-footer">
            <div className="site-footer-inner">
              <div>
                <span className="brand footer-brand">
                  <BatonLogo className="brand-mark" />
                  <span className="brand-wordmark">Baton</span>
                </span>
                <p>A protected, self-managed handoff plan for Cardano.</p>
              </div>
              <div className="footer-links">
                <a href="/legal/terms">Terms</a>
                <a href="/legal/privacy">Privacy</a>
                <a href="/legal/fees">Fees</a>
                <a href="/risks">Risk disclosure</a>
              </div>
              <p className="footer-warning">
                Software only—not a bank, custodian, will, trust, or proof of death.
              </p>
            </div>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
