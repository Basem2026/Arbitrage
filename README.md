# Arbitrage Bot Dashboard (Starter)

## What
Simple starter arbitrage bot that:
- Scans multiple exchanges (via CCXT)
- Emits arbitrage opportunities to a dashboard
- Allows manual execution (buy + withdraw placeholder + sell steps)
- NOT production-ready — intended as a starting point.

## Setup
1. Clone repo.
2. `cp .env.example .env` and fill API keys (do NOT commit).
3. `npm install`
4. `npm start`
5. Open `http://your-vps-ip:3000`

## Notes
- Configure `withdrawAddresses` inside `server.js` with destination addresses for each exchange+asset.
- Many exchanges require whitelisting and special API permissions for withdrawals.
- Test thoroughly on testnets/small amounts.
