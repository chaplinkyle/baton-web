# Product Specification

## Product statement

Baton is a self-custodial Cardano handoff protocol that keeps assets under the
owner's control while periodic proof-of-life transactions continue. After a
configured number of consecutive check-ins is missed, the vault becomes
spendable only under the release rule chosen when the vault was created.

The product is better understood as a **continuity vault** than literal proof of
death. A missed pulse can mean death, incapacity, lost keys, imprisonment, loss
of internet access, a chain outage, or a simple mistake. The contract observes
only valid transactions and time bounds; it cannot know why a pulse stopped.

## Goals

- Hold arbitrary Cardano value: ADA, fungible native tokens, and NFTs.
- Keep the release rule immutable and inspectable before assets are deposited.
- Make listed recipients optional.
- Let an inexpensive hot liveness key renew the timer without giving it power to
  withdraw or redirect assets.
- Let a cold owner key close the vault before final expiry.
- Permit any relayer to execute a fixed-destination release, so the recipient
  does not need specialized software merely to receive assets.
- Make every allowed transition and every forbidden mutation testable.
- Keep the first validator small enough for meaningful independent review.

## Non-goals for the first validator

- Inferring whether a person is dead or incapacitated.
- Automatically initiating a transaction. Cardano validators are passive.
- Storing private plaintext on-chain.
- Releasing a private decryption key without an off-chain or cryptographic
  time-release system.
- Supporting arbitrary beneficiary percentages and arbitrary multi-asset
  rounding inside the core liveness validator.
- Upgradeable proxy logic or an administrator back door.
- Hiding the vault balance, deadline, or release policy from chain observers.

## Roles

### Owner authority

A cold credential that may close the vault and recover its assets before the
final release time. It is not needed for routine pulses.

### Liveness authority

A separate credential that may only renew the due date. It cannot withdraw,
change the owner, change the release rule, change the check-in frequency or
miss threshold, or move the protected value.

### Executor

The party that constructs and submits a release transaction. In fixed mode the
executor does not receive the vault merely because it paid the transaction fee;
the validator enforces the destination. A later version may support an immutable
executor bounty.

### Release controller

The party or condition selected by the release policy. It may be a fixed address,
the plan's bearer recovery token, or open competition after expiry.

## Timing model

The owner configures:

- `check_in_period`: how often a check-in is expected; and
- `misses_to_release`: how many consecutive scheduled check-ins must pass before
  release becomes possible.

The vault records the latest confirmed check-in anchor. From it, the contract
derives:

- `next_check_in_at = last_check_in_at + check_in_period`; and
- `release_at = last_check_in_at + (check_in_period * misses_to_release)`.

For example, “check in every 30 days; unlock after 3 missed check-ins” becomes
claimable 90 days after the last confirmed check-in. At 30 days the site displays
`1 of 3 missed`; at 60 days it displays `2 of 3 missed`; at 90 days release is
allowed.

There are no on-chain “miss transactions.” Misses are a display derived from
elapsed time. Until the final release boundary, the liveness authority can check
in and the owner can close. At or after that boundary, only the release path is
valid. This prevents owner-close and release paths from being legitimate over
the same time interval.

Recommended user-facing defaults, subject to testing:

- Check-in period: 30 days.
- Missed check-ins required for release: 3.
- Reminder escalation before every scheduled check-in and after each miss.
- Transaction validity window: no more than 15 minutes.

Each pulse resets the check-in anchor relative to the transaction's tightly
bounded validity interval. Repeated pulses made immediately do not stack months
or years of future time.

## Release policies

### 1. Fixed destination

The entire vault is released to an immutable Cardano address. That address can
belong to a person, organization, multisignature wallet, DAO, charity, or another
validator.

For multiple named recipients, the recommended composition is:

```text
Baton plan -> Distribution Validator -> individual recipient claims
```

The core validator therefore performs one exact transfer. A separately audited
distribution validator handles shares, NFT assignments, minimum-ADA constraints,
and recipients who claim at different times.

### 2. Bearer recovery

No beneficiary address is listed. Vault creation mints exactly one dedicated
`BATON_RECOVERY` token under the plan's one-shot policy and delivers it to
the owner's wallet outside the vault. After expiry, a release transaction must:

1. consume a non-vault input containing exactly one recovery token;
2. spend the vault state UTxO;
3. burn the active vault receipt and mint the distinct completion receipt; and
4. create one payout output containing the recovery token, the completion
   receipt NFT, and all protected vault value.

The one-shot seed proves that no second recovery token can be minted for the
plan. The ledger's normal spending rules prove control of the input holding the
bearer token. The validator does not need to know the holder's address ahead of time.
The token can be transferred before expiry, placed in a multisignature wallet, or
held by another script.

This is the recommended beneficiary-free mode because the right is explicit,
transferable, and difficult to front-run without control of the token.

### 3. Open recovery (deferred and not implemented)

No beneficiary or recovery token is listed. After expiry, any signer may direct
the vault to an address controlled by that signer. The first valid transaction
included on-chain wins.

This could support intentional treasure drops, public bounties, or
abandoned-fund experiments. It is unsuitable for inheritance and is excluded
from version one. It must not appear as an available mode in the site or be
described as protected by the current validator.

### 4. Permanent lock

An owner who wants destruction rather than recovery can use fixed destination
mode with a published always-rejecting validator. This permanently locks the
value; it does not claim that arbitrary native assets have been burned, because
burning is controlled by each asset's minting policy.

## Vault receipt NFT

Each vault has a one-shot state-thread NFT. While active, it identifies the one
canonical state UTxO. A pulse must carry it into exactly one continuing output.
A terminal close or release burns it and atomically mints a different completion
receipt into the final payout output.

The distinction is security-critical: a completion receipt can be moved back to
the validator address, but it can never satisfy the validator's active-state
identity check. This prevents a completed plan from being presented as active
again. The unique completion receipt also prevents one payout output from being
reused to satisfy multiple vault inputs in a batched transaction.

## Asset deposits

The initial lock transaction creates the canonical state UTxO. A top-up action
may be added only if it preserves the datum, keeps the receipt NFT in exactly one
continuing output, never decreases any asset quantity, and is owner-authorized.
Until that path is specified and tested, the safe workflow is to close and create
a new vault when changing the protected bundle.

Unsolicited transfers to the script address are not automatically part of a
vault. Only the UTxO carrying the unique receipt NFT is canonical.

## Information release

On-chain datum and redeemer data are public. The core validator may store only a
commitment to an encrypted package, such as a content hash, never its plaintext
or a plaintext decryption key.

A later Secret Capsule module can combine the vault with threshold key holders:

1. encrypt the information locally;
2. store the ciphertext redundantly off-chain;
3. commit its hash in the vault;
4. divide the decryption key among independent releasers;
5. let releasers publish enough shares only after confirmed expiry.

That module introduces availability and trust assumptions that do not exist for
ordinary ADA and NFT release, so it must not be marketed as part of the pure
on-chain guarantee.

## User experience

The creation flow must show, in plain language:

- exactly which assets are protected;
- who can pulse;
- the next due time and final release time;
- the selected release policy;
- whether any address is fixed in advance;
- what happens if the owner, liveness key, recovery token, or wallet is lost;
- the fact that a third party still must submit a release transaction;
- the fact that all on-chain state is public.

Every created vault should export a human-readable recovery sheet and a
machine-readable version-three JSON manifest containing the network, validator
hash, active and completion receipt NFTs, deadlines, policy, and transaction
identifiers.

## Commercial interface

The validator is open source and imposes no operator or protocol fee. The
official website charges a 5 ADA setup-interface fee for preparing a valid vault
creation transaction. The user may bypass the website and interact with the
published validator directly without paying that interface fee. Normal Cardano
network fees and minimum-ADA requirements remain unavoidable.

The interface fee must be:

- disclosed before the user begins signing;
- shown separately from estimated Cardano network fees and locked minimum ADA;
- a flat amount rather than a percentage of protected value;
- paid directly to the operator fee address in the same atomic creation
  transaction;
- absent from pulse, close, and release transactions in the first version; and
- unenforced by the validator, so the open contract remains independently usable.

The site provides transaction-construction software, not contract management.
It never receives a seed phrase, private key, signing key, or protected vault
asset. It cannot pulse, close, redirect, freeze, reverse, or recover a user's
vault. Only the disclosed interface fee is paid to the operator.

## Eternl check-ins

Eternl is the first fully supported wallet. The site connects through Cardano's
CIP-30 wallet bridge and uses Eternl to read approved wallet UTxOs, request a
transaction signature, and submit the signed transaction.

The user-facing action is **Check in**. A successful check-in:

1. spends the current canonical vault UTxO;
2. recreates it at the same validator with exactly the same protected value;
3. changes only the check-in anchor and sequence in the datum;
4. uses a small UTxO from the connected liveness wallet to pay the Cardano fee;
5. requires the configured liveness signature; and
6. charges no site fee.

This has zero net movement of protected value, but it is still an on-chain
transaction. A CIP-30 `signData` message by itself is not a check-in because it
does not update the validator's on-chain state. The implementation uses
`signTx` for the pulse.

Detailed flow and security requirements are in `SITE_SPEC.md`. Legal statements
are product claims that must remain factually true and be reviewed by qualified
counsel; they are not a substitute for compliant architecture.
