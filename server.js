/**
 * Simple Arbitrage Bot Server
 * - fetches tickers from configured exchanges
 * - finds pair price differences
 * - emits opportunities via Socket.IO
 * - can execute market buy on low-priced exchange and attempt withdraw -> sell on high-priced exchange
 *
 * IMPORTANT:
 * - This is a starter implementation. Withdraw APIs often require extra verification and whitelisting.
 * - Test on demo/testnet and with small amounts.
 */

require('dotenv').config();
const express = require('express');
const http = require('http');
const socketio = require('socket.io');
const ccxt = require('ccxt');
const bodyParser = require('body-parser');

const app = express();
const server = http.createServer(app);
const io = socketio(server);
app.use(express.static('public'));
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;

/** --- Configure exchanges using ccxt --- **/
function createExchangesFromEnv() {
  const ex = {};
  // Helper to init safely
  const safeInit = (id, options = {}) => {
    try {
      if (!ccxt.exchanges.includes(id)) {
        console.warn(`CCXT: exchange ${id} not in ccxt.exchanges list`);
      }
      const cls = ccxt[id];
      const instance = new cls(options);
      ex[id] = instance;
    } catch (err) {
      console.error('createEx error', id, err.message || err);
    }
  };

  // Binance
  safeInit('binance', {
    apiKey: process.env.BINANCE_APIKEY || undefined,
    secret: process.env.BINANCE_SECRET || undefined,
    enableRateLimit: true,
  });

  // Bybit
  safeInit('bybit', {
    apiKey: process.env.BYBIT_APIKEY || undefined,
    secret: process.env.BYBIT_SECRET || undefined,
    enableRateLimit: true,
  });

  // MEXC (mxc might be 'mexc' in some ccxt versions; try both)
  if (ccxt.exchanges.includes('mexc')) {
    safeInit('mexc', {
      apiKey: process.env.MEXC_APIKEY || undefined,
      secret: process.env.MEXC_SECRET || undefined,
      enableRateLimit: true,
    });
  } else if (ccxt.exchanges.includes('mxc')) {
    safeInit('mxc', {
      apiKey: process.env.MEXC_APIKEY || undefined,
      secret: process.env.MEXC_SECRET || undefined,
      enableRateLimit: true,
    });
  }

  // CoinEx
  if (ccxt.exchanges.includes('coinex')) {
    safeInit('coinex', {
      apiKey: process.env.COINEX_APIKEY || undefined,
      secret: process.env.COINEX_SECRET || undefined,
      enableRateLimit: true,
    });
  } else {
    // fallback name guesses
    safeInit('coinex', {
      apiKey: process.env.COINEX_APIKEY || undefined,
      secret: process.env.COINEX_SECRET || undefined,
      enableRateLimit: true,
    });
  }

  // OKX (okx or okex depending on ccxt)
  if (ccxt.exchanges.includes('okx')) {
    safeInit('okx', {
      apiKey: process.env.OKX_APIKEY || undefined,
      secret: process.env.OKX_SECRET || undefined,
      password: process.env.OKX_PASSPHRASE || undefined,
      enableRateLimit: true,
    });
  } else if (ccxt.exchanges.includes('okex')) {
    safeInit('okex', {
      apiKey: process.env.OKX_APIKEY || undefined,
      secret: process.env.OKX_SECRET || undefined,
      password: process.env.OKX_PASSPHRASE || undefined,
      enableRateLimit: true,
    });
  }

  return ex;
}

const exchanges = createExchangesFromEnv();

// pairs to scan (user can edit). Use common tickers like BTC/USDT, ETH/USDT, etc.
const PAIRS = [
  'BTC/USDT',
  'ETH/USDT',
  'XRP/USDT',
  'BCH/USDT',
  'LTC/USDT',
  // add more pairs you want to monitor
];

// main loop parameters
const SCAN_INTERVAL_MS = 3000; // 3s between checks (adjust)
const MIN_ARBITRAGE_SPREAD = 0.002; // 0.2% minimum to consider opportunity (adjust)
const TRADE_AMOUNT_USDT = 10; // amount in USDT to execute per trade (for testing)

let running = true;

// Utility: fetch ticker from exchange for a pair
async function fetchPrice(exchange, pair) {
  try {
    if (!exchange || !exchange.has || !exchange.has['fetchTicker']) return null;
    const ticker = await exchange.fetchTicker(pair);
    return {
      bid: ticker.bid,
      ask: ticker.ask,
      last: ticker.last,
    };
  } catch (err) {
    // ignore missing pair on exchange
    return null;
  }
}

// find best bid/ask across exchanges
async function scanPair(pair) {
  const results = [];
  for (const id of Object.keys(exchanges)) {
    const ex = exchanges[id];
    try {
      const price = await fetchPrice(ex, pair);
      if (price && price.bid && price.ask) {
        results.push({
          exchange: id,
          bid: price.bid,
          ask: price.ask,
        });
      }
    } catch (err) {
      // skip
    }
  }
  if (results.length < 2) return null;
  // best buy (lowest ask) and best sell (highest bid)
  results.sort((a, b) => a.ask - b.ask);
  const bestBuy = results[0];
  results.sort((a, b) => b.bid - a.bid);
  const bestSell = results[0];
  return { pair, bestBuy, bestSell, all: results };
}

// attempt to execute arbitrage (very simplified)
async function executeArbitrage(opportunity) {
  const { pair, bestBuy, bestSell } = opportunity;
  // verify spread
  const buyPrice = bestBuy.ask;
  const sellPrice = bestSell.bid;
  const spread = (sellPrice - buyPrice) / buyPrice;
  if (spread < MIN_ARBITRAGE_SPREAD) return { ok: false, reason: 'spread too low' };

  // compute amount to buy in base currency given TRADE_AMOUNT_USDT
  const baseAmount = TRADE_AMOUNT_USDT / buyPrice;

  // Step 1: place market buy on bestBuy.exchange
  try {
    const buyEx = exchanges[bestBuy.exchange];
    if (!buyEx || !buyEx.has || !buyEx.has['createMarketOrder']) {
      return { ok: false, reason: 'buy exchange cannot create orders via API' };
    }
    // Note: market buy syntax may vary (some exchanges require side, amount, params)
    const symbol = pair;
    const buyOrder = await buyEx.createMarketOrder(symbol, 'buy', baseAmount);
    // emit status
    io.emit('log', `Bought ${baseAmount.toFixed(8)} ${pair.split('/')[0]} on ${bestBuy.exchange} at ${buyPrice}`);
    // Step 2: withdraw asset from buyEx to sellEx address (THIS REQUIRES you have configured withdrawal addresses and API permission)
    // NOTE: Many exchanges require whitelisted addresses and may not allow API withdrawals without extra steps.
    // We'll attempt withdraw only if exchange supports withdraw via API and user has set env with destination address mapping.
    const asset = pair.split('/')[0];

    // READ destination address from per-exchange config (ENV or DB) - here we use a placeholder mapping:
    const destinationAddress = withdrawAddresses && withdrawAddresses[bestSell.exchange] && withdrawAddresses[bestSell.exchange][asset];
    if (!destinationAddress) {
      io.emit('log', `No destination address configured for ${asset} on ${bestSell.exchange}. Please set withdrawAddresses mapping to enable automatic withdrawal.`);
      return { ok: false, reason: 'no destination address' };
    }

    // If exchange supports withdraw
    if (buyEx.has['withdraw']) {
      // NOTE: withdraw method params might vary; ccxt docs show exchange.withdraw(currency, amount, address, tag=null, params={})
      try {
        const tx = await buyEx.withdraw(asset, baseAmount, destinationAddress);
        io.emit('log', `Withdraw requested from ${bestBuy.exchange} -> tx id ${tx && tx.id ? tx.id : JSON.stringify(tx)}`);
      } catch (err) {
        io.emit('log', `Withdraw failed: ${err.message || err}`);
        return { ok: false, reason: 'withdraw failed', err: err.message || err };
      }
    } else {
      io.emit('log', `Buy exchange ${bestBuy.exchange} does not support programmatic withdraw via ccxt API.`);
      return { ok: false, reason: 'withdraw not supported' };
    }

    // Step 3: after deposit appears on sell exchange (this part requires webhook or polling deposit history)
    // For simplicity: we do NOT implement full deposit-waiting logic here. In production you must confirm deposit on sellEx.
    io.emit('log', `Waiting for deposit on ${bestSell.exchange}... (NOT IMPLEMENTED automatic polling in this starter)`);
    return { ok: true, note: 'buy placed and withdraw requested — you must confirm deposit and then sell.' };
  } catch (err) {
    return { ok: false, reason: 'order failed', err: err.message || err };
  }
}

// simple in-memory withdraw addresses mapping
// YOU MUST fill this mapping with destination addresses for each target exchange and asset
const withdrawAddresses = {
  // example:
  // 'okx': { 'BTC': '1abc...', 'USDT': 'THash..' },
  // 'coinex': { 'BTC': '1abc...' }
};

async function mainLoop() {
  while (running) {
    try {
      for (const pair of PAIRS) {
        const opp = await scanPair(pair);
        if (!opp) continue;
        const buy = opp.bestBuy;
        const sell = opp.bestSell;
        if (!buy || !sell) continue;
        const spread = ((sell.bid - buy.ask) / buy.ask);
        // emit current prices
        io.emit('ticker', { pair, buy, sell, spread });

        if (spread >= MIN_ARBITRAGE_SPREAD && buy.exchange !== sell.exchange) {
          const opportunity = {
            timestamp: Date.now(),
            pair,
            bestBuy: buy,
            bestSell: sell,
            spread,
          };
          io.emit('opportunity', opportunity);
          // Automatic execution: for safety we do not auto-execute by default.
          // But provide a endpoint to trigger execution manually.
        }
      }
    } catch (err) {
      console.error('mainLoop error', err && err.stack ? err.stack : err);
    }
    await new Promise((res) => setTimeout(res, SCAN_INTERVAL_MS));
  }
}

// Socket.IO connections
io.on('connection', (socket) => {
  console.log('client connected');
  socket.on('execute', async (data) => {
    // manual execution trigger from dashboard
    try {
      const result = await executeArbitrage(data);
      socket.emit('exec_result', result);
    } catch (err) {
      socket.emit('exec_result', { ok: false, reason: err.message || err });
    }
  });

  socket.on('get_exchanges', () => {
    socket.emit('exchanges', Object.keys(exchanges));
  });
});

// Simple REST to list exchanges and pairs
app.get('/api/config', (req, res) => {
  res.json({
    exchanges: Object.keys(exchanges),
    pairs: PAIRS,
    scanIntervalMs: SCAN_INTERVAL_MS,
    minSpread: MIN_ARBITRAGE_SPREAD,
  });
});

// endpoint to trigger manual execution (from dashboard)
app.post('/api/execute', async (req, res) => {
  const data = req.body;
  try {
    const result = await executeArbitrage(data);
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, err: err.message || err });
  }
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  mainLoop().catch((e) => console.error(e));
});
