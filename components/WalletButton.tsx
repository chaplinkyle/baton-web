"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useWallet } from "@/app/providers";
import { CARDANO_NETWORK } from "@/lib/config";
import { cardanoBrowseUri } from "@/lib/eternl";
import { shortHash } from "@/lib/product";

export function WalletButton() {
  const wallet = useWallet();
  const clearWalletError = wallet.clearError;
  const [open, setOpen] = useState(false);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const slotRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const copyResetTimer = useRef<number | null>(null);
  // A request started from Create or My Plans should be just as legible as one
  // started here. Keep the approval guidance visible until Eternl resolves the
  // request so the disabled button never looks like an unexplained spinner.
  const approvalRequested = wallet.connectionActivity === "requesting";
  const panelOpen = open || approvalRequested || Boolean(wallet.error);

  const closePanel = useCallback((restoreFocus = false) => {
    setOpen(false);
    clearWalletError();
    if (restoreFocus) {
      window.requestAnimationFrame(() => buttonRef.current?.focus());
    }
  }, [clearWalletError]);

  useEffect(() => {
    if (!panelOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!slotRef.current?.contains(event.target as Node)) closePanel(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closePanel(true);
      }
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [closePanel, panelOpen]);

  useEffect(() => () => {
    if (copyResetTimer.current) window.clearTimeout(copyResetTimer.current);
  }, []);

  async function copyAddress() {
    if (!wallet.connection) return;
    try {
      await navigator.clipboard.writeText(wallet.connection.address);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
    if (copyResetTimer.current) window.clearTimeout(copyResetTimer.current);
    copyResetTimer.current = window.setTimeout(() => setCopyStatus("idle"), 1_500);
  }

  function openWalletApp() {
    window.location.assign(cardanoBrowseUri(window.location.href));
  }

  const label = wallet.connectionActivity === "requesting"
    ? "Approve in Eternl"
    : wallet.connectionActivity === "restoring"
      ? "Restoring Eternl"
      : wallet.connection
        ? shortHash(wallet.connection.address, 7)
        : wallet.availability === "detecting"
          ? "Finding Eternl"
          : wallet.available
            ? "Connect Eternl"
            : "Set up Eternl";

  const handlePrimaryClick = () => {
    if (panelOpen) {
      closePanel(false);
      return;
    }
    if (wallet.connection || !wallet.available) {
      setOpen((current) => !current);
      return;
    }
    void wallet.connect();
  };

  return (
    <div className="wallet-slot" ref={slotRef}>
      <button
        ref={buttonRef}
        type="button"
        className={`wallet-button ${wallet.connection ? "connected" : ""}`}
        onClick={handlePrimaryClick}
        disabled={wallet.connecting || wallet.availability === "detecting"}
        aria-expanded={panelOpen}
        aria-controls="wallet-panel"
      >
        {wallet.connection ? (
          <span className="status-dot" aria-hidden="true" />
        ) : (
          <span className="wallet-glyph" aria-hidden="true">E</span>
        )}
        <span>{label}</span>
        {(panelOpen || wallet.connection || wallet.error || !wallet.available) && (
          <span className="wallet-chevron" aria-hidden="true">⌄</span>
        )}
      </button>

      {panelOpen && (
        <section className="wallet-panel" id="wallet-panel" aria-label="Eternl wallet">
          {wallet.connection ? (
            <>
              <div className="wallet-panel-head">
                <div>
                  <span>Eternl connected</span>
                  <strong>{shortHash(wallet.connection.address, 12)}</strong>
                </div>
                <span className="wallet-network">
                  <i aria-hidden="true" />
                  {CARDANO_NETWORK}
                </span>
              </div>
              <p>
                Confirm that Preprod is selected in Eternl. CIP-30 identifies
                this as a testnet connection but cannot distinguish Preprod
                from Preview.
              </p>
              <div className="wallet-panel-actions">
                <button type="button" onClick={() => void copyAddress()}>
                  {copyStatus === "copied"
                    ? "Address copied"
                    : copyStatus === "failed"
                      ? "Copy failed"
                      : "Copy address"}
                </button>
                <button type="button" onClick={() => {
                  wallet.disconnect();
                  closePanel(true);
                }}>
                  Disconnect Baton
                </button>
              </div>
            </>
          ) : wallet.connectionActivity === "requesting" ? (
            <>
              <div className="wallet-panel-head">
                <div>
                  <span>Waiting for Eternl</span>
                  <strong>Approve the connection</strong>
                </div>
              </div>
              <p>
                Open Eternl and approve Baton. Your keys stay in Eternl, and
                connecting does not submit a transaction.
              </p>
              <div className="wallet-pending-note" role="status">
                Waiting for your decision in Eternl
              </div>
            </>
          ) : wallet.connectionActivity === "restoring" ? (
            <>
              <div className="wallet-panel-head">
                <div>
                  <span>Restoring Eternl</span>
                  <strong>Checking your authorized account</strong>
                </div>
              </div>
              <p>
                Baton is restoring the wallet access you already approved. No
                new approval or transaction is being requested.
              </p>
              <div className="wallet-pending-note" role="status">
                Restoring your wallet connection
              </div>
            </>
          ) : wallet.error ? (
            <>
              <div className="wallet-panel-head">
                <div>
                  <span>Connection needs attention</span>
                  <strong>Eternl did not connect</strong>
                </div>
              </div>
              <p role="alert">{wallet.error}</p>
              <div className="wallet-panel-actions">
                <button type="button" onClick={() => {
                  setOpen(true);
                  wallet.clearError();
                  void wallet.connect();
                }}>
                  Try again
                </button>
                <button type="button" onClick={() => {
                  closePanel(true);
                }}>
                  Close
                </button>
              </div>
            </>
          ) : wallet.available ? (
            <>
              <div className="wallet-panel-head">
                <div>
                  <span>Eternl detected</span>
                  <strong>Ready to connect</strong>
                </div>
              </div>
              <p>
                Select your Preprod account in Eternl. Connecting lets Baton
                read that account and request approvals; it does not move ADA.
              </p>
              <div className="wallet-panel-actions">
                <button type="button" onClick={() => void wallet.connect()}>
                  Connect Eternl
                </button>
                <button type="button" onClick={() => closePanel(true)}>
                  Close
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="wallet-panel-head">
                <div>
                  <span>Eternl not detected</span>
                  <strong>Set up your wallet</strong>
                </div>
              </div>
              <p>
                On mobile, open Baton in a compatible wallet app. On desktop,
                install or enable Eternl for this browser. Then select Cardano
                Preprod.
              </p>
              <div className="wallet-panel-actions wallet-setup-actions">
                <button type="button" onClick={openWalletApp}>
                  Open in mobile wallet
                </button>
                <a href="https://eternl.io" target="_blank" rel="noreferrer">
                  Install Eternl
                </a>
                <button type="button" onClick={() => {
                  window.location.reload();
                }}>
                  Reload after installing
                </button>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
