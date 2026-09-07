# Site Specification

## Purpose

The official Baton site lets a user understand the protocol, create
a vault, monitor its on-chain state, submit a pulse, close before final expiry,
or construct an eligible release transaction. It is an interface to public
Cardano validators, not a hosted wallet or operator-controlled account.

## Non-custodial architecture

The core interaction runs in the browser:

1. The user connects a compatible Cardano wallet.
2. The site reads the wallet's public addresses and available UTxOs with the
   wallet's permission.
3. The site builds an unsigned transaction locally.
4. A review screen shows every economically material field.
5. The user's wallet independently requests approval and signs.
6. The signed transaction is submitted to Cardano.
7. The site reads confirmed state from the chain and exports a recovery manifest.

The operator must never:

- request, receive, store, or transmit a seed phrase or private key;
- use a server-side key to sign for a user;
- take temporary custody of protected assets;
- route protected assets through an operator wallet;
- hold an owner, liveness, recovery, freeze, pause, or upgrade key;
- promise to submit future pulse or release transactions in the core service; or
- claim it can reverse or repair a confirmed vault transaction.

The site does receive its disclosed setup fee. That payment is operator revenue,
not a protected user asset and not a balance held for later transmission.

## Fee model

The first release charges exactly **5 ADA** for successful vault creation through
the official interface.

```text
User wallet inputs
       |
       +--> canonical vault state UTxO
       +--> disclosed site setup fee -> operator treasury
       +--> wallet change
       +--> Cardano network fee
```

All outputs are part of one atomic transaction. If vault creation is rejected,
the site fee output is not independently paid. The site does not collect a
percentage of protected assets, assets under management, a recurring protocol
fee, a pulse fee, or a release fee in version one.

The review screen must distinguish:

- **Protected value:** assets being locked by the user.
- **Minimum ADA:** ADA that Cardano requires in token-bearing outputs.
- **Cardano network fee:** paid under ledger rules, not to the site.
- **Site setup fee:** the exact amount and recipient controlled by the operator.

The site may describe the contract as having “no protocol fee” only when the
same screen also states that network fees apply and the official interface
charges a setup fee.

## Site map

### `/`

Explain the product in one concrete example, show the pulse-to-expiry timeline,
compare fixed-address and recovery-token modes, display the setup fee, and link
to source and validator verification.

### `/create`

A guided creation flow:

1. Connect wallet and choose network.
2. Select ADA/native assets/NFTs to protect.
3. Choose check-in frequency and missed check-ins required for release.
4. Choose fixed destination or a bearer recovery token minted automatically by
   the plan's one-shot policy.
5. Review exact dates, powers, destination rule, and failure consequences.
6. Review protected value, minimum ADA, network fee estimate, and site fee.
7. Verify the pinned validator and blueprint hash recorded in `CONTRACTS.md`.
8. Sign in the user's wallet.
9. Wait for confirmation and export the recovery kit.

Open recovery, if ever offered, belongs in a visually separate experimental
flow and may not be selected accidentally.

### `/vault/{vault-id}`

Read-only status is available without an account. Show:

- confirmed active-state UTxO and active receipt NFT, or the distinct completion
  receipt and final payout location after the plan ends;
- active, check-in-due, missed-check-in, claimable, closed, or released state;
- next due time and final release time in UTC and local time;
- elapsed missed count, such as `2 of 3 missed`;
- release policy without inventing a human identity for an address;
- sequence number and previous pulse transactions;
- actions currently permitted by the validator; and
- source, compiled validator, and manifest verification links.

Wallet-authorized actions are pulse, pre-expiry close, and eligible release.

### `/verify`

Allow a user to paste or upload a version-three vault manifest and verify network,
validator hash, active and completion receipt NFTs, current lifecycle UTxO,
datum, timing, release policy, and fee-bearing creation transaction.
Verification logic should also be distributable as an offline command-line tool
so users do not have to trust the official site.

### `/how-it-works` and `/risks`

Explain that validators are passive, missed pulses do not prove death, chain
state is public, transactions are irreversible, liveness and recovery keys have
different powers, and no party can guarantee a transaction will be included.

### `/legal/*`

Publish attorney-reviewed Terms, Privacy Notice, Risk Disclosure, Fee
Disclosure, and jurisdiction/availability notices. Critical disclosures must
also appear beside the relevant action and cannot be relegated to these pages.

## Required review screen

The user must be able to answer all of these without decoding transaction CBOR:

- What assets leave my wallet now?
- Which exact validator receives them?
- When is my next pulse due?
- When can final release begin?
- What can my owner key do?
- What can my liveness key do?
- What happens after expiry?
- Is an address named, or is recovery controlled by the plan's one-shot token?
- What exact amount is paid to the operator?
- What exact amount is a Cardano network fee?
- Can the operator ever access or recover the protected assets? (No.)

Each fact is derived from the transaction about to be signed, not merely copied
from earlier form state.

## Provisional plain-language disclosure

This copy is a product requirement, not final legal language:

> This site builds a Cardano transaction for your wallet to sign. We never
> receive your recovery phrase, private keys, or protected vault assets, and we
> cannot operate, reverse, or recover your vault. The open-source contract can
> be used without this site. Using this interface to create a vault costs 5 ADA,
> shown separately from Cardano network fees and minimum ADA. Missed check-ins
> can release your assets even if you are alive. This is software, not a bank
> account, custody service, will, trust, or legal, tax, or investment advice.
> Crypto assets are not FDIC insured. Review the complete transaction and obtain
> professional advice before locking valuable assets.

The final copy must be reviewed for every launch jurisdiction.

## Eternl connection

Eternl is a first-class connection, not a pasted-address workflow. The site uses
the active CIP-30 provider injected by the Eternl browser extension or Eternl
dApp browser. Connection occurs only after the user clicks **Connect Eternl** and
approves access in the wallet.

After connection, the site must:

- verify the wallet network before reading or building anything;
- display the active account address in a recognizable shortened form;
- invalidate pending work when the Eternl account changes;
- use wallet-approved UTxOs and a wallet-owned change address;
- request fresh wallet approval for every transaction signature;
- assemble and locally verify the returned witness set;
- submit through Eternl when supported, with a provider fallback that never
  receives a signing key; and
- forget the connection cleanly when the user disconnects or changes accounts.

Eternl's CIP-30 `signData` may later authenticate an optional site session, but
it is not used as proof of an on-chain pulse.

## Check-in flow

The primary active-vault action is **Check in**, not “send” or “deposit.”

1. Fetch the latest confirmed active-receipt UTxO and decode its datum.
2. Confirm that the connected Eternl account controls the configured liveness
   credential and is on the correct network.
3. Build a pulse transaction with a short validity interval.
4. Recreate the vault output with an identical asset bundle and only the allowed
   check-in anchor and sequence changes.
5. Add a wallet input for the Cardano fee, wallet change, and safe collateral
   handling with collateral return.
6. Show the exact old and new schedule and all value changes.
7. Request Eternl `signTx` approval and submit the complete transaction.
8. Wait for chain confirmation before displaying the reset miss count as final.

The signature review must show:

```text
Protected ADA change:     0 ADA
Protected token change:   0
Site fee:                 0 ADA
Cardano network fee:      [calculated before signing]
Missed check-ins now:     [current count]
Missed after confirmation: 0
Current release time:     [old timestamp]
New release time:         [new timestamp]
```

Because the transaction executes a Plutus validator, the wallet must also have
suitable collateral. Collateral is not spent when the pulse succeeds. If safe
collateral cannot be selected, the site stops before signature and explains how
the user can prepare an ADA-only wallet UTxO.

## Security requirements

- Pin the compiler, dependencies, validator blueprint, policy IDs, fee address,
  and expected hashes in a signed release manifest.
- Fail closed if runtime configuration disagrees with the release manifest.
- Derive the final review from the serialized transaction that will be sent to
  the wallet.
- Use no third-party advertising scripts and no third-party script tags in the
  signing flow.
- Apply a restrictive content security policy and self-host production assets.
- Make telemetry opt-in and minimize collection of wallet addresses, UTxOs, IP
  addresses, and vault identifiers.
- Provide reproducible builds and an offline transaction verifier.
- Never display “confirmed” from a single pending or mempool observation.
- Display network identity prominently to prevent preview/preprod/mainnet mixups.
- Reject unsupported wallet behavior rather than silently changing the intended
  transaction.

## Deferred services

Email/SMS reminders, hosted watchtowers, encrypted payload storage, automatic
release submission, fiat payment, account login, and customer support with
transaction intervention are separate services. They add privacy, availability,
custody, vendor, and regulatory questions and are not silently included in the
first interface.
