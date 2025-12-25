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

// ===== SIGN =====
function signOKX(ts, method, path, body = "") {
  return CryptoJS.enc.Base64.stringify(
    CryptoJS.HmacSHA256(ts + method + path + body, OKX_API_SECRET)
  );
}

// ===== GET LOT SIZE =====
async function getLotSize(instId) {
  if (lotCache[instId] && Date.now() - lotCache[instId].ts < 10 * 60 * 1000) {
    return lotCache[instId];
  }

  const res = await fetch(
    `${OKX_BASE_URL}/api/v5/public/instruments?instType=SWAP&instId=${instId}`
  );
  const json = await res.json();

  const lotSz = parseFloat(json.data[0].lotSz);
  const minSz = parseFloat(json.data[0].minSz);

  lotCache[instId] = { lotSz, minSz, ts: Date.now() };
  console.log(`Lot size loaded: ${instId} | lotSz=${lotSz} | minSz=${minSz}`);
  return lotCache[instId];
}

function normalizeQty(qty, lotSz, minSz) {
  let q = Math.floor(qty / lotSz) * lotSz;
  if (q < minSz) q = minSz;
  return q;
}

// ===== PLACE ENTRY =====
async function placeEntry(payload) {
  const ts = new Date().toISOString();
  const path = "/api/v5/trade/order";

  const { lotSz, minSz } = await getLotSize(payload.instId);
  const finalQty = normalizeQty(Number(payload.qty), lotSz, minSz);

  const posSide = payload.side === "buy" ? "long" : "short";

  const bodyObj = {
    instId: payload.instId,
    tdMode: "cross",
    side: payload.side,
    posSide,
    ordType: "market",
    sz: finalQty.toString()
  };

  const body = JSON.stringify(bodyObj);

  const res = await fetch(OKX_BASE_URL + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "OK-ACCESS-KEY": OKX_API_KEY,
      "OK-ACCESS-SIGN": signOKX(ts, "POST", path, body),
      "OK-ACCESS-TIMESTAMP": ts,
      "OK-ACCESS-PASSPHRASE": OKX_API_PASSPHRASE
    },
    body
  });

  return { result: await res.json(), finalQty, posSide };
}

// ===== PLACE ALGO (TP or SL) =====
async function placeAlgo({ instId, posSide, side, triggerPx, sz }) {
  const ts = new Date().toISOString();
  const path = "/api/v5/trade/order-algo";

  const bodyObj = {
    instId,
    tdMode: "cross",
    side,
    posSide,
    ordType: "conditional",
    triggerPx: triggerPx.toString(),
    orderPx: "-1",
    sz: sz.toString()
  };

  const body = JSON.stringify(bodyObj);

  const res = await fetch(OKX_BASE_URL + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "OK-ACCESS-KEY": OKX_API_KEY,
      "OK-ACCESS-SIGN": signOKX(ts, "POST", path, body),
      "OK-ACCESS-TIMESTAMP": ts,
      "OK-ACCESS-PASSPHRASE": OKX_API_PASSPHRASE
    },
    body
  });

  return await res.json();
}

// ===== WEBHOOK =====
app.post("/webhook", async (req, res) => {
  try {
    const d = req.body;
    console.log("Webhook:", d);

    if (d.secret !== TV_SECRET) {
      return res.status(401).json({ error: "Invalid secret" });
    }

    // ===== ENTRY =====
    const { result, finalQty, posSide } = await placeEntry(d);
    console.log("ENTRY:", result);

    if (result.code !== "0") {
      return res.json({ ok: false, entry: result });
    }

    // ===== SL / TP (RDB1.2 STYLE – ATR BASED FROM PINE) =====
    if (d.sl) {
      const slSide = posSide === "long" ? "sell" : "buy";
      const slRes = await placeAlgo({
        instId: d.instId,
        posSide,
        side: slSide,
        triggerPx: d.sl,
        sz: finalQty
      });
      console.log("SL:", slRes);
    }

    if (d.tp1) {
      const tpSide = posSide === "long" ? "sell" : "buy";
      const tpRes = await placeAlgo({
        instId: d.instId,
        posSide,
        side: tpSide,
        triggerPx: d.tp1,
        sz: finalQty
      });
      console.log("TP1:", tpRes);
    }

    res.json({ ok: true });

  } catch (e) {
    console.error("ERROR:", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
