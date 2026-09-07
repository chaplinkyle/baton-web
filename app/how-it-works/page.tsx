import Link from "next/link";

const stages = [
  { n: "1", title: "Create your plan", body: "Choose the Cardano assets to protect, how often you will check in, and how many check-ins you may miss." },
  { n: "2", title: "Check in with Eternl", body: "Approve a normal Cardano transaction from your check-in wallet. The protected assets stay exactly where they are." },
  { n: "3", title: "The schedule starts over", body: "Every successful check-in gives you the full amount of time again. Nothing happens when just one date passes." },
  { n: "4", title: "The handoff becomes available", body: "If the entire waiting period passes, the chosen address or recovery-token holder can receive the protected assets." },
];

export default function HowItWorks() {
  return (
    <div className="page-shell info-shell">
      <header className="page-title compact-title">
        <p className="eyebrow">HOW IT WORKS</p>
        <h1>A handoff plan you keep active by checking in.</h1>
        <p>The software does not decide whether you died or became incapacitated. It only follows the schedule you chose.</p>
      </header>

      <section className="stage-list">
        {stages.map((stage) => <article key={stage.n}><span>{stage.n}</span><h2>{stage.title}</h2><p>{stage.body}</p></article>)}
      </section>

      <section className="plain-example">
        <div><p className="eyebrow">EXAMPLE</p><h2>30 days × 3 missed check-ins = 90 days</h2></div>
        <p>You check in today. If you do not check in again, your handoff becomes available 90 days later. Check in on day 89, and a new 90-day period begins.</p>
      </section>

      <section className="role-table">
        <div className="section-intro"><p className="eyebrow">WHO CAN DO WHAT</p><h2>Each wallet has one clear job.</h2></div>
        <div><span>YOUR OWNER WALLET</span><strong>Can cancel the plan early</strong><p>Before the waiting period ends, this wallet can close the plan and take the protected assets back.</p></div>
        <div><span>YOUR CHECK-IN WALLET</span><strong>Can keep the plan protected</strong><p>It can check in, but it cannot withdraw the assets or change your choices.</p></div>
        <div><span>YOUR RECIPIENT METHOD</span><strong>Can receive after the wait</strong><p>This is either one fixed Cardano address or the holder of the unique recovery token Baton creates with your plan.</p></div>
      </section>

      <details className="technical-details">
        <summary>For technical reviewers</summary>
        <p>The on-chain rule is: handoff time = last confirmed check-in + check-in period × allowed misses. Each check-in consumes and recreates the one protected output with the exact same value and an updated time. The contract is Plutus V3 written in Aiken.</p>
      </details>

      <div className="info-cta"><div><h2>Choose a schedule that gives you room.</h2><p>Longer periods and more allowed misses reduce the risk of an accidental handoff.</p></div><Link className="button primary" href="/create">Create a handoff plan</Link></div>
    </div>
  );
}
