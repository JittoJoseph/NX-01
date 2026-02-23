import WebSocket from "ws";

console.log("Testing BTC price watcher functionality...");

const ws = new WebSocket("wss://ws-live-data.polymarket.com");

let messageCount = 0;
let btcPrices = [];
let historicalPrices = [];
let currentPrice = null;

ws.on("open", () => {
  console.log("✅ RTDS WebSocket connected");

  const subscribeMsg = JSON.stringify({
    action: "subscribe",
    subscriptions: [
      {
        topic: "crypto_prices_chainlink",
        type: "*",
        filters: '{"symbol":"btc/usd"}',
      },
      {
        topic: "crypto_prices",
        type: "*",
        // Note: filters for crypto_prices may not work, filter in code instead
      },
    ],
  });

  ws.send(subscribeMsg);
  console.log("📤 Subscribed to BTC prices");

  // Keepalive
  setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send("PING");
    }
  }, 5000);
});

ws.on("message", (rawData) => {
  try {
    messageCount++;
    const text = rawData.toString().trim();

    if (text === "PONG" || text === "pong") return;

    const msg = JSON.parse(text);
    const topic = msg.topic;
    const payload = msg.payload;

    // Handle Chainlink backfill
    if (topic === "crypto_prices" && msg.type === "subscribe" && payload?.symbol === "btc/usd") {
      if (Array.isArray(payload.data)) {
        console.log(`📚 Received Chainlink backfill: ${payload.data.length} historical prices`);
        historicalPrices = payload.data.map(item => ({
          price: item.value,
          timestamp: item.timestamp
        }));
      }
    }

    // Handle real-time BTC prices
    if (topic === "crypto_prices" && payload?.symbol === "btcusdt") {
      const price = payload.value;
      const timestamp = payload.timestamp;
      btcPrices.push({ price, timestamp });
      currentPrice = price;

      if (btcPrices.length <= 5) {
        console.log(`💰 Binance BTC: $${price} at ${new Date(timestamp).toISOString()}`);
      }
    }

    if (topic === "crypto_prices_chainlink" && payload?.symbol === "btc/usd") {
      const price = payload.value;
      const timestamp = payload.timestamp;
      btcPrices.push({ price, timestamp });
      currentPrice = price;

      if (btcPrices.length <= 5) {
        console.log(`🔗 Chainlink BTC: $${price} at ${new Date(timestamp).toISOString()}`);
      }
    }

  } catch (err) {
    console.error("❌ Parse error:", err.message);
  }
});

ws.on("close", (code, reason) => {
  console.log(`❌ WebSocket closed: ${code} ${reason.toString()}`);
});

ws.on("error", (error) => {
  console.error("❌ WebSocket error:", error);
});

// Test historical lookup functionality
function testHistoricalLookup() {
  if (historicalPrices.length === 0) {
    console.log("❌ No historical prices available for testing");
    return;
  }

  console.log("\n🧪 Testing historical price lookup:");

  // Test looking up prices at different times
  const now = Date.now();
  const testTimes = [
    now - 1000, // 1 second ago
    now - 10000, // 10 seconds ago
    now - 60000, // 1 minute ago
  ];

  for (const targetTime of testTimes) {
    // Simulate the getPriceAt logic
    let best = null;
    for (const entry of historicalPrices) {
      if (entry.timestamp <= targetTime) {
        if (best === null || entry.timestamp > best.timestamp) {
          best = entry;
        }
      }
    }

    if (best) {
      console.log(`✅ Found price $${best.price} at ${new Date(best.timestamp).toISOString()} for target ${new Date(targetTime).toISOString()}`);
    } else {
      console.log(`❌ No historical price found for ${new Date(targetTime).toISOString()}`);
    }
  }
}

// Run tests for 45 seconds
setTimeout(() => {
  console.log("\n📊 Test Results:");
  console.log(`Total messages: ${messageCount}`);
  console.log(`Historical prices: ${historicalPrices.length}`);
  console.log(`Real-time prices collected: ${btcPrices.length}`);
  console.log(`Current price: ${currentPrice}`);

  testHistoricalLookup();

  ws.close();
  process.exit(currentPrice && historicalPrices.length > 0 ? 0 : 1);
}, 45000);