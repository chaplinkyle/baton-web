# Eternl and Check-In Integration

## Decision

Eternl is the first wallet supported end to end. Integration uses the active
Cardano CIP-30 web-wallet bridge, which Eternl implements for its browser
extension and dApp-browser connection methods.

The product remains structurally wallet-agnostic: Cardano transaction logic is
separate from the Eternl adapter so other conforming wallets can be added after
the first audited release.

## Connection contract

The browser detects Eternl's injected wallet provider and asks for permission
only in response to a user action. The adapter uses CIP-30 to:

- enable the connection;
- verify network identity;
- read user-approved UTxOs and a change address;
- request a transaction witness with `signTx`;
- assemble and verify the complete signed transaction; and
- submit the transaction and track its transaction ID.

No provider method exposes the seed phrase or private key to the site. A wallet
signature request is shown and approved inside Eternl.

The interface names each connection phase explicitly: waiting for the person in
Eternl, then checking the wallet network after approval. A slow network read must
never look like an unresolved wallet approval. On small screens the wallet
panel is a focus-contained sheet with an opaque background; on larger screens
it remains an anchored popover.

CIP-30 network ID `0` identifies a Cardano testnet but cannot distinguish
Preprod from Preview. Baton requests CIP-142 when Eternl advertises support and
requires Preprod network magic `1` when that extension is available. Otherwise
the interface says only that a testnet is connected and tells the person to
confirm Preprod in Eternl; it never presents the base CIP-30 result as exact
Preprod proof.

### Embedded dApp-browser boundary

Eternl's extension and mobile dApp browsers may render Baton inside an iframe.
Every Baton route therefore allows framing only from the documented Eternl
contexts: `eternl.io`, its subdomains, the Eternl browser extension, and its
Ionic or Capacitor mobile application shells. The policy does not use a general
web wildcard, so ordinary websites cannot frame the interface.

`X-Frame-Options` is deliberately omitted because its legacy `DENY` and
`SAMEORIGIN` modes cannot express this origin list and would override the dApp
browser integration. The Content Security Policy remains the authoritative
frame restriction, with cross-origin isolation and resource-policy headers
matching Eternl's published integration requirements.

## Why `signData` is not the pulse

Eternl can sign an off-chain message, but the Cardano validator cannot discover
that message or prove that no newer message exists. A pure `signData` check-in
would make the website or another database the authority for expiry.

The trustless pulse must therefore be a transaction signature:

```text
Eternl signTx approval
        |
        v
consume current vault UTxO
        |
        +-- validator checks liveness signer and time range
        |
        v
create new vault UTxO
  - same receipt NFT
  - same protected ADA/tokens/NFTs
  - same immutable policy and miss threshold
  - new check-in anchor
  - sequence + 1
```

From the user's economic perspective, this is a signature plus a network fee.
From the ledger's perspective, it is a state transition that consumes and
recreates the entire UTxO.

## Configurable missed check-ins

The datum stores:

- `check_in_period_ms`; and
- `misses_to_release`.

The latest check-in transaction supplies the trusted anchor. The contract
derives release time as:

```text
release_at = last_check_in_at + (check_in_period * misses_to_release)
```

Example:

```text
Frequency:          every 7 days
Unlock after:       4 missed check-ins
Last check-in:      August 1

August 8:           1 of 4 missed
August 15:          2 of 4 missed
August 22:          3 of 4 missed
August 29:          release becomes possible
```

No transaction is created on August 8, 15, or 22. Those are derived status
boundaries. A confirmed pulse before August 29 resets the count to zero and
anchors a new schedule.

## Pulse transaction anatomy

### Inputs

- The canonical vault script UTxO containing the active receipt NFT.
- One or more Eternl wallet UTxOs selected to cover the network fee and balance
  wallet change.
- Safe collateral selected under current Cardano transaction-building rules.

### Redeemer and authorization

- Redeemer: `Pulse { new_check_in_at_ms }`.
- Required signer: the liveness credential stored in the current datum.
- Validity interval: finite, short, and entirely before final release.

### Outputs

- Exactly one continuing vault output at the same script, with an asset bundle
  exactly equal to the consumed vault input.
- Eternl wallet change from the external wallet inputs.
- Collateral return when applicable under the transaction format.

### Charges

- Site fee: 0 ADA.
- Protected-asset reduction: 0.
- Cardano network fee: calculated for that transaction and paid from the Eternl
  wallet, not from the protected vault.
- Collateral: exposed only to phase-2 failure and not consumed on success.

## Creation transaction

The official site's creation transaction is separate from the pulse and includes:

- the user's initial vault output;
- the one-shot receipt NFT creation requirements;
- exactly 5 ADA to the published operator treasury address;
- the ordinary Cardano network fee; and
- user wallet change.

The operator treasury address, amount, validator hash, and minting policy hashes
are pinned in the signed release manifest and repeated on the final review screen.

## User experience

The active vault presents one primary button:

**Check in with Eternl**

Before opening the wallet, the site displays:

- current and proposed release timestamps;
- current missed count and the reset count of zero;
- protected asset delta of zero;
- site fee of zero;
- calculated network fee;
- connected liveness account and network; and
- transaction expiry time if the user waits too long to approve.

After submission, the site shows `Pending` until the new canonical UTxO is
confirmed. It never resets the displayed miss count merely because Eternl
returned a signature or transaction ID.

## Failure handling

- Wrong network: stop before building and show the required network.
- Wrong account: stop and identify that the connected account is not the
  configured liveness signer.
- Stale state: discard the transaction and rebuild from the newest confirmed
  active-receipt UTxO.
- User rejection: make no state change and preserve the review form.
- Validity window elapsed: rebuild with a fresh interval and schedule.
- Insufficient fee ADA: show the calculated shortfall without touching the
  vault.
- No safe collateral: explain the need for an ADA-only UTxO; do not submit a
  transaction with unsafe collateral behavior.
- Submission failed: do not call the pulse successful; re-query canonical state.
- Account changed: invalidate the unsigned transaction and reconnect.
- CIP-30 account change: discard the previous account immediately and call
  `enable()` again to establish the account selected in Eternl. CIP-30 requires
  this re-establishment and says an already user-initiated account change should
  not trigger another permission prompt. Baton shows a distinct updating state
  and never leaves the previous account actionable during the transition.
- Transient provider timeout: retry one idempotent network-initialization read,
  then show short guidance that confirms nothing changed. Signing and
  submission are never retried automatically.
- Disconnect during a wallet request: invalidate every in-flight connection or
  identity result. A late success, failure, or timeout must not reconnect the
  wallet, reopen an error panel, or change the user's explicit disconnected
  state.

## Security tests

- Compare decoded unsigned and final signed transaction bodies; only the witness
  set may be added by the wallet.
- Reject a witness that does not authorize the configured liveness credential.
- Reject any transaction whose vault output differs by one lovelace or one token.
- Reject an added 5 ADA site output on a pulse.
- Reject a changed operator address or fee on creation.
- Exercise Eternl extension and dApp-browser paths on Cardano test networks.
- Test wallet account changes and transaction review races.
- Test disconnect while an identity refresh is pending, then wait beyond the
  provider timeout and confirm that no stale result reaches the interface.
- Confirm collateral remains unspent after successful script execution.
- Confirm the site reports schedules only from confirmed on-chain state.

## Primary references

- [CIP-30 Cardano dApp-Wallet Web Bridge](https://cips.cardano.org/cip/CIP-30)
- [Eternl dApp browser integration](https://wiki.eternl.io/for-developers/dapp-browser-integration)
- [Cardano lock, spend, and collateral](https://developers.cardano.org/docs/developers/curriculum/smart-contracts/lock-and-spend/)
