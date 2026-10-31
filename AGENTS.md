# Kaizen

Rust server (`crates/`) plus a SolidJS frontend (`web/`). Read `handoff.md`
first, then `docs/ARCHITECTURE.md`.

- Schema changes go in a new numbered file in `crates/kaizen-server/migrations/`.
- Checks: `cargo test --workspace`, `cargo clippy --workspace --all-targets`,
  `cd web && npx vite build`.
- The live Anki collection is connected locally; Anki features touch it.
- The original Next.js app is on the `kaizen-non-rust` branch.
