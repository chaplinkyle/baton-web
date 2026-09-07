"use client";

import { useWallet } from "@/app/providers";
import { shortHash } from "@/lib/product";

export function WalletButton() {
  const wallet = useWallet();

  if (wallet.connection) {
    return (
      <div className="wallet-slot">
        <button className="wallet-button connected" onClick={wallet.disconnect}>
          <span className="status-dot" aria-hidden="true" />
          {shortHash(wallet.connection.address, 7)}
        </button>
      </div>
    );
  }

  return (
    <div className="wallet-slot">
      <button
        className="wallet-button"
        onClick={wallet.connect}
        disabled={wallet.connecting}
      >
        <span className="wallet-glyph" aria-hidden="true">E</span>
        {wallet.connecting ? "Connecting…" : "Connect Eternl"}
      </button>
      {wallet.error && <span className="wallet-error" role="alert">{wallet.error}</span>}
    </div>
  );
}
