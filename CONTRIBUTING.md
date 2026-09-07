# Contributing

Contributions should preserve Baton's non-custodial architecture and plain,
accurate transaction review.

1. Use a private security advisory for vulnerabilities.
2. Keep interface changes separate from protocol changes.
3. Add regression coverage for transaction, wallet, discovery, and manifest
   behavior.
4. Run `npm run check` before requesting review.
5. Never commit wallet files, mnemonics, signing keys, API tokens, or Mainnet
   transaction material.

Updating either compiled blueprint requires a reviewed release from
[`baton-cardano`](https://github.com/chaplinkyle/baton-cardano), a new pinned
SHA-256, complete tests, and fresh public testnet evidence.
