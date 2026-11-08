<div align="center">

<img src="docs/logo.svg" width="88" alt="Haggl logo" />

# Haggl

### Let the AIs haggle. PayPal settles.

**A marketplace where AI agents negotiate every price, within limits no jailbreak can break,<br/>and PayPal settles the exact deal and pays the seller automatically.**

[![Live demo](https://img.shields.io/badge/▶_Live_demo-haggl.onrender.com-0070e0?style=for-the-badge)](https://haggl.onrender.com)
&nbsp;
[![Jailbreak Arena](https://img.shields.io/badge/🛡️_Try_to_break_it-Jailbreak_Arena-b45309?style=for-the-badge)](https://haggl.onrender.com/#/arena)

[![CI](https://github.com/VamsiKrishnaThota03/haggl/actions/workflows/ci.yml/badge.svg)](https://github.com/VamsiKrishnaThota03/haggl/actions/workflows/ci.yml)
![PayPal](https://img.shields.io/badge/PayPal-Checkout_·_Orders_·_Payouts_·_Webhooks-003087?logo=paypal&logoColor=white)
![Gemini](https://img.shields.io/badge/AI-Google_Gemini-7c3aed?logo=googlegemini&logoColor=white)
![AG Grid](https://img.shields.io/badge/AG_Grid-dashboard-0f8a5f)
![Render](https://img.shields.io/badge/hosted_on-Render-46e3b7?logo=render&logoColor=black)
![License: MIT](https://img.shields.io/badge/license-MIT-green)

<br/>

<img src="docs/haggl-demo.gif" width="860" alt="Two AI agents negotiate a bike from $250 to $180, then PayPal checkout" />

<sub><i>Live: my AI buyer agent (purple) haggles with Lena's AI seller. Every price is verified by code, and the deal is paid with PayPal.</i></sub>

</div>

---

## 💡 The idea in 30 seconds

Selling second-hand means endless *"is this still available?"* and *"what's your lowest price?"* messages. AI agents could handle that, but **an AI can be talked into anything**, and you shouldn't let something that can be tricked control your money.

Haggl splits the job:

<table>
<tr>
<td align="center" width="33%"><h3>🧠 The AI talks</h3>Google Gemini plays each seller's sales agent and your buyer agent: persona, persuasion, any language.</td>
<td align="center" width="33%"><h3>🛡️ Code holds the money</h3>The seller's floor price <b>never reaches the model</b>. Every AI decision is verified, clamped and scanned before anyone sees it.</td>
<td align="center" width="33%"><h3>💳 PayPal settles</h3>A server-side order for the <b>exact</b> agreed price is captured and verified, and the seller is paid out automatically.</td>
</tr>
</table>

## 🧪 For judges: try it in 2 minutes

> Open **[haggl.onrender.com](https://haggl.onrender.com)**. The free server may take ~40s to wake up. Payments use the PayPal **sandbox** (test money).

| # | Do this | You'll see |
|:-:|---|---|
| 1 | Click **🛍️ Let my AI shop for me**, then the example *"A bike for commuting to campus, under $200"* | Gemini shortlists bikes, your agent haggles with several sellers **in parallel**, walks away from one, and recommends the best deal |
| 2 | Click **Pay with PayPal** → **Log In** with a sandbox personal account | A receipt: order created by the server → captured and verified → **seller paid via PayPal Payouts** |
| 3 | Open **Arena** and click **🛠️ Fake admin** or **👵 Guilt trip** | The AI seller stays in character and holds its price. The live scoreboard: **0 successful jailbreaks** |
| 4 | Pick **🌐 हिन्दी** in the top bar, open a listing, and make an offer (or 🎤 speak it) | The agent negotiates in Hindi, while the seller sees an English translation |
| 5 | **Sell** → type a rough note → **✨ Write my listing with AI**, then open **Dashboard** | An AI-written listing with suggested prices, and an AG Grid dashboard of every deal and payout |

---

## ✨ Features

| | Feature | What it does |
|:-:|---|---|
| 🛍️ | **AI shopping agent** | One sentence → Gemini extracts the need and the budget → negotiates with multiple sellers **at the same time** → recommends the best deal, with the reason |
| 🤖 | **Agent vs agent** | Your buyer agent shows its **reasoning every round**, never reveals or exceeds your budget, and walks away instead of overpaying |
| 🛡️ | **Jailbreak Arena** | A public challenge to trick an AI seller below its secret price, with a live scoreboard, attacks classified by technique, and a wall of blocked attempts |
| 🌐 | **Any language, by voice** | 10 languages, 🎤 speech input and 🔊 spoken replies. The seller sees English; prices are verified in every script (even `$१५०`) |
| 💳 | **PayPal Checkout** | Smart Buttons + Orders v2, with the amount always taken from the server's deal record |
| 💸 | **Automatic seller payouts** | After capture, the seller is paid (minus a 5% platform fee) via the **Payouts API**, with live status |
| 🔔 | **Verified webhooks** | `PAYMENT.CAPTURE.*` and payout events, checked with PayPal's `verify-webhook-signature` (fails closed) |
| ✨ | **AI listing writer** | A rough note becomes a full listing with suggested asking and secret lowest prices |
| 📊 | **Seller dashboard** | AG Grid: deals, discounts, PayPal capture IDs, payout status, guardrail interventions, webhook events |

## 📸 Screenshots

| 🛍️ AI shopping agent: parallel negotiations | 🛡️ Jailbreak Arena |
|---|---|
| ![AI shopping agent](docs/screenshots/8-shop-negotiating.png) | ![Jailbreak Arena](docs/screenshots/10-arena.png) |
| **🤖 Agent vs agent, deal locked** | **🌐 Haggling in Hindi** |
| ![Deal room](docs/screenshots/3-deal-locked.png) | ![Hindi](docs/screenshots/12-hindi.png) |
| **✨ AI listing writer** | **📊 Seller dashboard (AG Grid)** |
| ![Sell](docs/screenshots/5-sell.png) | ![Dashboard](docs/screenshots/6-dashboard.png) |

---

## 🏗️ How it works

```mermaid
sequenceDiagram
    autonumber
    actor B as Buyer (or buyer AI)
    participant H as Haggl server
    participant G as Google Gemini
    participant P as PayPal

    B->>H: "Would you take $150?"
    H->>H: Policy engine → allowed range this turn<br/>(the floor price is never sent to the AI)
    H->>G: Persona + TURN RULES: "counter between $X and $Y"
    G-->>H: { reply, action, price } (structured JSON)
    H->>H: 🛡️ Guardrail: verify action, clamp price,<br/>scan the reply (and its translation) for leaked prices
    H-->>B: "I can do $220." ✓ price verified
    Note over B,H: …agents converge, deal locked at $180
    B->>H: Pay with PayPal
    H->>P: Orders v2: create order (amount from the deal record)
    B->>P: Approve in the PayPal popup
    H->>P: Capture → verify COMPLETED, reference_id, amount
    H->>P: Payouts: pay the seller (minus fee)
    P-->>H: Webhook → verify-webhook-signature
    H-->>B: ✅ Receipt: order · capture · payout
```

<details>
<summary><b>The negotiation math</b></summary>

The seller's minimum this round starts at the list price and concedes toward the secret floor as the buyer makes serious offers; motivated sellers concede faster:

$$\text{min}_r = \text{floor} + (\text{list} - \text{floor}) \cdot \max\left(0,\ 1 - r \cdot (0.18 + 0.17 \cdot \text{urgency})\right)$$

Lowball offers don't earn concessions. The buyer agent opens around 60% of the list price, raises its offer toward its budget each round, accepts when the ask fits its target, and walks away after 10 rounds or when the seller won't come within budget.
</details>

<details>
<summary><b>Code map</b></summary>

| File | What it does |
|---|---|
| `src/negotiation.js` | Policy engine, guardrails, buyer-agent strategy, jailbreak detection (**the core**) |
| `src/ai.js` | Gemini prompts with structured output, 10 languages, shopping planner and recommender, model fallbacks, offline negotiator |
| `src/paypal.js` | OAuth, Orders v2 (create/capture), Payouts, webhook signature verification |
| `server.js` | Express API, security headers (CSP), rate limits, health check, graceful shutdown |
| `src/store.js` | Seed listings, persistence, Jailbreak Arena scoreboard |
| `src/util.js`, `src/ratelimit.js` | Price helpers (multi-script digits), rate limiting |
| `public/` | Vanilla JS frontend (no build step), Web Speech API, AG Grid dashboard |
| `test/` | 15 tests: guardrails, prompt injection, multilingual offers, arena, platform (CI on Node 18/20/22) |
</details>

## 🧰 Built with

| Tool | How it's used |
|---|---|
| **PayPal JavaScript SDK** | Smart Payment Buttons in the deal room and the AI Shopper |
| **PayPal Orders v2 API** | Server-side order for the negotiated amount, then capture + verification (idempotent via `PayPal-Request-Id`) |
| **PayPal Payouts API** | Automatic seller payouts after each sale, idempotent per deal, with status tracking |
| **PayPal Webhooks API** | Capture and payout events, verified with `verify-webhook-signature` |
| **Google Gemini API** | Seller agents, buyer agent, shopping planner, deal recommender, listing writer: structured JSON output, spread across 3 free models |
| **Web Speech API** | Voice input and spoken replies in 10 languages, built into the browser and free |
| **AG Grid Community** | The seller dashboard data grid |
| **Render** | Hosting via the `render.yaml` blueprint |
| Node.js · Express · GitHub Actions | Backend and CI |

---

## 🚀 Run it locally

Everything is free: the PayPal sandbox and the Gemini free tier. Requires **Node.js 18.18+**.

```bash
git clone https://github.com/VamsiKrishnaThota03/haggl.git && cd haggl
npm install
cp .env.example .env     # add your keys (see below)
npm start                # → http://127.0.0.1:3000
npm test                 # 15 tests
```

<details>
<summary><b>Getting the free keys</b></summary>

**PayPal sandbox**
1. Go to [developer.paypal.com](https://developer.paypal.com) → **Testing Tools → Sandbox Accounts**. Make sure you have a **US Business** and a **US Personal** account (Create account → country *United States*).
2. **Apps & Credentials → Sandbox → Create App** (Merchant, linked to the US Business account). Copy the **Client ID** and **Secret** into `.env`.
3. Log in to checkout with the **US Personal** account's email and password (View/Edit account).

**Gemini (optional)**: [aistudio.google.com/apikey](https://aistudio.google.com/apikey) → Create API key (free, no card) → `GEMINI_API_KEY`. Without it, Haggl runs a built-in offline negotiator.
</details>

<details>
<summary><b>Deploy your own (free, on Render)</b></summary>

1. Render → **New → Blueprint** → select this repo (`render.yaml` configures everything).
2. Enter `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` and `GEMINI_API_KEY`.
3. Webhooks (optional): PayPal app → **Add Webhook** → `https://<your-app>.onrender.com/api/paypal/webhook` → events *Payment capture completed / refunded / reversed* and *Payouts batch / item* → copy the **Webhook ID** into `PAYPAL_WEBHOOK_ID`.

The free plan sleeps when idle (first load ~40s), and data is stored on the instance, so it resets on redeploy.
</details>

<details>
<summary><b>🔒 Security & production notes</b></summary>

- **The floor price never leaves the server.** It isn't sent to the model or the browser (tests cover this), and the model only sees this turn's allowed range.
- **Every AI output is validated:** unauthorised accepts are blocked, prices are clamped, and replies and translations are scanned for leaked prices in any digit script.
- **Payments:** amounts always come from the server; captures are checked against order ID, reference ID and amount; deals expire after 30 minutes; webhooks fail closed.
- **Web:** strict Content-Security-Policy (self + PayPal only), `X-Frame-Options: DENY`, HSTS, XSS-safe rendering (no `innerHTML` for user or AI text), and public Arena attempts are sanitised.
- **Abuse protection:** per-IP rate limits, input caps, one turn at a time per negotiation.
- **Resilience:** 12-second AI timeouts, 3-model fallback, deterministic offline negotiator, `/healthz`, graceful shutdown.
- **Secrets** stay in `.env` / Render environment variables. The server binds to `127.0.0.1` unless `HOST` is set.
</details>

## 🛣️ What's next

- Shopping agents that search across many marketplaces at once, with bundle deals and shipping negotiation
- Seller-defined rules of engagement in plain English ("never below $150, free case if they pay today")
- Seller accounts, refunds and dispute handling through PayPal

---

<div align="center">

Built for the **PayPal AI Hackathon** by **Vamsi Krishna Thota** · [MIT License](LICENSE)

<sub>The AI does the talking. Code holds the money rules. PayPal settles the deal.</sub>

</div>
