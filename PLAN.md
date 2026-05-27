# Telegram Bot — AI Background Remover

## Tech Stack
- **Runtime**: Node.js v22
- **Bot Framework**: Telegraf v4 (webhook mode)
- **Image Processing**: sharp
- **Database**: Supabase PostgreSQL (free 500MB tier)
- **Auth**: Firebase anonymous auth (REST API)
- **API**: Photoroom mask API (via reverse-engineered endpoints)
- **Hosting**: Render.com free tier + UptimeRobot

**2-Bot Architecture:**
- **Main Bot** (`/webhook`) — All user features
- **Admin Bot** (`/admin-webhook`) — All admin commands

---

## Phase 1 ✅ — MVP (24 May 2026)
- [x] Bot setup with Telegraf + webhook mode on Render
- [x] Photo → Background removal → Result (Photoroom mask API)
- [x] Supabase PostgreSQL (users, daily_usage, referrals, images)
- [x] 3/day → 10/day free limit with proper counter
- [x] Referral system (`/share`)
- [x] Admin panel with password auth
- [x] All `await` bugs fixed (8 total)
- [x] XOR-encrypted API URLs
- [x] AI Upscale 4x HD (`/upscale`)
- [x] AI Image Generation (`/imagine` — FLUX Pro)
- [x] AGENTS.md + NEXT_SESSION.md

---

## Phase 2 ✅ — Support + Payment System (25 May 2026)
- [x] Support ticket system (`support_tickets` table)
- [x] `/support`, `/tickets`, `/reply`, `/close`
- [x] Payment orders (`payment_orders` table + `user_subscriptions` table)
- [x] `/premium` — Inline buttons, QR code payment (UPI)
- [x] `/cancel` — Exit payment flow
- [x] `/payments`, `/activate`, `/deactivate`, `/premiumusers`
- [x] Screenshot handler + text validation
- [x] Admin Bot separated from Main Bot
- [x] Auto-deactivate expired premium
- [x] QR code payment (UPI hidden, 7435012637@fam)

---

## Phase 3 ✅ — Growth Hacking (27 May 2026)
- [x] Share button on every output (bg remove, upscale, imagine, voice)
- [x] Group support + welcome message on add
- [x] Hindi /start welcome message (bilingual)
- [x] Inline mode (`@AiBgRemover_Bot` in any chat)
- [x] Share+premium buttons on daily limit block
- [x] @BotFather SEO-ready command list

## Phase 4 🔜 — Scale
- [ ] Telegram Stars auto-payment
- [ ] Referral milestones auto-grant
- [ ] AI Background replace
- [ ] AI Fill / Erase
- [ ] AI Shadows
- [ ] /grant command
- [ ] Revenue tracking

---

## Phase 4 🔜 — Scale
- [ ] Admin web dashboard
- [ ] Video Generation
- [ ] Audio/Voice Generation
- [ ] Bulk processing
- [ ] White-label

## Commands

### Main Bot
| Command | Description |
|---------|-------------|
| `/start` | Welcome + referral (Hindi/English) |
| `/help` | Instructions + remaining tries |
| `/share` | Referral link |
| `/stats` | Your usage stats |
| `/upscale` | 4x HD upscale |
| `/imagine` | AI image generation |
| `/voice` | AI voice generation (ElevenLabs) |
| `/support` | Submit ticket |
| `/premium` | View plans & buy |
| `/cancel` | Cancel payment/voice |
| `/debug` | Status check |

### Inline Mode
| Query | Result |
|-------|--------|
| `@AiBgRemover_Bot` | Share bot, features, premium info |
| `@AiBgRemover_Bot share` | Filtered results |

### Admin Bot
| Command | Description |
|---------|-------------|
| `/tickets` | Open support tickets |
| `/payments` | Pending payments |
| `/premiumusers` | Active premium users |
| `/reply <id> <msg>` | Reply to ticket |
| `/close <id>` | Close ticket |
| `/activate <id\|ref> <plan>` | Activate premium |
| `/deactivate <chat_id>` | Remove premium |
| `/admin` | Analytics |
| `/debug` | Status |
