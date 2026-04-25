import ccxt from 'ccxt';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';

// Load environment variables
dotenv.config();

// Get the directory of the current file (works on Windows and Unix)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load settings from settings.txt
function loadSettings() {
  const settingsPath = path.join(__dirname, 'settings.txt');
  const defaultSettings = {
    HIGH: 100000,
    LOW: 60000,
    THRESHOLD: 0.01,
    DRY_RUN: true,
  };

  if (!fs.existsSync(settingsPath)) {
    console.log(`settings.txt not found, using defaults`);
    return defaultSettings;
  }

  const content = fs.readFileSync(settingsPath, 'utf-8');
  const settings = { ...defaultSettings };

  content.split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;

    const [key, value] = trimmed.split('=').map((s) => s.trim());
    if (key === 'HIGH') settings.HIGH = parseFloat(value);
    if (key === 'LOW') settings.LOW = parseFloat(value);
    if (key === 'THRESHOLD') settings.THRESHOLD = parseFloat(value);
    if (key === 'DRY_RUN') settings.DRY_RUN = value.toLowerCase() === 'true';
  });

  return settings;
}

// Initialize Kraken exchange with retry logic
async function initializeKrakenWithRetry(maxRetries = 3) {
  const apiKey = process.env.KRAKEN_API_KEY;
  const apiSecret = process.env.KRAKEN_API_SECRET;

  if (!apiKey || !apiSecret) {
    throw new Error('KRAKEN_API_KEY and KRAKEN_API_SECRET must be set in .env file');
  }

  return new ccxt.kraken({
    apiKey,
    secret: apiSecret,
    enableRateLimit: true,
    timeout: 10000,
  });
}

// Calculate target USDC percentage based on price (linear interpolation)
function calculateTargetAllocation(price, LOW, HIGH) {
  if (price >= HIGH) return 1.0; // 100% USDC
  if (price <= LOW) return 0.0; // 100% BTC (0% USDC)
  return (price - LOW) / (HIGH - LOW);
}

// Fetch current balance with error handling
async function fetchBalance(exchange, maxRetries = 3) {
  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const balance = await exchange.fetch_balance();
      return {
        btc: balance.BTC?.free || 0,
        usdc: balance.USDC?.free || 0,
      };
    } catch (error) {
      lastError = error;
      console.warn(`Fetch balance attempt ${attempt}/${maxRetries} failed: ${error.message}`);
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
    }
  }

  throw new Error(`Failed to fetch balance after ${maxRetries} attempts: ${lastError?.message}`);
}

// Fetch mid price (average of bid/ask) with error handling
async function fetchMidPrice(exchange, maxRetries = 3) {
  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const ticker = await exchange.fetch_ticker('BTC/USDC');
      return (ticker.bid + ticker.ask) / 2;
    } catch (error) {
      lastError = error;
      console.warn(`Fetch price attempt ${attempt}/${maxRetries} failed: ${error.message}`);
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
    }
  }

  throw new Error(`Failed to fetch price after ${maxRetries} attempts: ${lastError?.message}`);
}

// Round amount for readability
function roundTradeAmount(amount) {
  if (amount >= 10) return Math.round(amount / 10) * 10;
  if (amount >= 5) return Math.round(amount / 5) * 5;
  return Math.round(amount);
}

// Log transaction to ledger file
function logTransaction(log) {
  const logFile = path.join(__dirname, 'transaction_ledger.log');
  const statusStr = log.status === 'dryrun' ? '[DRY_RUN]' : log.status === 'skipped' ? '[SKIPPED]' : '[EXECUTED]';
  const reasonStr = log.reason ? ` | Reason: ${log.reason}` : '';
  const logEntry = `${log.timestamp} | ${statusStr} | ${log.action} | Amount: ${log.btcAmount} BTC | Price: $${log.price.toFixed(2)} | Total: $${log.totalUSD.toFixed(2)}${reasonStr}\n`;

  try {
    fs.appendFileSync(logFile, logEntry);
  } catch (error) {
    console.error(`Failed to write to transaction ledger: ${error}`);
  }
}

// Main execution
async function main() {
  try {
    const settings = loadSettings();
    console.log('=== BTC/USDC Rebalancing Bot ===');
    console.log(`Settings: HIGH=$${settings.HIGH}, LOW=$${settings.LOW}, THRESHOLD=$${settings.THRESHOLD}, DRY_RUN=${settings.DRY_RUN}\n`);

    // Initialize exchange
    let exchange;
    try {
      exchange = await initializeKrakenWithRetry();
      console.log('Connected to Kraken\n');
    } catch (error) {
      throw new Error(`Failed to initialize Kraken connection: ${error}`);
    }

    // Fetch current data with retries
    const balance = await fetchBalance(exchange);
    const midPrice = await fetchMidPrice(exchange);

    console.log(`Current BTC Balance: ${balance.btc.toFixed(8)}`);
    console.log(`Current USDC Balance: $${balance.usdc.toFixed(2)}`);
    console.log(`Current Mid Price: $${midPrice.toFixed(2)}\n`);

    // Calculate portfolio value
    const portfolioValueUSD = balance.btc * midPrice + balance.usdc;
    console.log(`Portfolio Value: $${portfolioValueUSD.toFixed(2)}`);

    // Calculate target allocation based on current price
    const targetUSDCPercentage = calculateTargetAllocation(midPrice, settings.LOW, settings.HIGH);
    const targetBTCPercentage = 1 - targetUSDCPercentage;

    console.log(
      `Target Allocation at $${midPrice.toFixed(2)}: ${(targetUSDCPercentage * 100).toFixed(1)}% USDC, ${(targetBTCPercentage * 100).toFixed(1)}% BTC\n`
    );

    // Calculate required rebalancing
    const targetUSDCValue = portfolioValueUSD * targetUSDCPercentage;
    const currentUSDCValue = balance.usdc;
    const usdDifference = targetUSDCValue - currentUSDCValue;

    console.log(`Target USDC Value: $${targetUSDCValue.toFixed(2)}`);
    console.log(`Current USDC Value: $${currentUSDCValue.toFixed(2)}`);
    console.log(`USD Difference: $${usdDifference.toFixed(2)}`);

    // Check if rebalancing is needed
    if (Math.abs(usdDifference) < settings.THRESHOLD) {
      console.log(`\nDifference is below threshold ($${settings.THRESHOLD}). No action needed.\n`);
      logTransaction({
        timestamp: new Date().toISOString(),
        action: 'CHECK_ONLY',
        btcAmount: '0',
        price: midPrice,
        totalUSD: 0,
        dryRun: settings.DRY_RUN,
        status: 'skipped',
        reason: `Difference $${Math.abs(usdDifference).toFixed(2)} below threshold $${settings.THRESHOLD}`,
      });
      return;
    }

    // Get market information and limits
    let market;
    try {
      market = exchange.market('BTC/USDC');
    } catch (error) {
      throw new Error(`Failed to fetch market info for BTC/USDC: ${error}`);
    }

    const minBTCAmount = market.limits.amount.min || 0.001;
    console.log(`\nMinimum BTC order size on Kraken: ${minBTCAmount} BTC`);

    // Determine trade type and amount
    let action;
    let tradeAmountBTC;
    let tradeAmountUSD;

    if (usdDifference > 0) {
      // Need more USDC: sell BTC
      tradeAmountBTC = Math.abs(usdDifference) / midPrice;
      tradeAmountUSD = tradeAmountBTC * midPrice;
      action = 'SELL_BTC';
    } else {
      // Need more BTC: buy BTC (sell USDC)
      tradeAmountBTC = Math.abs(usdDifference) / midPrice;
      tradeAmountUSD = Math.abs(usdDifference);
      action = 'BUY_BTC';
    }

    console.log(`\nCalculated trade: ${action} ${tradeAmountBTC.toFixed(8)} BTC (~$${tradeAmountUSD.toFixed(2)})`);

    // Check minimum amount
    if (tradeAmountBTC < minBTCAmount) {
      console.log(
        `Trade amount ${tradeAmountBTC.toFixed(8)} BTC is below minimum ${minBTCAmount}. No action taken.\n`
      );
      logTransaction({
        timestamp: new Date().toISOString(),
        action,
        btcAmount: tradeAmountBTC.toFixed(8),
        price: midPrice,
        totalUSD: tradeAmountUSD,
        dryRun: settings.DRY_RUN,
        status: 'skipped',
        reason: `Amount below minimum (${minBTCAmount} BTC)`,
      });
      return;
    }

    // Apply precision to avoid formatting errors
    let precisionBTC;
    try {
      precisionBTC = exchange.amountToPrecision('BTC/USDC', tradeAmountBTC);
    } catch (error) {
      throw new Error(`Failed to apply precision: ${error}`);
    }

    const roundedUSD = roundTradeAmount(tradeAmountUSD);

    if (settings.DRY_RUN) {
      console.log(`[DRY RUN] Would execute: ${action} ${precisionBTC} BTC (~$${roundedUSD})\n`);
      logTransaction({
        timestamp: new Date().toISOString(),
        action,
        btcAmount: precisionBTC,
        price: midPrice,
        totalUSD: roundedUSD,
        dryRun: true,
        status: 'dryrun',
      });
    } else {
      console.log(`Executing live trade: ${action} ${precisionBTC} BTC (~$${roundedUSD})\n`);

      try {
        let orderId;
        if (action === 'SELL_BTC') {
          const order = await exchange.create_market_sell_order('BTC/USDC', parseFloat(precisionBTC));
          orderId = order.id;
        } else {
          const order = await exchange.create_market_buy_order('BTC/USDC', parseFloat(precisionBTC));
          orderId = order.id;
        }

        console.log(`Trade executed successfully! Order ID: ${orderId}\n`);

        logTransaction({
          timestamp: new Date().toISOString(),
          action,
          btcAmount: precisionBTC,
          price: midPrice,
          totalUSD: roundedUSD,
          dryRun: false,
          status: 'success',
        });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`Trade execution failed: ${errorMsg}\n`);

        logTransaction({
          timestamp: new Date().toISOString(),
          action,
          btcAmount: precisionBTC,
          price: midPrice,
          totalUSD: roundedUSD,
          dryRun: false,
          status: 'skipped',
          reason: `Execution error: ${errorMsg}`,
        });

        throw error;
      }
    }
  } catch (error) {
    if (error instanceof Error) {
      console.error(`\n❌ Error: ${error.message}\n`);
    } else {
      console.error(`\n❌ Unknown error occurred\n`);
    }
    process.exit(1);
  }
}

main();
