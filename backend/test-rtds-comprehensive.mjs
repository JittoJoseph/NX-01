import WebSocket from "ws";

console.log("Testing RTDS WebSocket for BTC prices...");

const ws = new WebSocket("wss://ws-live-data.polymarket.com");

let messageCount = 0;
let btcMessages = 0;
let lastBtcPrice = null;
let lastBtcTimestamp = null;

ws.on("open", () => {
  console.log("✅ RTDS WebSocket connected");

  // Test different subscription formats
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
        // Try without filters first
        // filters: "btcusdt"
      },
    ],
  });

  console.log("📤 Sending subscription:", JSON.stringify(JSON.parse(subscribeMsg), null, 2));
  ws.send(subscribeMsg);

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

    if (text === "PONG" || text === "pong") {
      console.log("🏓 Received PONG");
      return;
    }

    const msg = JSON.parse(text);
    const topic = msg.topic;
    const payload = msg.payload;

    // Log all messages for first 10
    if (messageCount <= 10) {
      console.log(`📨 Message ${messageCount}:`, JSON.stringify(msg, null, 2));
    }

    // Check for BTC prices
    if (topic === "crypto_prices" && payload?.symbol === "btcusdt") {
      btcMessages++;
      lastBtcPrice = payload.value;
      lastBtcTimestamp = payload.timestamp || msg.timestamp;
      console.log(`💰 Binance BTC: $${payload.value} at ${new Date(payload.timestamp || msg.timestamp).toISOString()}`);
    }

    if (topic === "crypto_prices_chainlink") {
      if (Array.isArray(payload)) {
        console.log(`📚 Chainlink backfill: ${payload.length} historical prices`);
        for (const item of payload.slice(0, 3)) { // Show first 3
          if (item.symbol === "btc/usd") {
            console.log(`📈 Historical BTC: $${item.value} at ${new Date(item.timestamp).toISOString()}`);
          }
        }
      } else if (payload?.symbol === "btc/usd") {
        btcMessages++;
        lastBtcPrice = payload.value;
        lastBtcTimestamp = payload.timestamp || msg.timestamp;
        console.log(`🔗 Chainlink BTC: $${payload.value} at ${new Date(payload.timestamp || msg.timestamp).toISOString()}`);
      }
    }

  } catch (err) {
    console.error("❌ Parse error:", err.message, "Raw:", rawData.toString().slice(0, 200));
  }
});

ws.on("close", (code, reason) => {
  console.log(`❌ WebSocket closed: ${code} ${reason.toString()}`);
});

ws.on("error", (error) => {
  console.error("❌ WebSocket error:", error);
});

// Test for 30 seconds
setTimeout(() => {
  console.log("\n📊 Test Results:");
  console.log(`Total messages: ${messageCount}`);
  console.log(`BTC price messages: ${btcMessages}`);
  console.log(`Last BTC price: ${lastBtcPrice}`);
  console.log(`Last timestamp: ${lastBtcTimestamp ? new Date(lastBtcTimestamp).toISOString() : 'none'}`);

  ws.close();
  process.exit(lastBtcPrice ? 0 : 1);
}, 30000);