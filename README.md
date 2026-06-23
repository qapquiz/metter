# metter

Lightweight TypeScript client for the Meteora DLMM API, with Zod-validated responses

## Installation

```bash
bun add meteora-metter
```

## Usage

```typescript
import { MeteoraDlmmClient, METEORA_DLMM_DEVNET_URL } from 'meteora-metter';

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

```typescript
// OHLCV price history for a pool (use with getPositionPnl's minPrice/maxPrice
// to overlay an LP position's range on a price chart):
const ohlcv = await client.getOhlcv('DQ9weJhfiU4iL5LUoeshDrm5KxDHCMiSbnnKJz7buMcf', {
  timeframe: '1h',
  start_time: Math.floor(Date.now() / 1000) - 24 * 60 * 60, // last 24h
});

for (const candle of ohlcv.data) {
  console.log(candle.timestamp_str, candle.open, candle.high, candle.low, candle.close);
}
```

### `allTimeDeposits` is gross — use `getNetDeposits` for your real cost basis

`pos.allTimeDeposits` and `pos.allTimeWithdrawals` are running **gross** totals of every
event, summed independently. A deposit → withdraw → deposit cycle inflates both, so
the gross `8.4 SOL deposited` is meaningless when you actually only have ~4.5 SOL at
risk. `getNetDeposits` nets them (exact, no float rounding) into the same shape as
`allTimeDeposits`:

```typescript
import { MeteoraDlmmClient, getNetDeposits } from 'meteora-metter';

const pnl = await client.getPositionPnl(poolAddress, { user: wallet, status: 'open' });
const real = getNetDeposits(pnl.positions[0]);

console.log(real.tokenY.amount); // net token actually at risk, e.g. '4.498975489' SOL
console.log(real.total.usd);     // net USD cost basis
```

This is your true cost basis — the net capital committed. It is *not* the current
composition of the position (the AMM may have rebalanced between tokenX/tokenY as
price crossed your bins); read `pos.unrealizedPnl` for live balances.

Responses are validated at runtime with Zod; the exported `OpenPortfolioSchema` (and friends) let you re-validate or parse API data yourself.

## Contributing

Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for contribution guidelines.

## License

MIT

## Releasing

Releases are triggered by pushing a `v*` tag, which runs the `Release` workflow
([`.github/workflows/release.yml`](./.github/workflows/release.yml)): it builds,
tests, lints, packs, and publishes `meteora-metter` to npm with build provenance.

To cut a release locally:

```bash
bun run release   # bumpp: bumps version, commits, pushes, and creates the v* tag
```

Before the first release, create an **Actions secret named `NPM_TOKEN`** in the
repo settings (Settings → Secrets and variables → Actions → New repository
secret) containing an npm access token with publish rights for `meteora-metter`
(automation-scope or a granular publish token). Without it, the publish step
fails with `ENEEDAUTH`.
