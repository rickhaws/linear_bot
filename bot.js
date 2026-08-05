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
    THRESHOLD_PERCENTAGE: 1.5,
    SYMBOL: 'BTC/USDC',
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
    if (key === 'THRESHOLD_PERCENTAGE') settings.THRESHOLD_PERCENTAGE = parseFloat(value);
    if (key === 'SYMBOL') settings.SYMBOL = value;
    if (key === 'DRY_RUN') settings.DRY_RUN = value.toLowerCase() === 'true';
    if (key === 'MIN_TRADE_SIZE') settings.MIN_TRADE_SIZE = parseFloat(value);
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

// Helper for delay
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Calculate target USDC percentage based on price (linear interpolation)
function calculateTargetAllocation(price, LOW, HIGH) {
  if (price >= HIGH) return 1.0; // 100% USDC
  if (price <= LOW) return 0.0; // 100% BTC (0% USDC)
  return (price - LOW) / (HIGH - LOW);
}

// Fetch current balance with error handling
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
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
        await sleep(1000 * attempt);
      }
    }
  }

  throw new Error(`Failed to fetch balance after ${maxRetries} attempts: ${lastError?.message}`);
}

// Fetch mid price (average of bid/ask) with error handling
async function fetchMidPrice(exchange, symbol, maxRetries = 3) {
  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const ticker = await exchange.fetch_ticker(symbol);
      return (ticker.bid + ticker.ask) / 2;
    } catch (error) {
      lastError = error;
      console.warn(`Fetch price attempt ${attempt}/${maxRetries} failed: ${error.message}`);
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
        await sleep(1000 * attempt);
      }
    }
  }

  throw new Error(`Failed to fetch price after ${maxRetries} attempts: ${lastError?.message}`);
}

// Calculate volatility-based multiplier using 24h ATR (Average True Range)
async function getVolatilityAdjustment(exchange, symbol) {
  try {
    // Fetch 24 hourly candles
    const ohlcv = await exchange.fetch_ohlcv(symbol, '1h', undefined, 24);
    if (ohlcv.length < 24) return 1.0;

    // Calculate the percentage range (High - Low) / Open for each hour
    const hourlyRanges = ohlcv.map(candle => (candle[2] - candle[3]) / candle[1]);
    const avgHourlyRange = hourlyRanges.reduce((a, b) => a + b, 0) / hourlyRanges.length;

    // Define a "normal" hourly volatility (e.g., 0.5% per hour)
    const baselineVol = 0.005; 
    
    // If volatility is higher than baseline, we increase the threshold
    // If lower, we decrease it (clamped between 0.5x and 2.0x)
    const multiplier = avgHourlyRange / baselineVol;
    return Math.max(0.5, Math.min(2.0, multiplier));
  } catch (error) {
    console.warn(`Could not calculate volatility, defaulting to 1.0: ${error.message}`);
    return 1.0;
  }
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
  let logEntry = '';
  
  if (log.status === 'skipped' || log.status === 'dryrun') {
    logEntry = `${log.timestamp} | ${statusStr} | ${log.action} | Price: $${log.price.toFixed(2)} | Reason: ${log.reason}\n`;
    const reasonStr = log.reason ? ` | Reason: ${log.reason}` : '';
    logEntry = `${log.timestamp} | ${statusStr} | ${log.action} | Price: $${log.price.toFixed(2)}${reasonStr}\n`;
  }
  else {
    logEntry = `${log.timestamp} | ${statusStr} | ${log.action} | Price: $${log.price.toFixed(2)} | Amount: ${log.btcAmount} | Total: $${log.totalUSD.toFixed(2)}\n`;
  }

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
    const [baseAsset, quoteAsset] = settings.SYMBOL.split('/');
    console.log(`=== Linear Rebalancing Bot ===`);
    console.log(`Settings: SYMBOL=${settings.SYMBOL}, HIGH=$${settings.HIGH}, LOW=$${settings.LOW}, THRESHOLD_PERCENTAGE=${settings.THRESHOLD_PERCENTAGE}%, DRY_RUN=${settings.DRY_RUN}\n`);

    // Initialize exchange
    let exchange;
    try {
      exchange = await initializeKrakenWithRetry();
      console.log('Connected to Kraken\n');
    } catch (error) {
      throw new Error(`Failed to initialize Kraken connection: ${error}`);
    }

    // Fetch current data with retries
    const balance = await fetchBalance(exchange, settings.SYMBOL);
    const currentPrice = await fetchMidPrice(exchange, settings.SYMBOL);

    // Apply Volatility Adaptor
    const volMultiplier = await getVolatilityAdjustment(exchange, settings.SYMBOL);
    const adjustedThresholdPercent = settings.THRESHOLD_PERCENTAGE * volMultiplier;
    console.log(`Volatility Adjustment: ${volMultiplier.toFixed(2)}x`);
    console.log(`Dynamic Threshold: ${adjustedThresholdPercent.toFixed(2)}%\n`);

    // Initialize base log object with common values
    const logData = {
      timestamp: new Date().toLocaleString(),
      price: currentPrice,
      action: 'CHECK_ONLY',
      btcAmount: '0',
      totalUSD: 0,
      status: 'skipped',
    };

    const portfolioValueUSD = balance.base * currentPrice + balance.quote;
    const midRangePrice = (settings.HIGH + settings.LOW) / 2;
    const valueAtMidRange = balance.base * midRangePrice + balance.quote;
    console.log(`Portfolio Value: $${portfolioValueUSD.toFixed(2)}`);
    console.log(`Value at mid-range price: $${valueAtMidRange.toFixed(2)} at $${midRangePrice} USD/BTC`);
    console.log(`Current ${baseAsset} Balance: ${balance.base.toFixed(8)}`);
    console.log(`Current ${quoteAsset} Balance: $${balance.quote.toFixed(2)}`);
    console.log(`Current Price: $${currentPrice.toFixed(2)}\n`);

    // Calculate target allocation based on current price
    const initialBTCPercentage = balance.base * currentPrice / portfolioValueUSD;
    const targetUSDCPercentage = calculateTargetAllocation(currentPrice, settings.LOW, settings.HIGH);
    const targetBTCPercentage = 1 - targetUSDCPercentage;

    console.log(`Initial Allocation: ${(initialBTCPercentage * 100).toFixed(1)}% ${baseAsset}`);
    console.log(`Target Allocation:  ${(targetBTCPercentage * 100).toFixed(1)}% ${baseAsset}\n`);

    // Calculate required rebalancing
    const targetUSDCValue = portfolioValueUSD * targetUSDCPercentage;
    const currentUSDCValue = balance.quote;
    const usdDifference = targetUSDCValue - currentUSDCValue;

    console.log(`Current ${quoteAsset} Value: $${currentUSDCValue.toFixed(2)}`);
    console.log(`Target ${quoteAsset} Value:  $${targetUSDCValue.toFixed(2)}`);
    console.log(`USD Difference: $${usdDifference.toFixed(2)}`);

    // Check if rebalancing is needed
    const threshold = portfolioValueUSD * (adjustedThresholdPercent / 100);
    if (Math.abs(usdDifference) < threshold) {
      console.log(`\nDifference is below ${adjustedThresholdPercent.toFixed(2)}% threshold (${threshold.toFixed(2)}). No action needed.\n`);
      logTransaction({
        ...logData,
        reason: `Difference $${Math.abs(usdDifference).toFixed(2)} below dynamic threshold (${adjustedThresholdPercent.toFixed(2)}%)`,
      });
      return;
    }

    // Get market information and limits
    let market;
    try {
      market = exchange.market(settings.SYMBOL);
    } catch (error) {
      throw new Error(`Failed to fetch market info for ${settings.SYMBOL}: ${error}`);
    }

    const minBTCAmount = market.limits.amount.min || 0.001;
    console.log(`\nMinimum ${baseAsset} order size on Kraken: ${minBTCAmount} ${baseAsset}`);

    // Determine trade type and amount
    let action;
    let tradeAmountBTC;
    let tradeAmountUSD;

    if (usdDifference > 0) {
      // Need more USDC: sell BTC
      tradeAmountBTC = Math.abs(usdDifference) / currentPrice;
      tradeAmountUSD = tradeAmountBTC * currentPrice;
      action = `SELL_${baseAsset}`;
    } else {
      // Need more BTC: buy BTC (sell USDC)
      tradeAmountBTC = Math.abs(usdDifference) / currentPrice;
      tradeAmountUSD = Math.abs(usdDifference);
      action = `BUY_${baseAsset}`;
    }

    console.log(`\nCalculated trade: ${action} ${tradeAmountBTC.toFixed(8)} ${baseAsset} (~$${tradeAmountUSD.toFixed(2)})`);

    // Update log data for the calculated trade
    logData.action = action;
    logData.btcAmount = tradeAmountBTC.toFixed(8);
    logData.totalUSD = tradeAmountUSD;

    // Check minimum amount
    if (tradeAmountBTC < minBTCAmount) {
      console.log(
        `Trade amount ${tradeAmountBTC.toFixed(8)} ${baseAsset} is below minimum ${minBTCAmount}. No action taken.\n`
      );
      logTransaction({ ...logData, reason: `Amount below minimum (${minBTCAmount} ${baseAsset})` });
      return;
    }

    const minTradeUSD = settings.MIN_TRADE_SIZE || 10;
    if (tradeAmountUSD < minTradeUSD) {
      console.log(`Trade amount $${tradeAmountUSD.toFixed(2)} is below MIN_TRADE_SIZE ($${minTradeUSD}). Skipping.`);
      logTransaction({ ...logData, reason: `Amount below MIN_TRADE_SIZE ($${minTradeUSD})` });
      return;
    }
    
    // Apply precision to avoid formatting errors
    let precisionBTC;
    try {
      precisionBTC = exchange.amountToPrecision(settings.SYMBOL, tradeAmountBTC);
    } catch (error) {
      throw new Error(`Failed to apply precision: ${error}`);
    }

    // Update log with finalized precision and rounded values
    logData.btcAmount = precisionBTC;
    logData.totalUSD = tradeAmountUSD;

    if (settings.DRY_RUN) {
      console.log(`[DRY RUN] Would execute: ${action} ${precisionBTC} ${baseAsset} (~$${tradeAmountUSD})\n`);
      logTransaction({ ...logData, status: 'dryrun' });
    } else {
      console.log(`Executing live trade: ${action} ${precisionBTC} ${baseAsset} (~$${tradeAmountUSD})\n`);

      try {
        let orderId;
        if (action.startsWith('SELL')) {
          const order = await exchange.create_market_sell_order(settings.SYMBOL, parseFloat(precisionBTC));
          orderId = order.id;
        } else {
          const order = await exchange.create_market_buy_order(settings.SYMBOL, parseFloat(precisionBTC));
          orderId = order.id;
        }

        console.log(`Trade executed successfully! Order ID: ${orderId}\n`);

        logTransaction({ ...logData, status: 'success' });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`Trade execution failed: ${errorMsg}\n`);

        logTransaction({ ...logData, reason: `Execution error: ${errorMsg}` });

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
