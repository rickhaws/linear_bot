# BTC/USDC Rebalancing Bot

A TypeScript bot that automatically rebalances your BTC/USDC portfolio on Kraken based on price-driven allocation targets. It uses linear interpolation to determine your target allocation: 100% USDC when price is high, 100% BTC when price is low.

## Features

- 📊 **Smart Rebalancing**: Linear interpolation between HIGH and LOW prices to determine target allocation
- 🔄 **Automatic Calculations**: Computes portfolio value, target allocation, and required trades
- 🛡️ **Risk Controls**: Respects exchange minimum order sizes and applies price precision
- 📝 **Transaction Ledger**: Logs all actions (executed, dry-run, and skipped) for audit trail
- 🔒 **Dry-Run Mode**: Test strategies without executing real trades
- 🔁 **Retry Logic**: Handles network timeouts and transient Kraken API errors
- 💰 **Smart Rounding**: Rounds trade amounts to whole dollars, $5s, or $10s for readability

## Quick Start

### 1. Prerequisites
- Node.js 14+ installed
- A Kraken account with $500 capital
- Already installed: `npm install` (ccxt and dotenv)

### 2. Setup API Keys
1. Follow the detailed instructions in [KRAKEN_API_SETUP.md](KRAKEN_API_SETUP.md)
2. Copy `.env.example` to `.env` and fill in your API credentials
3. **Keep `.env` private!** (It's already in `.gitignore`)

### 3. Configure Settings (Optional)
Edit `settings.txt` to customize:
- `HIGH`: Price at which you want 100% USDC (default: $100,000)
- `LOW`: Price at which you want 100% BTC (default: $60,000)
- `THRESHOLD`: Minimum USD difference to trigger a trade (default: $0.01)
- `DRY_RUN`: Set to `false` only when ready to trade real money (default: true)

### 4. Run the Bot

**First time - Test with DRY_RUN=true:**
```bash
npx ts-node bot.ts
```

Output will show:
- Current BTC and USDC balances
- Current mid-price (avg of bid/ask)
- Portfolio value
- Target allocation at current price
- What trade WOULD be executed

**Example output:**
```
=== BTC/USDC Rebalancing Bot ===
Settings: HIGH=100000, LOW=60000, THRESHOLD=0.01, DRY_RUN=true

Connected to Kraken

Current BTC Balance: 0.00500000
Current USDC Balance: $475.32
Current Mid Price: $82,500.00

Portfolio Value: $516.57
Target Allocation at $82,500.00: 37.5% USDC, 62.5% BTC

Target USDC Value: $193.71
Current USDC Value: $475.32
USD Difference: -$281.61

Calculated trade: BUY_BTC 0.003415 BTC (~$282)

[DRY RUN] Would execute: BUY_BTC 0.00341499 BTC (~$280)
```

**When ready - Run with live trading:**
1. Edit `settings.txt` and change `DRY_RUN=false`
2. Run `npx ts-node bot.ts`
3. Check `transaction_ledger.log` for confirmation

## How It Works

### Allocation Formula
```
USDC % = (Price - LOW) / (HIGH - LOW)
BTC % = 1 - USDC %
```

**Examples:**
- Price = $60,000 (LOW): 0% USDC, 100% BTC
- Price = $80,000 (midpoint): 50% USDC, 50% BTC
- Price = $100,000 (HIGH): 100% USDC, 0% BTC

### Trade Logic
1. **Calculate target portfolio allocation** based on current price
2. **Calculate what target portfolio values should be** for each asset
3. **Compare to current balances** - determine how much needs buying/selling
4. **Check against minimum trade size** - Kraken has minimums to prevent spam
5. **Apply precision** - Use `exchange.amountToPrecision()` to avoid formatting errors
6. **Execute or log** - Either place the real trade or log it in DRY_RUN mode

### Example Scenario
Your $500 portfolio at $82,500 BTC price:
- Target: 37.5% USDC ($187.50) + 62.5% BTC ($312.50)
- Current: $475.32 USDC + $0.005 BTC ($412.50)
- **Difference**: Need to buy $281.61 worth of BTC (rebalance)
- **Trade**: Sell ~$280 USDC to buy ~0.00341 BTC

## Transaction Ledger

Every run logs to `transaction_ledger.log`:

```
2026-04-13T14:23:45.123Z | [DRY_RUN] | BUY_BTC | Amount: 0.00341499 BTC | Price: $82,500.00 | Total: $280.00
2026-04-13T14:25:33.456Z | [EXECUTED] | SELL_BTC | Amount: 0.00500000 BTC | Price: $85,000.00 | Total: $425.00
2026-04-13T14:27:10.789Z | [SKIPPED] | BUY_BTC | Amount: 0.00050000 BTC | Price: $82,300.00 | Total: $41.15 | Reason: Amount below minimum (0.0001 BTC)
```

## Troubleshooting

### "KRAKEN_API_KEY and KRAKEN_API_SECRET must be set"
- Make sure `.env` exists in the bot directory
- Check that it contains both `KRAKEN_API_KEY=...` and `KRAKEN_API_SECRET=...`
- No spaces around the `=` sign

### "Failed to fetch balance after 3 attempts"
- Check your internet connection
- Verify API key has "Query Funds" permission
- Kraken API may be temporarily down

### "Trade amount is below minimum"
- The calculated trade is too small
- Increase `THRESHOLD` in `settings.txt` or
- Wait for a larger price movement to trigger bigger rebalances

### "Invalid API key"
- Copy the keys carefully (no extra spaces/characters)
- Regenerate the key in Kraken if unsure
- Make sure it's not been suspended by Kraken

## Important Notes

⚠️ **Backtested vs Live Trading**
- This bot makes trades based on a mathematical formula
- Always test with DRY_RUN=true first
- Start with small capital amounts
- Monitor your first few trades manually

⚠️ **Slippage & Fees**
- Market orders may execute at slightly worse prices than the mid-price shown
- Kraken charges trading fees (~0.16-0.26% on market orders)
- These are NOT included in the profit/loss calculations

⚠️ **Kraken Limits**
- Kraken has minimum order sizes (typically 0.0001 BTC on BTC/USDC)
- You can't trade fractional amounts below the precision limit
- The bot checks these automatically and skips trades below minimums

## Security Checklist

✅ Do these:
- [ ] Use API key restricted to "Trading" permissions only
- [ ] Disable "Withdraw Funds" permission completely
- [ ] Set IP whitelist in Kraken to your home/office IP
- [ ] Keep `.env` out of version control (it's in `.gitignore`)
- [ ] Regenerate API keys every few months
- [ ] Monitor your Kraken account regularly

❌ Don't do these:
- [ ] Share your `.env` file or Private Key
- [ ] Commit `.env` to GitHub
- [ ] Use an API key with withdrawal permissions
- [ ] Leave the bot unmonitored for weeks

## Running on Schedule

### Windows Task Scheduler (Recommended)

The easiest way is to use the provided setup script:

1. **Open PowerShell as Administrator**
   - Search for "PowerShell" in Start menu
   - Right-click → "Run as Administrator"

2. **Run the setup script:**
   ```powershell
   cd C:\Users\rickh\Documents\programming\linear_bot
   .\setup-task-scheduler.ps1
   ```

3. **Task is now scheduled!**
   - Runs every hour automatically
   - Continues running even after reboots
   - All output logged to `bot_output.log`

**To verify it's working:**
- Open Task Scheduler (search in Start menu)
- Look for "BTC_Rebalancing_Bot" in the task list
- Right-click → "View History" to see recent executions
- Check `bot_output.log` to see what happened in each run

**To manually trigger a run (for testing):**
- Right-click the task in Task Scheduler → "Run"

### Linux/Mac Cron

```bash
0 * * * * cd /path/to/bot && npx ts-node bot.ts >> bot.log 2>&1
```

## License

ISC
