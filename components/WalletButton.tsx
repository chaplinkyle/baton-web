"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useWallet } from "@/app/providers";
import { CARDANO_NETWORK } from "@/lib/config";
import {
  cardanoBrowseUri,
  isExactWalletNetwork,
  shouldOfferWalletAppHandoff,
  walletIssuePresentation,
  walletSetupPresentation,
} from "@/lib/eternl";
import { wrappedFocusTarget } from "@/lib/focus-trap";
import { shortHash } from "@/lib/product";

const FOCUSABLE_SELECTOR = [
  'a[href]:not([tabindex="-1"])',
  'button:not([disabled]):not([tabindex="-1"])',
  'input:not([disabled]):not([tabindex="-1"])',
  'select:not([disabled]):not([tabindex="-1"])',
  'textarea:not([disabled]):not([tabindex="-1"])',
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function WalletButton() {
  const wallet = useWallet();
  const clearWalletError = wallet.clearError;
  const [open, setOpen] = useState(false);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const [mobileSheet, setMobileSheet] = useState(false);
  const slotRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const copyResetTimer = useRef<number | null>(null);
  // A request started from Create or My Plans should be just as legible as one
  // started here. Keep the approval guidance visible until Eternl resolves the
  // request so the disabled button never looks like an unexplained spinner.
  const connectionPending = wallet.connectionActivity !== "idle";
  const panelOpen = open || connectionPending || Boolean(wallet.error);

  const closePanel = useCallback((restoreFocus = false) => {
    setOpen(false);
    clearWalletError();
    if (restoreFocus) {
      window.requestAnimationFrame(() => buttonRef.current?.focus());
    }
  }, [clearWalletError]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 620px)");
    const sync = () => setMobileSheet(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!panelOpen || !mobileSheet) return;
    const background = Array.from(document.querySelectorAll<HTMLElement>(
      "main, .site-footer, .site-header .brand, .site-header nav",
    ));
    const previous = background.map((element) => element.inert);
    background.forEach((element) => { element.inert = true; });
    const focusFrame = window.requestAnimationFrame(() => {
      (closeButtonRef.current ?? panelRef.current)?.focus();
    });
    return () => {
      window.cancelAnimationFrame(focusFrame);
      background.forEach((element, index) => { element.inert = previous[index]; });
    };
  }, [mobileSheet, panelOpen]);

  useEffect(() => {
    if (!panelOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!slotRef.current?.contains(event.target as Node)) {
        closePanel(mobileSheet);
      }
    };
    const handlePanelKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (connectionPending) return;
        event.preventDefault();
        closePanel(true);
        return;
      }
      if (event.key !== "Tab" || !mobileSheet) return;

      const panel = panelRef.current;
      if (!panel) return;
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((element) => element.getClientRects().length > 0);
      const active = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
      const target = wrappedFocusTarget(focusable, active, event.shiftKey);
      if (target === undefined) return;
      event.preventDefault();
      (target ?? panel).focus();
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", handlePanelKeyDown);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", handlePanelKeyDown);
    };
  }, [closePanel, connectionPending, mobileSheet, panelOpen]);

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

  const label = wallet.revalidating
    ? "Checking account…"
    : wallet.connection
      ? shortHash(wallet.connection.address, 7)
      : wallet.connectionActionLabel;
  const exactNetworkConfirmed =
    wallet.connection ? isExactWalletNetwork(wallet.connection) : false;
  const triggerLabel = panelOpen && !wallet.connecting
    ? "Close Eternl wallet details"
    : wallet.connection
      ? `Open Eternl wallet details for ${shortHash(wallet.connection.address, 12)}`
      : label;
  const issuePresentation = walletIssuePresentation(wallet.issueKind);
  const walletAppHandoff = typeof window !== "undefined" &&
    shouldOfferWalletAppHandoff({
      userAgent: window.navigator.userAgent,
      maxTouchPoints: window.navigator.maxTouchPoints,
    });
  const setupPresentation = walletSetupPresentation(walletAppHandoff);

  const handlePrimaryClick = () => {
    if (panelOpen) {
      closePanel(false);
      return;
    }
    if (wallet.connection || !wallet.available) {
      setOpen((current) => !current);
      return;
    }
    setOpen(true);
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
        aria-busy={wallet.revalidating || undefined}
        aria-label={triggerLabel}
        aria-haspopup="dialog"
        tabIndex={mobileSheet && panelOpen ? -1 : undefined}
        aria-expanded={panelOpen}
        aria-controls="wallet-panel"
      >
        {wallet.connection ? (
          <span className="status-dot" aria-hidden="true" />
        ) : (
          <svg className="wallet-glyph" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
            <path d="M5.5 4.75h7M5.5 9h5.5M5.5 13.25h7" />
          </svg>
        )}
        <span>{label}</span>
        {(panelOpen || wallet.connection || wallet.error || !wallet.available) && (
          <svg className="wallet-chevron" viewBox="0 0 14 14" aria-hidden="true" focusable="false">
            <path d="m3.5 5 3.5 4 3.5-4" />
          </svg>
        )}
      </button>

      {panelOpen && (
        <>
          <div
            className="wallet-backdrop"
            aria-hidden="true"
            onClick={() => closePanel(true)}
          />
          <section
            ref={panelRef}
            className="wallet-panel"
            id="wallet-panel"
            role="dialog"
            aria-modal={mobileSheet || undefined}
            aria-label="Eternl wallet"
            tabIndex={-1}
          >
            {!connectionPending && (
              <button
                ref={closeButtonRef}
                type="button"
                className="wallet-panel-close"
                aria-label="Close wallet details"
                onClick={() => closePanel(true)}
              >
                <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                  <path d="m4 4 8 8M12 4l-8 8" />
                </svg>
              </button>
            )}
            {wallet.revalidating ? (
            <>
              <div className="wallet-panel-head">
                <div>
                  <span>Confirming Eternl</span>
                  <strong>Checking the selected account</strong>
                </div>
              </div>
              <p>
                Baton is confirming that this is still the same Preprod
                account. Wallet actions remain unavailable until the check is
                complete.
              </p>
              <div className="wallet-pending-note" role="status">
                Revalidating your wallet session
              </div>
            </>
          ) : wallet.connection ? (
            <>
              <div className="wallet-panel-head">
                <div>
                  <span>Eternl connected</span>
                  <strong title={wallet.connection.address}>{shortHash(wallet.connection.address, 8)}</strong>
                </div>
                <span className={`wallet-network ${exactNetworkConfirmed ? "" : "manual"}`}>
                  <i aria-hidden="true" />
                  {exactNetworkConfirmed ? `${CARDANO_NETWORK} verified` : "Testnet connected"}
                </span>
              </div>
              <p>
                {exactNetworkConfirmed
                  ? `Baton confirmed this account is on Cardano ${CARDANO_NETWORK}. It will search all ${wallet.connection.paymentKeyHashes.length} payment address${wallet.connection.paymentKeyHashes.length === 1 ? "" : "es"} exposed by this account.`
                  : "This Eternl version identifies testnet, but not Preprod versus Preview. Confirm that Preprod is selected before preparing a transaction."}
              </p>
              <div className="wallet-panel-actions wallet-connected-actions">
                <button type="button" onClick={() => wallet.changeAccount()}>
                  Change account
                </button>
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
              <div className="wallet-panel-actions single-action">
                <button type="button" onClick={() => wallet.cancelConnection()}>
                  Stop waiting
                </button>
              </div>
            </>
          ) : wallet.connectionActivity === "checking" ? (
            <>
              <div className="wallet-panel-head">
                <div>
                  <span>Eternl approved</span>
                  <strong>Checking the wallet network</strong>
                </div>
              </div>
              <p>
                Baton is checking the network and preparing confirmed Cardano
                data for this account. Nothing is being signed or submitted.
              </p>
              <div className="wallet-pending-note" role="status">
                Finishing the secure connection
              </div>
              <div className="wallet-panel-actions single-action">
                <button type="button" onClick={() => wallet.cancelConnection()}>
                  Cancel connection
                </button>
              </div>
            </>
          ) : wallet.connectionActivity === "switching" ? (
            <>
              <div className="wallet-panel-head">
                <div>
                  <span>Eternl account changed</span>
                  <strong>Connecting the account you selected</strong>
                </div>
              </div>
              <p>
                Baton stopped using the previous account and is reading the
                new one. Nothing is being signed or submitted.
              </p>
              <div className="wallet-pending-note" role="status">
                Updating your wallet account
              </div>
              <div className="wallet-panel-actions single-action">
                <button type="button" onClick={() => wallet.cancelConnection()}>
                  Cancel account change
                </button>
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
              <div className="wallet-panel-actions single-action">
                <button type="button" onClick={() => wallet.cancelConnection()}>
                  Stop restoring
                </button>
              </div>
            </>
          ) : !wallet.available ? (
            <>
              <div className="wallet-panel-head">
                <div>
                  <span>Eternl not detected</span>
                  <strong>{setupPresentation.title}</strong>
                </div>
              </div>
              <p role={wallet.error ? "alert" : undefined}>
                {wallet.error ?? setupPresentation.message}
              </p>
              <div className="wallet-panel-actions wallet-setup-actions">
                {walletAppHandoff ? (
                  <>
                    <button type="button" onClick={openWalletApp}>
                      {setupPresentation.primaryAction}
                    </button>
                    <a href="https://eternl.io/landing" target="_blank" rel="noreferrer">
                      {setupPresentation.secondaryAction}
                    </a>
                  </>
                ) : (
                  <>
                    <a href="https://eternl.io/landing" target="_blank" rel="noreferrer">
                      {setupPresentation.primaryAction}
                    </a>
                    <button type="button" onClick={() => {
                      window.location.reload();
                    }}>
                      {setupPresentation.secondaryAction}
                    </button>
                  </>
                )}
              </div>
            </>
          ) : wallet.error ? (
            <>
              <div className="wallet-panel-head">
                <div>
                  <span>{issuePresentation.label}</span>
                  <strong>{issuePresentation.title}</strong>
                </div>
              </div>
              <p role="alert">{wallet.error}</p>
              <div className="wallet-panel-actions">
                <button type="button" onClick={() => {
                  setOpen(true);
                  wallet.clearError();
                  void wallet.connect();
                }}>
                  {issuePresentation.action}
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
            ) : null}
          </section>
        </>
      )}
    </div>
  );
}
