# Next Session

## ✅ Done (27 May 2026)

### Growth Hacking
- [x] **Share button** on ALL outputs (bg remove, upscale, imagine, voice)
- [x] **Group support** — `my_chat_member` handler, welcome message on bot add
- [x] **Hindi /start** — bilingual welcome with all commands in Hindi
- [x] **Inline mode** — `@AiBgRemover_Bot` in any chat (share, features, premium)
- [x] **Unified limit block** — all 4 limit blocks now show share + premium buttons
- [x] **Updated /share** — switchToChat button + copy link
- [x] **Updated /help** — mentions inline mode + share button
- [x] `BOT_USERNAME` env var support for flexible bot naming
- [x] PLAN.md updated with Phase 3 ✅

## ✅ Done (25 May 2026)

### Infrastructure
- [x] 2-bot architecture: Main Bot (`/webhook`) + Admin Bot (`/admin-webhook`) on same Render service
- [x] Webhook timeout fix: respond 200 OK immediately, process in background
- [x] AGENTS.md added to .gitignore (contains secrets)

### Support Ticket System
- [x] `support_tickets` table + `/support` command (user submits, DB saves)
- [x] `/tickets`, `/reply <id> <msg>`, `/close <id>` admin commands in Admin Bot
- [x] Notification via admin bot: new ticket → admin bot DM

### Premium / Payment System
- [x] `payment_orders` table + `user_subscriptions` table (future-proof for video/audio gen)
- [x] `/premium` command with inline keyboard (Monthly ₹49 / Yearly ₹499)
- [x] Unique order ref `BG-XXXXX` generation
- [x] QR code payment (UPI ID hidden in QR, not shown to user)
- [x] `/cancel` command — exit payment flow, DB status `cancelled`, admin notified
- [x] Payment screenshot handler — user sends photo → saved to order
- [x] Text handler — if user types instead of screenshot, bot says "send photo"
- [x] `/payments` admin command — pending orders with screenshot status
- [x] `/activate <ticket_id|order_ref> <plan>` — dual format: ticket ya order se activate
- [x] `/deactivate <chat_id>` — manually remove premium
- [x] `/premiumusers` — list all active premium users
- [x] Auto-deactivate expired premium (checked on `/stats` and photo send)
- [x] Messages to users sent via Main Bot token (admin bot can't DM users)

### Admin Bot
- [x] `src/admin-bot.js` — separate bot instance
- [x] Auth via `ADMIN_CHAT_ID` (no password needed, no login expiry)
- [x] Commands: `/start`, `/tickets`, `/payments`, `/premiumusers`, `/reply`, `/close`, `/activate`, `/deactivate`, `/admin`, `/debug`

### Bot Polish
- [x] Updated `/start` message with features list
- [x] `/support` mentioned in `/help`
- [x] `/cancel` in payment flow
- [x] UPI_ID fallback set to `7435012637@fam`

## Current Commands

### Main Bot (@BgRemoverBot)
| Command | Description |
|---------|-------------|
| `/start` | Welcome + referral |
| `/help` | Instructions + remaining tries |
| `/share` | Referral link |
| `/stats` | Your usage stats |
| `/upscale` | 4x HD upscale (send photo after) |
| `/imagine` | AI image generation (FLUX Pro) |
| `/support` | Submit support ticket |
| `/premium` | View plans & buy |
| `/cancel` | Cancel pending payment |
| `/debug` | Env status |

### Admin Bot
| Command | Description |
|---------|-------------|
| `/tickets` | Open support tickets |
| `/payments` | Pending payment orders |
| `/premiumusers` | Active premium users list |
| `/reply <id> <msg>` | Reply to ticket |
| `/close <id>` | Close ticket |
| `/activate <id\|ref> <plan>` | Activate premium (ticket or order) |
| `/deactivate <chat_id>` | Remove premium |
| `/admin` | Bot analytics |
| `/debug` | System status |

## Known Issues
- Auto-deactivate only triggers on user action (photo send or /stats). Expired users won't be deactivated until they interact.
- Payment screenshot text handler catches ALL text messages when user has pending payment (even commands). `/cancel` works though.
- Admin bot `/start` message list not synced with actual commands (add new ones manually).

## 🔜 Next

### 1. Payment Automation
- [ ] **Telegram Stars**: `sendInvoice` + `pre_checkout_query` for auto premium
- [ ] **Auto-confirm**: UPI webhook / payment gateway integration to skip manual verify
- [ ] **Price experimentation**: Test different plan prices

### 2. More Photoroom Features
- [ ] **AI Background replace** — `/api/ai-background` (diffusion-outpaint-v3)
- [ ] **AI Fill** — `/api/fill` (inpainting)
- [ ] **AI Erase** — `/api/erase` (object removal)
- [ ] **AI Shadows** — `/api/ai-shadows`
- [ ] **Image Caption** — `/api/caption`

### 3. Referral Automation
- [ ] Auto-grant premium days on referral milestones
- [ ] Referral leaderboard
- [ ] Milestone notification DM

### 4. Admin Tools
- [ ] `/grant <user_id> <days>` — manual premium grant
- [ ] Daily/weekly stats
- [ ] Error alerting to admin chat
- [ ] Revenue tracking

### 5. Future Features (video/audio gen)
- [ ] Subscription-per-feature model ready (`user_subscriptions.feature` column)
- [ ] Coming: AI Video Generation (ElevenLabs?)
- [ ] Coming: AI Voice & Sound Generation

## Blockers
- **Payment**: Telegram Stars merchant account not set up
- **More features**: AI Background, Fill, Erase need complex mask UX on Telegram
- **Scale**: Render free tier may hit CPU/memory limits with many concurrent users
