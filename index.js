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

// ===== PLACE ORDER =====
async function placeOrder(payload) {
  const timestamp = new Date().toISOString();
  const path = "/api/v5/trade/order";

  // ⚠️ OKX BẮT BUỘC sz LÀ STRING
  const bodyObj = {
    instId: payload.instId,
    tdMode: "cross",              // đổi isolated nếu bạn muốn
    side: payload.side,           // buy / sell
    ordType: "market",
    sz: payload.qty.toString()
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

  const json = await res.json();
  return json;
}

// ===== WEBHOOK =====
app.post("/webhook", async (req, res) => {
  try {
    const data = req.body;

    console.log("Webhook received:", data);
    console.log("Secret from TV:", data.secret);
    console.log("Secret from ENV:", TV_SECRET);

    // ---- SECRET CHECK ----
    if (!data.secret || data.secret !== TV_SECRET) {
      console.error("❌ Invalid secret");
      return res.status(401).json({ error: "Invalid secret" });
    }

    // ---- BASIC VALIDATION ----
    if (!data.instId || !data.side || !data.qty) {
      console.error("❌ Missing required fields");
      return res.status(400).json({ error: "Missing required fields" });
    }

    const result = await placeOrder(data);
    console.log("OKX result:", result);

    // ---- OKX ERROR LOG ----
    if (result.code !== "0") {
      console.error("❌ OKX rejected order:", result);
    }

    res.json({ ok: true, result });

  } catch (err) {
    console.error("❌ Server error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
