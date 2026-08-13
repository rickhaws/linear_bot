import ccxt from 'ccxt';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadSettings() {
  const settingsPath = path.join(__dirname, 'settings.txt');
  const defaultSettings = {
    HIGH: 137500,
    LOW: 52500,
    THRESHOLD_PERCENTAGE: 0.5,
    SYMBOL: 'BTC/USDC',
    DRY_RUN: true,
    MIN_TRADE_SIZE: 10,
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
    if (key === 'THRESHOLD_PERCENTAGE') settings.THRESHOLD_PERCENTAGE = parseFloat(value);
    if (key === 'SYMBOL') settings.SYMBOL = value;
    if (key === 'DRY_RUN') settings.DRY_RUN = value.toLowerCase() === 'true';
    if (key === 'MIN_TRADE_SIZE') settings.MIN_TRADE_SIZE = parseFloat(value);
  });

  return settings;
}

async function initializeKrakenWithRetry() {
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function calculateTargetAllocation(price, LOW, HIGH) {
  if (price >= HIGH) return 1.0; // 100% Quote (USDC)
  if (price <= LOW) return 0.0;  // 100% Base (BTC)
  return (price - LOW) / (HIGH - LOW);
}

async function fetchBalance(exchange, symbol, maxRetries = 3) {
  let lastError = null;
  const [base, quote] = symbol.split('/');

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const balance = await exchange.fetch_balance();
      return {
        base: balance[base]?.free || 0,
        quote: balance[quote]?.free || 0,
      };
    } catch (error) {
      lastError = error;
      console.warn(`Fetch balance attempt ${attempt}/${maxRetries} failed: ${error.message}`);
      if (attempt < maxRetries) await sleep(1000 * attempt);
    }
  }

  throw new Error(`Failed to fetch balance after ${maxRetries} attempts: ${lastError?.message}`);
}

async function fetchTicker(exchange, symbol, maxRetries = 3) {
  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await exchange.fetch_ticker(symbol);
    } catch (error) {
      lastError = error;
      console.warn(`Fetch ticker attempt ${attempt}/${maxRetries} failed: ${error.message}`);
      if (attempt < maxRetries) await sleep(1000 * attempt);
    }
  }

  throw new Error(`Failed to fetch ticker after ${maxRetries} attempts: ${lastError?.message}`);
}

function logTransaction(log) {
  const logFile = path.join(__dirname, 'transaction_ledger.log');
  const statusStr = log.status === 'dryrun' ? '[DRY_RUN]' : log.status === 'skipped' ? '[SKIPPED]' : '[EXECUTED]';
  let logEntry = '';
  
  if (log.status === 'skipped') {
    const reasonStr = log.reason ? ` | Reason: ${log.reason}` : '';
    logEntry = `${log.timestamp} | ${statusStr} | ${log.action} | Price: $${log.price.toFixed(2)}${reasonStr}\n`;
  } else {
    logEntry = `${log.timestamp} | ${statusStr} | ${log.action} | Price: $${log.price.toFixed(2)} | Amount: ${log.btcAmount} | Total: $${log.totalUSD.toFixed(2)}\n`;
  }

  try {
    fs.appendFileSync(logFile, logEntry);
  } catch (error) {
    console.error(`Failed to write to transaction ledger: ${error}`);
  }
}

async function main() {
  try {
    const settings = loadSettings();
    const [baseAsset, quoteAsset] = settings.SYMBOL.split('/');
    console.log(`=== Linear Rebalancing Bot (12h Execution) ===`);
    console.log(`Settings: SYMBOL=${settings.SYMBOL}, HIGH=$${settings.HIGH}, LOW=$${settings.LOW}, THRESHOLD=${settings.THRESHOLD_PERCENTAGE}%, DRY_RUN=${settings.DRY_RUN}\n`);

    const exchange = await initializeKrakenWithRetry();
    await exchange.loadMarkets();

    const balance = await fetchBalance(exchange, settings.SYMBOL);
    const ticker = await fetchTicker(exchange, settings.SYMBOL);
    const currentPrice = (ticker.bid + ticker.ask) / 2;

    const logData = {
      timestamp: new Date().toLocaleString(),
      price: currentPrice,
      action: 'CHECK_ONLY',
      btcAmount: '0',
      totalUSD: 0,
      status: 'skipped',
    };

    const portfolioValueUSD = balance.base * currentPrice + balance.quote;
    console.log(`Portfolio Value: $${portfolioValueUSD.toFixed(2)}`);
    console.log(`Current ${baseAsset}: ${balance.base.toFixed(8)}`);
    console.log(`Current ${quoteAsset}: $${balance.quote.toFixed(2)}`);
    console.log(`Current Mid Price: $${currentPrice.toFixed(2)}\n`);

    const initialBTCPercentage = (balance.base * currentPrice) / portfolioValueUSD;
    const targetUSDCPercentage = calculateTargetAllocation(currentPrice, settings.LOW, settings.HIGH);
    const targetBTCPercentage = 1 - targetUSDCPercentage;

    console.log(`Current Allocation: ${(initialBTCPercentage * 100).toFixed(1)}% ${baseAsset}`);
    console.log(`Target Allocation:  ${(targetBTCPercentage * 100).toFixed(1)}% ${baseAsset}\n`);

    const targetUSDCValue = portfolioValueUSD * targetUSDCPercentage;
    const currentUSDCValue = balance.quote;
    const usdDifference = targetUSDCValue - currentUSDCValue;

    // Check threshold
    const threshold = portfolioValueUSD * (settings.THRESHOLD_PERCENTAGE / 100);
    if (Math.abs(usdDifference) < threshold) {
      console.log(`Difference $${Math.abs(usdDifference).toFixed(2)} is below threshold ($${threshold.toFixed(2)}). Skipping.\n`);
      logTransaction({
        ...logData,
        reason: `Difference below ${settings.THRESHOLD_PERCENTAGE}% threshold`,
      });
      return;
    }

    const market = exchange.market(settings.SYMBOL);
    const minBTCAmount = market.limits.amount.min || 0.0001;

    let action;
    let tradeAmountBTC = Math.abs(usdDifference) / currentPrice;
    let tradeAmountUSD = Math.abs(usdDifference);

    if (usdDifference > 0) {
      action = `SELL_${baseAsset}`;
    } else {
      action = `BUY_${baseAsset}`;
    }

    if (tradeAmountBTC < minBTCAmount) {
      console.log(`Trade amount ${tradeAmountBTC.toFixed(8)} is below minimum size (${minBTCAmount}). Skipping.`);
      logTransaction({ ...logData, reason: `Amount below exchange min (${minBTCAmount})` });
      return;
    }

    if (tradeAmountUSD < settings.MIN_TRADE_SIZE) {
      console.log(`Trade amount $${tradeAmountUSD.toFixed(2)} is below MIN_TRADE_SIZE ($${settings.MIN_TRADE_SIZE}). Skipping.`);
      logTransaction({ ...logData, reason: `Amount below MIN_TRADE_SIZE` });
      return;
    }

    const precisionBTC = exchange.amountToPrecision(settings.SYMBOL, tradeAmountBTC);
    logData.action = action;
    logData.btcAmount = precisionBTC;
    logData.totalUSD = tradeAmountUSD;

    if (settings.DRY_RUN) {
      console.log(`[DRY RUN] Would execute MAKER order: ${action} ${precisionBTC} ${baseAsset} (~$${tradeAmountUSD.toFixed(2)})\n`);
      logTransaction({ ...logData, status: 'dryrun' });
    } else {
      console.log(`Executing Live MAKER Order: ${action} ${precisionBTC} ${baseAsset}...\n`);

      // MAKER Execution Logic with postOnly = true
      let rawLimitPrice;
      if (action.startsWith('SELL')) {
        rawLimitPrice = ticker.ask; // Post at ask to earn maker fee
      } else {
        rawLimitPrice = ticker.bid; // Post at bid to earn maker fee
      }

      const limitPrice = exchange.priceToPrecision(settings.SYMBOL, rawLimitPrice);

      try {
        const order = await exchange.createOrder(
          settings.SYMBOL,
          'limit',
          action.startsWith('SELL') ? 'sell' : 'buy',
          parseFloat(precisionBTC),
          parseFloat(limitPrice),
          { postOnly: true } // Ensures order is posted as Maker
        );

        console.log(`Maker order placed successfully! Order ID: ${order.id}\n`);
        logTransaction({ ...logData, status: 'success' });
      } catch (error) {
        console.error(`Maker order failed/rejected (may have crossed market): ${error.message}`);
        logTransaction({ ...logData, reason: `Maker execution error: ${error.message}` });
        throw error;
      }
    }
  } catch (error) {
    console.error(`\n❌ Execution Error: ${error.message}\n`);
    process.exit(1);
  }
}

main();