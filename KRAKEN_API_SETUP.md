# Kraken API Key Setup Guide

## How to Get Your Kraken API Key and Secret

### Step 1: Log in to Kraken
1. Go to [Kraken.com](https://www.kraken.com)
2. Log in to your account

### Step 2: Navigate to API Settings
1. Click on your **profile icon** (top right)
2. Select **Settings**
3. Click on **API** in the left sidebar

### Step 3: Generate a New API Key
1. Click **Generate New Key**
2. Fill in the form:
   - **Key Label**: Name it something like `BTC_USDC_Bot`
   - **Select Nonce Window**: Leave as default (or set to 0)

### Step 4: Select Permissions
For the rebalancing bot, you need "Trading" permissions:
- ✅ Check the **Query Funds** checkbox (required to see balances)
- ✅ Check the **Query Open Orders & Trades** checkbox (optional but recommended)
- ✅ Check the **Query Closed Orders & Trades** checkbox (optional but recommended)
- ✅ Check the **Create & Modify Orders** checkbox (required to place trades)
- ✅ Check the **Cancel/Close Orders** checkbox (optional but recommended)

⚠️ **DO NOT** enable **Withdraw Funds** or other sensitive permissions if you don't need them.

### Step 5: Set API Key Trade Restrictions (Recommended)
You can optionally restrict API key trades to specific pairs:
- Under "Nonce Window", you may see options to restrict which currency pairs can be traded
- For this bot, restrict to: **BTC/USDC** (or **XBTUSDC** depending on Kraken's naming)

### Step 6: Copy Your Keys
1. You'll see two values:
   - **API Key**: Copy this (it looks like a long random string)
   - **Private Key**: Copy this (it also looks like a long random string)

⚠️ **CRITICAL**: The Private Key is only shown ONCE. Save it immediately!

### Step 7: Add to .env File
1. Open or create the `.env` file in the bot directory
2. Add the following lines:

```env
KRAKEN_API_KEY=your_api_key_here
KRAKEN_API_SECRET=your_private_key_here
```

Replace `your_api_key_here` and `your_private_key_here` with the actual values from Kraken.

Example (DO NOT use these values):
```env
KRAKEN_API_KEY=vHkqa8PO4eDVXe8S7sKj9mN3bP7qRsT2uVwXyZaBcD4EfGhIjKlMnOpQrStUvWxYz
KRAKEN_API_SECRET=AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsT+TuVuVwWwXxXyYyZz1234567890
```

### Step 8: Test the Connection
1. Make sure your `.env` file is saved
2. Run the bot: `npm run dev` (or `npx ts-node bot.ts`)
3. It should connect and show your current balances

## Security Best Practices

✅ **DO**:
- Keep your `.env` file secure (add to `.gitignore`)
- Use a unique API key for this bot
- Restrict API key permissions to minimum required
- Monitor your Kraken account for suspicious activity
- Regenerate keys periodically

❌ **DON'T**:
- Share your Private Key with anyone
- Commit `.env` to version control
- Use an API key with withdrawal permissions for a trading bot
- Give the bot more permissions than it needs

## Troubleshooting

**"Invalid API key"**
- Double-check that you copied the keys correctly (no extra spaces)
- Make sure the `.env` file is being loaded (check that you ran `dotenv.config()`)

**"CCXT Kraken authentication failed"**
- Verify the API key is still active in Kraken settings
- Check if Kraken has suspended your API key (this sometimes happens if there are too many failed requests)

**"Permission denied" when placing orders**
- Make sure you've enabled "Create & Modify Orders" permission on the API key
- Check that the IP address whitelist (if set) includes your current IP
