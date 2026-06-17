# metter

Lightweight TypeScript client for the Meteora DLMM API, with Zod-validated responses

## Installation

```bash
bun add metter
```

## Usage

```typescript
import { MeteoraDlmmClient, METEORA_DLMM_DEVNET_URL } from 'metter';

const client = new MeteoraDlmmClient();
// Default: mainnet. To use devnet, pass { baseUrl: METEORA_DLMM_DEVNET_URL }.

const portfolio = await client.getOpenPortfolio({
  user: 'ARwi1S4DaiTG5DX7S4M4ZsrXqpMD1MrTmbu9ue2tpmEq', // Solana wallet address
  page: 1,
  pageSize: 20,
  sortBy: 'current_balances',
  sortDirection: 'desc',
});

console.log(portfolio.totalCount);          // number of pools with open positions
console.log(portfolio.total?.balances);     // aggregated USD balance (string)
for (const pool of portfolio.pools) {
  console.log(pool.tokenX, pool.tokenY, pool.balances, pool.unclaimedFees);
}
```

```typescript
// Per-position PnL for one pool:
const pnl = await client.getPositionPnl(
  'DQ9weJhfiU4iL5LUoeshDrm5KxDHCMiSbnnKJz7buMcf', // pool address
  { user: 'ARwi1S4DaiTG5DX7S4M4ZsrXqpMD1MrTmbu9ue2tpmEq', status: 'open' },
);

for (const pos of pnl.positions) {
  console.log(pos.positionAddress, pos.pnlUsd, pos.allTimeFees.total.usd);
  if (pos.unrealizedPnl) console.log('  live:', pos.unrealizedPnl.balances);
}
```

Responses are validated at runtime with Zod; the exported `OpenPortfolioSchema` (and friends) let you re-validate or parse API data yourself.

## Contributing

Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for contribution guidelines.

## License

MIT
