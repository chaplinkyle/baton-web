import Image from "next/image";
import Link from "next/link";
import { PulseTimeline } from "@/components/PulseTimeline";

export default function Home() {
  return (
    <>
      <section className="hero page-shell">
        <div className="hero-copy">
          <p className="eyebrow">Baton for Cardano</p>
          <h1>Keep what matters protected. Pass it on when the time comes.</h1>
          <p className="hero-lede">
            Set aside ADA, tokens, NFTs, or proof of an important file. They stay
            protected while you check in. If you miss the number of check-ins you
            chose, your handoff becomes available to the person or key you selected.
          </p>
          <div className="hero-actions">
            <Link className="button primary" href="/create">Create a handoff plan</Link>
            <Link className="button secondary" href="/how-it-works">See how it works</Link>
          </div>
          <div className="trust-row" aria-label="Service facts">
            <span>You keep control</span>
            <span>5 ADA one-time setup</span>
            <span>No ongoing site fee</span>
            <span>Preprod testnet only</span>
          </div>
        </div>

        <div className="hero-stage">
          <div className="hero-art" aria-hidden="true">
            <Image
              src="/baton-cradle.png"
              alt=""
              width={1182}
              height={1330}
              priority
              sizes="(max-width: 920px) 76vw, 430px"
            />
          </div>
        <aside className="handoff-card" aria-label="Example protected handoff">
          <div className="handoff-card-top">
            <span>Example plan</span>
            <span className="safe-chip">Protected</span>
          </div>
          <div className="care-window">
            <span className="care-label">Next check-in</span>
            <strong>In 30 days</strong>
            <p>You can miss 3 more check-ins before the handoff is available.</p>
          </div>
          <dl className="care-facts">
            <div><dt>Check in</dt><dd>Every 30 days</dd></div>
            <div><dt>Misses allowed</dt><dd>3</dd></div>
            <div><dt>Protected</dt><dd>ADA + family NFT</dd></div>
          </dl>
          <div className="care-note"><span aria-hidden="true">✓</span> A check-in keeps everything protected and starts the schedule again.</div>
        </aside>
        </div>
      </section>

      <div className="page-shell"><PulseTimeline /></div>

      <section className="page-shell purpose-section">
        <div className="section-intro">
          <p className="eyebrow">WHAT YOU CAN PROTECT</p>
          <h2>Made for the future you cannot personally manage.</h2>
          <p>Use one clear plan for assets, digital property, or evidence you want preserved.</p>
        </div>
        <div className="purpose-grid">
          <article><span aria-hidden="true">01</span><h3>Support your family</h3><p>Set aside ADA or Cardano tokens for a wallet you trust.</p></article>
          <article><span aria-hidden="true">02</span><h3>Preserve digital property</h3><p>Protect meaningful NFTs and define how they can be received later.</p></article>
          <article><span aria-hidden="true">03</span><h3>Protect your record</h3><p>Place a permanent fingerprint of a statement or file on-chain so its authenticity can be checked later. The file itself stays private.</p></article>
        </div>
      </section>

      <section className="how-strip">
        <div className="page-shell">
          <div className="section-intro compact-intro">
            <p className="eyebrow">HOW IT WORKS</p>
            <h2>Choose. Check in. Hand off.</h2>
          </div>
          <div className="simple-steps">
            <article><span>1</span><div><h3>Choose what to protect</h3><p>Select assets, a check-in schedule, and who or what can receive them later.</p></div></article>
            <article><span>2</span><div><h3>Check in from Eternl</h3><p>Approve a small Cardano transaction at the schedule you chose. Your protected assets do not move.</p></div></article>
            <article><span>3</span><div><h3>Your instructions become available</h3><p>Only after all allowed check-ins are missed can the handoff you selected be completed.</p></div></article>
          </div>
        </div>
      </section>

      <section className="page-shell recipient-section">
        <div className="section-intro">
          <p className="eyebrow">WHO CAN RECEIVE IT</p>
          <h2>You do not need a beneficiary list.</h2>
          <p>Choose the kind of handoff that fits your situation. Your choice cannot be secretly changed by this site.</p>
        </div>
        <div className="recipient-grid">
          <article>
            <span className="choice-label">A PERSON OR FAMILY WALLET</span>
            <h3>Send to one chosen address</h3>
            <p>Your assets can only go to the Cardano address you set, even if someone else starts the handoff transaction.</p>
          </article>
          <article>
            <span className="choice-label">NO ADDRESS NAMED IN ADVANCE</span>
            <h3>Use a recovery token</h3>
            <p>Baton creates one unique recovery token for your plan. Give it to someone you trust; after the wait ends, its holder can choose where the assets go.</p>
          </article>
        </div>
      </section>

      <section className="page-shell assurance-section">
        <div>
          <p className="eyebrow">BEFORE YOU USE IT</p>
          <h2>A missed check-in is not proof of death.</h2>
          <p>If you forget, lose wallet access, travel, or become unable to check in, your handoff may become available while you are alive. Choose a generous schedule and involve the people you trust.</p>
          <Link className="text-link" href="/risks">Read every important risk</Link>
        </div>
        <div className="assurance-card">
          <strong>Currently in testnet review</strong>
          <p>The contract has 95 passing tests, including 4,000 generated property cases, and no operator withdrawal key. It is not approved for valuable mainnet assets until independent security and legal review are complete.</p>
          <details>
            <summary>Technical assurance details</summary>
            <p>Open-source Aiken smart contract, deterministic release schedule, browser-built transactions, and independent on-chain plan verification.</p>
          </details>
        </div>
      </section>
    </>
  );
}
