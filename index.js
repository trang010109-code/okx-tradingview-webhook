import express from "express";
import fetch from "node-fetch";
import CryptoJS from "crypto-js";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ===== ENV =====
const TV_SECRET = process.env.TV_SECRET || "";
const OKX_API_KEY = process.env.OKX_API_KEY || "";
const OKX_API_SECRET = process.env.OKX_API_SECRET || "";
const OKX_API_PASSPHRASE = process.env.OKX_API_PASSPHRASE || "";

const OKX_BASE_URL = "https://www.okx.com";

// ===== LOT CACHE =====
const lotCache = {};

// ===== HEALTH CHECK =====
app.get("/", (req, res) => {
  res.send("OKX Webhook Server is running");
});

// ===== SIGN =====
function signOKX(timestamp, method, requestPath, body = "") {
  const prehash = timestamp + method + requestPath + body;
  return CryptoJS.enc.Base64.stringify(
    CryptoJS.HmacSHA256(prehash, OKX_API_SECRET)
  );
}

// ===== GET LOT SIZE =====
async function getLotSize(instId) {
  if (lotCache[instId] && Date.now() - lotCache[instId].ts < 10 * 60 * 1000) {
    return lotCache[instId];
  }

  const url = `${OKX_BASE_URL}/api/v5/public/instruments?instType=SWAP&instId=${instId}`;
  const res = await fetch(url);
  const json = await res.json();

  if (json.code !== "0" || !json.data?.length) {
    throw new Error("Cannot fetch lot size");
  }

  const lotSz = parseFloat(json.data[0].lotSz);
  const minSz = parseFloat(json.data[0].minSz);

  lotCache[instId] = { lotSz, minSz, ts: Date.now() };
  console.log(`Lot size loaded: ${instId} | lotSz=${lotSz} | minSz=${minSz}`);

  return lotCache[instId];
}

// ===== NORMALIZE QTY =====
function normalizeQty(qty, lotSz, minSz) {
  let q = Math.floor(qty / lotSz) * lotSz;
  if (q < minSz) q = minSz;
  return q;
}

// ===== PLACE ORDER =====
async function placeOrder(payload) {
  const timestamp = new Date().toISOString();
  const path = "/api/v5/trade/order";

  const { lotSz, minSz } = await getLotSize(payload.instId);
  const finalQty = normalizeQty(Number(payload.qty), lotSz, minSz);

  // ===== MAP posSide (HEDGE MODE) =====
  const posSide =
    payload.side === "buy" ? "long" :
    payload.side === "sell" ? "short" :
    null;

  if (!posSide) throw new Error("Invalid side");

  console.log(
    `Qty normalize: raw=${payload.qty} -> final=${finalQty} | posSide=${posSide}`
  );

  const bodyObj = {
    instId: payload.instId,
    tdMode: "cross",          // giữ cross
    side: payload.side,       // buy / sell
    posSide: posSide,         // BẮT BUỘC cho hedge mode
    ordType: "market",
    sz: finalQty.toString()
  };

  const body = JSON.stringify(bodyObj);

  const headers = {
    "Content-Type": "application/json",
    "OK-ACCESS-KEY": OKX_API_KEY,
    "OK-ACCESS-SIGN": signOKX(timestamp, "POST", path, body),
    "OK-ACCESS-TIMESTAMP": timestamp,
    "OK-ACCESS-PASSPHRASE": OKX_API_PASSPHRASE
  };

  const res = await fetch(OKX_BASE_URL + path, {
    method: "POST",
    headers,
    body
  });

  return await res.json();
}

// ===== WEBHOOK =====
app.post("/webhook", async (req, res) => {
  try {
    const data = req.body;
    console.log("Webhook received:", data);

    if (!data.secret || data.secret !== TV_SECRET) {
      console.error("❌ Invalid secret");
      return res.status(401).json({ error: "Invalid secret" });
    }

    const result = await placeOrder(data);
    console.log("OKX result:", result);

    if (result.code !== "0") {
      console.error("❌ OKX rejected order:", result);
    }

    res.json({ ok: true, result });

  } catch (err) {
    console.error("❌ Server error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
