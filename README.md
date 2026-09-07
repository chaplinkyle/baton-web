# Baton Web

[![Application CI](https://github.com/chaplinkyle/baton-web/actions/workflows/ci.yml/badge.svg)](https://github.com/chaplinkyle/baton-web/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-6e67b1.svg)](LICENSE)
[![Network: Preprod](https://img.shields.io/badge/network-Preprod-c79b58.svg)](CONTRACTS.md)

The non-custodial reference interface for the
[`Baton Cardano protocol`](https://github.com/chaplinkyle/baton-cardano). It
connects to Eternl through CIP-30 and builds transactions for creating,
checking in to, closing, releasing, discovering, and independently verifying
Baton plans.

> **Preprod only.** This application deliberately blocks Mainnet unless a
> separately reviewed release acknowledgement is configured. Do not use this
> candidate with valuable assets.

<p align="center">
  <img src="public/baton-cradle.png" width="420" alt="A Baton relay object resting in a protective cradle" />
</p>

## Trust model

- Eternl holds the user's keys and signs every transaction.
- The interface never receives a seed phrase or private key.
- Every transaction is constructed and checked in the browser before signing.
- The contract has no mandatory fee. This reference interface adds a disclosed
  5 ADA service output only when a creation transaction succeeds.
- Check-ins, owner closes, and releases add no interface fee.
- Existing plans remain on Cardano and do not depend on this website staying
  online.

## Contract dependency

The current `0.1.0-rc.10` blueprint is pinned to SHA-256
`b0809a00186e40ffca51511dbd81086d642be7149b6d1852fe127fc1822d22fc`.
See [CONTRACTS.md](CONTRACTS.md) for the current artifact and the frozen rc.9
compatibility artifact. `npm run blueprint:check` fails on any unreviewed
change.

## Run locally

Requirements: Node.js 22.13 or newer and Eternl configured for Cardano Preprod.

```bash
cp .env.example .env.local
npm ci
npm run dev
```

Open `http://localhost:3000`.

## Validate

```bash
npm run check
npm run test:network
```

`npm run check` runs linting, TypeScript, pinned-blueprint checks, deterministic
unit and emulator tests, and a production Next.js build. `test:network` is kept
separate because it queries public Preprod infrastructure.

## Repository boundaries

This repository owns the website, Eternl connection, transaction builders,
plan discovery, and interface policy. It does not own the Aiken validator. The
canonical contract, protocol specification, threat model, tests, and audit
materials live in
[`chaplinkyle/baton-cardano`](https://github.com/chaplinkyle/baton-cardano).

## License

[MIT](LICENSE). The interface is software, not a bank, custodian, will, trust,
or proof of death. It is provided without warranty.
