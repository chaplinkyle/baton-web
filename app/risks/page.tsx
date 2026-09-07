const risks = [
  ["You may still be alive", "A missed check-in does not prove death. Travel, illness, forgetfulness, lost wallet access, or network problems can make your handoff available."],
  ["Your choices cannot be repaired", "A wrong receiving address, lost recovery token, or schedule that is too short may permanently lock or misdirect your assets. This site has no override key."],
  ["Wallet theft changes who has power", "Someone with your check-in wallet can delay the handoff. Someone with your owner wallet can close it early. Someone with the recovery token can receive it after the wait."],
  ["Cardano activity is public", "Addresses, values, assets, dates, and the fingerprint of an optional file can be visible forever. Never place an unencrypted secret or private document on-chain."],
  ["A permitted handoff still needs a transaction", "The contract allows a handoff after the waiting period, but it cannot send one by itself. Someone must submit the transaction and Cardano must process it."],
  ["Software can contain defects", "Testing reduces risk but cannot prove perfection. Independent security review and real testnet use are required before valuable mainnet use."],
  ["Law still applies", "A valid Cardano transaction does not decide inheritance, probate, marital property, creditors, taxes, sanctions, or who is legally entitled to property."],
  ["Keep your plan file safe", "Losing the downloaded plan file does not change Cardano, but it makes returning to and independently checking your plan more difficult."],
];

export default function Risks() {
  return <div className="page-shell info-shell"><header className="page-title compact-title"><p className="eyebrow warning-eyebrow">IMPORTANT SAFETY INFORMATION</p><h1>Know what can go wrong before you protect anything.</h1><p>This is powerful, irreversible software. Choose a generous schedule, test with small amounts, and include qualified legal and tax professionals in your planning.</p></header><div className="risk-ledger">{risks.map(([title, body], index) => <article key={title}><span>{index + 1}</span><h2>{title}</h2><p>{body}</p></article>)}</div><section className="stop-panel"><span>TESTNET REVIEW ONLY</span><h2>Do not use valuable mainnet assets yet.</h2><p>The contract has extensive local testing, but commercial mainnet use remains blocked until independent smart-contract review, complete Eternl testnet exercises, a reproducible public release, and legal review for the places where it will be offered.</p></section></div>;
}
