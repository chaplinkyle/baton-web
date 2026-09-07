# Contract artifacts

This repository vendors two immutable Plutus blueprints:

| File | Purpose | SHA-256 |
|---|---|---|
| `lib/plutus.json` | Current Baton `0.1.0-rc.10` candidate | `b0809a00186e40ffca51511dbd81086d642be7149b6d1852fe127fc1822d22fc` |
| `lib/plutus.rc9.json` | Compatibility for plans created before the Baton asset-name transition | `fabc367f2f0c329ad0259d69c8bf46338473f517976bb730d0dbe10d30ab5800` |

The canonical Aiken source, tests, release manifest, and audit materials are in
[`chaplinkyle/baton-cardano`](https://github.com/chaplinkyle/baton-cardano).
`npm run blueprint:check` fails if either vendored artifact changes.

The compatibility blueprint is never used for new plans. It remains solely so
immutable testnet plans created with the older on-chain asset names stay
discoverable and actionable.
