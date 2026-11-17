// ============ 1. DATA ============
// Menu ab MySQL database se aata hai, backend ke through.
let menu = [];   // ab dishes database se aayengi (backend ke /api/menu se)

// ============ 2. STATE (jo cheezein badalti rehti hain) ============
let activeCategory = "All";
let vegOnly = false;
let cart = {};                 // { dishId: quantity }  jaise { 1: 2, 7: 1 }

// Website server se khuli ho toh same server (""), file se khuli ho toh localhost:3000
const BASE = location.protocol === "file:" ? "http://localhost:3000" : "";

const $ = (id) => document.getElementById(id);
const rupee = (n) => "₹" + n.toLocaleString("en-IN");

// ============ 3. TABLE NUMBER (QR code se aayega) ============
// URL mein ?table=5 likha ho toh "Table 5" dikhega
const tableNo = new URLSearchParams(location.search).get("table");
$("tableInfo").textContent = tableNo ? "Ordering for Table " + tableNo : "Dine-in";

// ============ 4. CATEGORY TABS ============
function renderTabs() {
  const cats = ["All", ...new Set(menu.map((d) => d.category))];
  $("tabs").innerHTML = cats
    .map((c) => `<button class="tab ${c === activeCategory ? "active" : ""}" data-cat="${c}">${c}</button>`)
    .join("");
}

// ============ 5. MENU CARDS ============
function renderMenu() {
  const list = menu.filter((d) =>
    (activeCategory === "All" || d.category === activeCategory) &&
    (!vegOnly || d.type === "veg")
  );

  if (list.length === 0) {
    $("menu").innerHTML = `<p class="empty">No dishes found for this filter.</p>`;
    return;
  }

  $("menu").innerHTML = list.map((d) => {
    const qty = cart[d.id] || 0;
    // qty 0 ho toh "Add" button, warna − 1 + wala stepper
    const control = qty === 0
      ? `<button class="add" data-add="${d.id}">Add</button>`
      : `<div class="stepper">
           <button data-dec="${d.id}" aria-label="Remove one">−</button>
           <span>${qty}</span>
           <button data-inc="${d.id}" aria-label="Add one">+</button>
         </div>`;

    return `
      <article class="card">
        <div class="photo">
          <img src="${d.image}" alt="${d.name}" loading="lazy" onerror="this.style.display='none'">
        </div>
        <div class="card-body">
          <div class="name-row">
            <h3>${d.name}</h3>
            <span class="mark ${d.type}" title="${d.type === "veg" ? "Vegetarian" : "Non-vegetarian"}"></span>
          </div>
          <p class="desc">${d.desc}</p>
          <div class="bottom">
            <span class="price">${rupee(d.price)}</span>
            ${control}
          </div>
        </div>
      </article>`;
  }).join("");
}

// ============ 6. CART ============
function changeQty(id, delta) {
  cart[id] = (cart[id] || 0) + delta;
  if (cart[id] <= 0) delete cart[id];     // 0 ho gaya toh cart se hata do
  renderMenu();
  renderCart();
}

function renderCart() {
  const ids = Object.keys(cart);
  let total = 0, count = 0;

  if (ids.length === 0) {
    $("cartItems").innerHTML = `<p class="panel-empty">Your cart is empty.<br>Add something tasty!</p>`;
  } else {
    $("cartItems").innerHTML = ids.map((id) => {
      const d = menu.find((m) => m.id == id);
      const qty = cart[id];
      total += d.price * qty;
      count += qty;
      return `
        <div class="line">
          <div class="info">${d.name}<br><small>${rupee(d.price)} × ${qty}</small></div>
          <div class="stepper">
            <button data-dec="${d.id}" aria-label="Remove one">−</button>
            <span>${qty}</span>
            <button data-inc="${d.id}" aria-label="Add one">+</button>
          </div>
          <strong>${rupee(d.price * qty)}</strong>
        </div>`;
    }).join("");
  }

  $("total").textContent = rupee(total);
  $("count").textContent = count;
  $("placeOrder").disabled = count === 0;
}

function openCart(open) {
  $("panel").classList.toggle("open", open);
  $("overlay").classList.toggle("open", open);
}

// ============ 7. EVENTS (user ke clicks) ============
// Ek hi listener poore page ke clicks sambhalta hai (isko "event delegation" kehte hain)
document.addEventListener("click", (e) => {
  const t = e.target;
  if (t.dataset.cat)  { activeCategory = t.dataset.cat; renderTabs(); renderMenu(); }
  if (t.dataset.add)  changeQty(Number(t.dataset.add), +1);
  if (t.dataset.inc)  changeQty(Number(t.dataset.inc), +1);
  if (t.dataset.dec)  changeQty(Number(t.dataset.dec), -1);
  if (t.closest("#openCart")) openCart(true);
  if (t.id === "closeCart" || t.id === "overlay") openCart(false);
});

$("vegOnly").addEventListener("change", (e) => { vegOnly = e.target.checked; renderMenu(); });

$("placeOrder").addEventListener("click", async () => {
  // Table number: URL se (?table=5), warna user se poochho
  let table = tableNo;
  if (!table) table = prompt("Aapka table number kya hai?");
  if (!table) return;

  // Cart ko backend ke format mein badlo: [{id, qty}, ...]
  const items = Object.entries(cart).map(([id, qty]) => ({ id: Number(id), qty }));

  $("placeOrder").disabled = true;          // double click se do order na ban jayein
  try {
    const res = await fetch(BASE + "/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ table: Number(table), items })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Order fail ho gaya");

    // Success: cart khali karo aur confirmation dikhao
    cart = {};
    renderMenu();
    renderCart();
    $("cartItems").innerHTML = `<p class="panel-empty">✅ Order placed!<br><b>Order #${data.orderId}</b><br>Total ${rupee(data.total)}<br>Kitchen ko bhej diya gaya hai.</p>`;
  } catch (err) {
    alert("Order nahi gaya: " + err.message);
    $("placeOrder").disabled = false;
  }
});

// ============ 8. START ============
// Backend (node server.js) se dishes mangwao, phir screen par dikhao
async function loadMenu() {
  try {
    const res = await fetch(BASE + "/api/menu");
    if (!res.ok) throw new Error("Server error");
    menu = await res.json();
    renderTabs();
    renderMenu();
    renderCart();
  } catch (err) {
    $("menu").innerHTML = `<p class="empty">Menu load nahi hua. Kya backend chal raha hai? (terminal mein: node server.js)</p>`;
    console.error(err);
  }
}
loadMenu();

// ============ 10. MOOD QUIZ ============
// 5 sawaal poochhta hai, jawab backend (/api/suggest) ko bhejta hai, aur 3 dishes dikhata hai
const QUESTIONS = [
  { key: "mood", q: "How are you feeling today?",
    opts: [["happy", "Happy"], ["tired", "Tired"], ["stressed", "Stressed"], ["celebrating", "Celebrating"]] },
  { key: "hunger", q: "How hungry are you?",
    opts: [["light", "Just a snack"], ["medium", "Normal"], ["heavy", "Very hungry"]] },
  { key: "taste", q: "What are you craving?",
    opts: [["spicy", "Spicy"], ["cheesy", "Cheesy"], ["savory", "Savoury"], ["sweet", "Sweet"], ["refreshing", "Refreshing"]] },
  { key: "diet", q: "Veg or non-veg?",
    opts: [["veg", "Veg"], ["nonveg", "Non-veg"], ["any", "No preference"]] },
  { key: "budget", q: "Budget for one dish?",
    opts: [["150", "Up to ₹150"], ["250", "Up to ₹250"], ["any", "No limit"]] }
];

let quizStep = 0;
let quizAnswers = {};
let quizResults = null;      // backend se aaye suggestions
let quizError = null;

function openQuiz() {
  quizStep = 0; quizAnswers = {}; quizResults = null; quizError = null;
  renderQuiz();
  $("quizOverlay").classList.add("open");
}
function closeQuiz() { $("quizOverlay").classList.remove("open"); }

function renderQuiz() {
  const box = $("quiz");

  // --- Sawaal dikhao ---
  if (quizStep < QUESTIONS.length) {
    const q = QUESTIONS[quizStep];
    box.innerHTML = `
      <div class="q-head"><span>Question ${quizStep + 1} of ${QUESTIONS.length}</span>
        <button class="q-x" data-qclose aria-label="Close">×</button></div>
      <div class="q-bar"><div style="width:${(quizStep / QUESTIONS.length) * 100}%"></div></div>
      <h2>${q.q}</h2>
      <div class="q-opts">
        ${q.opts.map(([val, label]) =>
          `<button class="q-opt ${quizAnswers[q.key] === val ? "sel" : ""}" data-qopt="${val}">${label}</button>`).join("")}
      </div>
      ${quizStep > 0 ? `<button class="q-back" data-qback>← Back</button>` : ""}`;
    return;
  }

  // --- Jawab aa raha hai ---
  if (!quizResults && !quizError) {
    box.innerHTML = `<p class="q-loading">Finding the best dishes for you...</p>`;
    return;
  }

  // --- Error ---
  if (quizError) {
    box.innerHTML = `
      <div class="q-head"><span>Oops</span><button class="q-x" data-qclose aria-label="Close">×</button></div>
      <h2>Could not get suggestions</h2>
      <p class="q-loading">${quizError}</p>
      <div class="q-actions"><button class="ghost" data-qrestart>Start again</button><button class="solid" data-qretry>Try again</button></div>`;
    return;
  }

  // --- Result ---
  const cartCount = Object.values(cart).reduce((a, b) => a + b, 0);
  if (quizResults.length === 0) {
    box.innerHTML = `
      <div class="q-head"><span>Result</span><button class="q-x" data-qclose aria-label="Close">×</button></div>
      <h2>No match found</h2>
      <p class="q-loading">Nothing fits that budget and diet. Try a higher budget.</p>
      <div class="q-actions"><button class="solid" data-qrestart>Start again</button></div>`;
    return;
  }
  box.innerHTML = `
    <div class="q-head"><span>Picked for you</span><button class="q-x" data-qclose aria-label="Close">×</button></div>
    <h2>Our top ${quizResults.length} for you</h2>
    ${quizResults.map((d) => {
      const qty = cart[d.id] || 0;
      const control = qty === 0
        ? `<button class="add" data-qadd="${d.id}">Add</button>`
        : `<div class="stepper"><button data-qdec="${d.id}" aria-label="Remove one">−</button><span>${qty}</span><button data-qinc="${d.id}" aria-label="Add one">+</button></div>`;
      return `
        <div class="q-result">
          <div class="thumb"><img src="${d.image}" alt="${d.name}" onerror="this.style.display='none'"></div>
          <div class="body">
            <h3>${d.name} <span class="mark ${d.type}"></span></h3>
            <p class="why">${d.reason}</p>
            <div class="row2"><span class="price">${rupee(d.price)}</span>${control}</div>
          </div>
        </div>`;
    }).join("")}
    <div class="q-actions">
      <button class="ghost" data-qrestart>Start again</button>
      <button class="solid" data-qcart>View cart${cartCount ? " (" + cartCount + ")" : ""}</button>
    </div>`;
}

async function fetchSuggestions() {
  quizResults = null; quizError = null;
  renderQuiz();
  try {
    const res = await fetch(BASE + "/api/suggest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(quizAnswers)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Server error");
    quizResults = data;
  } catch (err) {
    quizError = "Please check that the backend is running (node server.js).";
    console.error(err);
  }
  renderQuiz();
}

// Quiz ke clicks (alag data-q... attributes, taaki menu ke buttons se na takraayein)
document.addEventListener("click", (e) => {
  const t = e.target;
  if (t.closest("#openQuiz")) return openQuiz();
  if (t.id === "quizOverlay" || t.closest("[data-qclose]")) return closeQuiz();

  const opt = t.closest("[data-qopt]");
  if (opt) {
    quizAnswers[QUESTIONS[quizStep].key] = opt.dataset.qopt;
    quizStep++;
    return quizStep === QUESTIONS.length ? fetchSuggestions() : renderQuiz();
  }
  if (t.closest("[data-qback]")) { quizStep--; return renderQuiz(); }
  if (t.closest("[data-qretry]")) return fetchSuggestions();
  if (t.closest("[data-qrestart]")) { quizStep = 0; quizAnswers = {}; quizResults = null; quizError = null; return renderQuiz(); }
  if (t.closest("[data-qcart]")) { closeQuiz(); return openCart(true); }

  const add = t.closest("[data-qadd]"), inc = t.closest("[data-qinc]"), dec = t.closest("[data-qdec]");
  if (add) { changeQty(Number(add.dataset.qadd), +1); return renderQuiz(); }
  if (inc) { changeQty(Number(inc.dataset.qinc), +1); return renderQuiz(); }
  if (dec) { changeQty(Number(dec.dataset.qdec), -1); return renderQuiz(); }
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeQuiz(); });

// ============ 9. APP BANAO (PWA) ============
// Service worker register karo, taaki phone par "Install app" ka option aaye
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("/sw.js").catch((err) => console.log("SW register nahi hua:", err));
}
