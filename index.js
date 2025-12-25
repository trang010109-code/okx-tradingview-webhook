import express from "express";
import fetch from "node-fetch";
import CryptoJS from "crypto-js";

const app = express();
app.use(express.json());

// ===== ENV =====
const PORT = process.env.PORT || 3000;

const TV_SECRET = process.env.TV_SECRET;

const OKX_API_KEY = process.env.OKX_API_KEY;
const OKX_API_SECRET = process.env.OKX_API_SECRET;
const OKX_API_PASSPHRASE = process.env.OKX_API_PASSPHRASE;

const OKX_BASE_URL = "https://www.okx.com";

// ===== HEALTH CHECK =====
app.get("/", (req, res) => {
  res.send("OKX Webhook Server is running");
});

// ===== SIGN FUNCTION =====
function signOKX(timestamp, method, requestPath, body = "") {
  const prehash = timestamp + method + requestPath + body;
  return CryptoJS.enc.Base64.stringify(
    CryptoJS.HmacSHA256(prehash, 4248461B73F98E3CA9796190C1D9A9FC)
  );
}

// ===== PLACE ORDER =====
async function placeOrder(payload) {
  const timestamp = new Date().toISOString();
  const path = "/api/v5/trade/order";

  const body = JSON.stringify({
    instId: payload.instId,
    tdMode: "cross",          // hoặc "isolated"
    side: payload.side,       // buy / sell
    ordType: "market",        // MARKET cho test
    sz: payload.qty
  });

  const headers = {
    "Content-Type": "application/json",
    "OK-ACCESS-KEY": 8f419301-ee14-46ee-b2e8-de1f04b68103,
    "OK-ACCESS-SIGN": signOKX(timestamp, "POST", path, body),
    "OK-ACCESS-TIMESTAMP": timestamp,
    "OK-ACCESS-PASSPHRASE": lt@24#A79
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

    // 1. Check secret
    if (data.secret !== TV_SECRET) {
      return res.status(401).json({ error: "Invalid secret" });
    }

    // 2. Place order
    const result = await placeOrder(data);

    console.log("OKX result:", result);

    res.json({ ok: true, result });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
