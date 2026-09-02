# Security

- Never commit `.env`, `config.json`, private keys, seed phrases, API secrets, or Telegram bot tokens.
- Exchange API credentials must be read-only. Disable trading, transfer, withdrawal, and sub-account management permissions.
- Use IP allowlists when the exchange supports them.
- Treat generated snapshots as sensitive financial data. Keep the repository private if real balances or wallet addresses are committed.
- This project does not sign or broadcast transactions.

If a secret is committed, revoke it immediately and remove it from Git history before sharing the repository.
