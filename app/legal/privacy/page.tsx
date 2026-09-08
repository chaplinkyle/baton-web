export default function Privacy() {
  return (
    <div className="page-shell legal-shell">
      <header>
        <p className="eyebrow">PROVISIONAL · PRIVACY BY DEFAULT</p>
        <h1>Privacy Notice</h1>
        <p>Last updated September 7, 2026</p>
      </header>
      <article className="legal-document">
        <h2>Your wallet stays in your browser</h2>
        <p>
          Wallet connection and transaction preparation happen in your browser.
          The interface does not request or receive a seed phrase or private key.
        </p>
        <h2>Your disconnect choice stays on this device</h2>
        <p>
          If you disconnect Baton or choose to change accounts, this browser
          stores one local preference so the site does not reconnect to the old
          account after a reload. That preference contains no wallet address,
          balance, private key, or seed phrase. Reconnecting removes it.
        </p>
        <h2>Cardano is public</h2>
        <p>
          Cardano transaction data may permanently reveal addresses, key
          identifiers, assets, values, transaction times, plan settings, chosen
          receiving addresses, and the fingerprint of an optional file.
        </p>
        <h2>Your plan file stays local</h2>
        <p>
          The plan file created by this version is stored in your browser and
          downloaded only when you choose. The core interface has no hosted user
          account or plan-file database.
        </p>
        <h2>Cardano network providers</h2>
        <p>
          The interface asks a Cardano provider for network information and
          confirmed plan status. That provider may observe IP addresses,
          requested addresses, policies, or transactions under its own terms.
        </p>
        <h2>No advertising trackers</h2>
        <p>
          No advertising scripts are included. Any future product analytics must
          be disclosed, minimized, opt-in where required, and kept away from
          wallet and signing data.
        </p>
        <h2>Draft status</h2>
        <p>
          This notice requires qualified legal and operational review before
          commercial release.
        </p>
      </article>
    </div>
  );
}
