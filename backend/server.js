// ============ BACKEND (Node.js + Express) ============
require("dotenv").config();              // .env file se password padhta hai
const express = require("express");
const cors = require("cors");            // frontend ko is server se baat karne deta hai
const mysql = require("mysql2/promise");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());                 // aage orders ke liye JSON samajhne ke kaam aayega

// ---------- Database connection ----------
const db = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || "restro_db",
  decimalNumbers: true                   // price number ban ke aaye, text nahi
});

db.query("SELECT 1")
  .then(() => console.log("MySQL connected ✅"))
  .catch((err) => console.error("MySQL connection failed ❌ :", err.message));

// ---------- ROUTES ----------
// ---------- WEBSITE FILES (taaki mobile se bhi khul sake) ----------
// Sirf ye files bahar jaayengi. backend folder (.env, password) kabhi expose nahi hota.
const ROOT = path.join(__dirname, "..");
app.use("/images", express.static(path.join(ROOT, "images")));
["index.html", "style.css", "script.js", "kitchen.html", "kitchen.css", "kitchen.js",
  "manifest.json", "sw.js", "icon-192.png", "icon-512.png"].forEach((file) => {
  app.get("/" + file, (req, res) => res.sendFile(path.join(ROOT, file)));
});
app.get("/", (req, res) => res.sendFile(path.join(ROOT, "index.html")));
app.get("/kitchen", (req, res) => res.sendFile(path.join(ROOT, "kitchen.html")));

// GET /api/menu  → database se saari available dishes bhejta hai
app.get("/api/menu", async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT m.id, m.name, c.name AS category, m.type, m.price, m.image,
             m.description AS \`desc\`
      FROM menu_items m
      JOIN categories c ON m.category_id = c.id
      WHERE m.is_available = TRUE
      ORDER BY m.id
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load menu" });
  }
});

// POST /api/orders  → naya order database mein save karta hai
// Frontend bhejta hai: { table: 5, items: [ {id: 1, qty: 2}, {id: 7, qty: 1} ] }
app.post("/api/orders", async (req, res) => {
  const { table, items } = req.body;

  // 1. Validation: galat ya khali data ko rok do
  const tableNo = Number(table);
  if (!Number.isInteger(tableNo) || tableNo < 1 || tableNo > 500) {
    return res.status(400).json({ error: "Valid table number chahiye" });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "Order mein kam se kam ek item chahiye" });
  }
  for (const it of items) {
    if (!Number.isInteger(it.id) || !Number.isInteger(it.qty) || it.qty < 1 || it.qty > 20) {
      return res.status(400).json({ error: "Items galat format mein hain" });
    }
  }

  const conn = await db.getConnection();
  try {
    // 2. Price database se lo (frontend ke bheje hue price par bharosa nahi karte)
    const ids = items.map((it) => it.id);
    const [dishes] = await conn.query(
      "SELECT id, price FROM menu_items WHERE id IN (?) AND is_available = TRUE",
      [ids]
    );
    const priceOf = {};
    dishes.forEach((d) => (priceOf[d.id] = d.price));
    if (items.some((it) => priceOf[it.id] === undefined)) {
      return res.status(400).json({ error: "Koi dish available nahi hai" });
    }

    // 3. Total nikalo
    const total = items.reduce((sum, it) => sum + priceOf[it.id] * it.qty, 0);

    // 4. Transaction: ya toh order + items dono save honge, ya kuch bhi nahi
    await conn.beginTransaction();
    const [result] = await conn.query(
      "INSERT INTO orders (table_no, total) VALUES (?, ?)",
      [tableNo, total]
    );
    const orderId = result.insertId;
    for (const it of items) {
      await conn.query(
        "INSERT INTO order_items (order_id, menu_item_id, quantity, unit_price) VALUES (?, ?, ?, ?)",
        [orderId, it.id, it.qty, priceOf[it.id]]
      );
    }
    await conn.commit();

    res.status(201).json({ orderId, total });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ error: "Order save nahi ho paya" });
  } finally {
    conn.release();
  }
});

// GET /api/orders  → kitchen ke liye: jo orders abhi serve nahi hue (items ke saath)
app.get("/api/orders", async (req, res) => {
  try {
    const [orders] = await db.query(
      "SELECT id, table_no, status, total, created_at FROM orders WHERE status <> 'served' ORDER BY created_at ASC"
    );
    if (orders.length === 0) return res.json([]);

    // In orders ke saare items (dish ke naam ke saath) ek query mein
    const ids = orders.map((o) => o.id);
    const [items] = await db.query(
      `SELECT oi.order_id, m.name, oi.quantity
       FROM order_items oi
       JOIN menu_items m ON m.id = oi.menu_item_id
       WHERE oi.order_id IN (?)`,
      [ids]
    );
    orders.forEach((o) => {
      o.items = items.filter((i) => i.order_id === o.id);
    });
    res.json(orders);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load orders" });
  }
});

// PATCH /api/orders/5/status  → order ka status badalta hai
// Frontend bhejta hai: { status: "preparing" }
app.patch("/api/orders/:id/status", async (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body;
  const allowed = ["received", "preparing", "ready", "served"];

  if (!Number.isInteger(id) || !allowed.includes(status)) {
    return res.status(400).json({ error: "Galat order id ya status" });
  }
  try {
    const [result] = await db.query("UPDATE orders SET status = ? WHERE id = ?", [status, id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Order nahi mila" });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Status update nahi hua" });
  }
});

// ---------- MOOD QUIZ: dish suggestion (rule-based scoring) ----------
const MOODS   = ["happy", "tired", "stressed", "celebrating"];
const HUNGER  = ["light", "medium", "heavy"];
const TASTES  = ["spicy", "cheesy", "savory", "sweet", "refreshing"];
const DIETS   = ["veg", "nonveg", "any"];
const BUDGETS = ["150", "250", "any"];

const FIT = {
  light:  "Light bite for a small appetite",
  medium: "Good size for a normal appetite",
  heavy:  "Filling, for a big appetite"
};
const TASTE_NAME = { spicy: "spicy", cheesy: "cheesy", savory: "savoury", sweet: "sweet", refreshing: "refreshing" };

// Har dish ko points do aur top 3 chuno
// Mood match +3, taste match +3, bhookh match +2 (paas ka match +1), non-veg pasand +3
// Veg chuna ho toh sirf veg dishes, aur budget se zyada price wali dish nahi
function suggestDishes(dishes, a) {
  const maxPrice = a.budget === "any" ? Infinity : Number(a.budget);
  const levels = ["light", "medium", "heavy"];

  const scored = dishes
    .filter((d) => (a.diet !== "veg" || d.type === "veg") && d.price <= maxPrice)
    .map((d) => {
      let score = 0;
      const why = [];
      if (d.mood_tags.split(",").includes(a.mood)) {
        score += 3;
        why.push("Suits a " + a.mood + " mood");
      }
      if (d.taste === a.taste) {
        score += 3;
        why.push("Has the " + TASTE_NAME[a.taste] + " taste you wanted");
      }
      const gap = Math.abs(levels.indexOf(d.portion) - levels.indexOf(a.hunger));
      if (gap === 0) {
        score += 2;
        why.push(FIT[d.portion]);
      } else if (gap === 1) {
        score += 1;
      }
      if (a.diet === "nonveg" && d.type === "nonveg") {
        score += 3;
        why.push("Non-veg pick");
      }
      return { ...d, score, why };
    })
    .sort((x, y) => y.score - x.score || x.price - y.price);

  // Variety: pehle har category se sirf ek dish, phir baaki jagah bharo
  const picks = [];
  const usedCategories = new Set();
  for (const d of scored) {
    if (picks.length < 3 && !usedCategories.has(d.category)) {
      picks.push(d);
      usedCategories.add(d.category);
    }
  }
  for (const d of scored) {
    if (picks.length < 3 && !picks.includes(d)) picks.push(d);
  }

  return picks.map((d) => ({
    id: d.id, name: d.name, category: d.category, type: d.type,
    price: d.price, image: d.image, desc: d.desc,
    reason: d.why.length ? d.why.join(" · ") : "A popular pick within your budget"
  }));
}

// POST /api/suggest  → quiz ke 5 jawab leke 3 dishes suggest karta hai
// Frontend bhejta hai: { mood, hunger, taste, diet, budget }
app.post("/api/suggest", async (req, res) => {
  const a = req.body || {};
  const valid =
    MOODS.includes(a.mood) && HUNGER.includes(a.hunger) && TASTES.includes(a.taste) &&
    DIETS.includes(a.diet) && BUDGETS.includes(a.budget);
  if (!valid) return res.status(400).json({ error: "Quiz ke jawab galat hain" });

  try {
    const [dishes] = await db.query(`
      SELECT m.id, m.name, c.name AS category, m.type, m.price, m.image,
             m.description AS \`desc\`, m.taste, m.portion, m.mood_tags
      FROM menu_items m
      JOIN categories c ON m.category_id = c.id
      WHERE m.is_available = TRUE
    `);
    res.json(suggestDishes(dishes, a));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Suggestion nahi mil paya" });
  }
});

// ---------- START ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on http://localhost:" + PORT));
