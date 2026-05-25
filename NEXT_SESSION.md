# Next Session

## ✅ Done (25 May 2026)
### Day 1 Session
- [x] Bot name changed via BotFather
- [x] AI Upscaler (4x HD) via Photoroom reverse-engineered `/v2/upscale` endpoint
- [x] Fixed upscale 500 error: resize image to max 800px before API call
- [x] Fixed upscale quality: `creativity=0`, save as `.png` to avoid Telegram JPEG re-compression
- [x] AI Image Generation (`/imagine`) via Photoroom FLUX Pro — SSE stream → URL → download
- [x] Free limit increased from 3 → 10/day
- [x] Added limit check + counter to `/imagine`
- [x] Updated `/start` and `/help` messages with all features

### Current Commands
| Command | Description |
|---------|-------------|
| `/start` | Welcome + referral |
| `/help` | Instructions + remaining tries |
| `/share` | Referral link |
| `/stats` | Your usage stats |
| `/upscale` | 4x HD upscale (send photo after) |
| `/imagine` | AI image generation (FLUX Pro) |
| `/admin` | Bot analytics (password required) |
| `/password` | Admin auth |
| `/debug` | Env status + errors |

### Current Features
- Background removal (send photo) — Photoroom mask API
- 4x HD Upscale (`/upscale`) — Photoroom serverless upsale API
- AI Image Generator (`/imagine <prompt>`) — Photoroom FLUX Pro (SSE)
- 10 free operations/day total for all features
- Unlimited via referral rewards or premium
- Admin analytics panel

### Known Issues
- Background removal, upscale, and AI gen all use same daily limit counter (total 10/day)
- AI gen: SSE response from serverless-api.photoroom.com → image URL → download (2-step)
- AI gen: image URL expires (~15 min), downloaded immediately so fine

## 🔜 Next

### 1. Freemium / Payment
- **Telegram Stars**: `sendInvoice` + `pre_checkout_query` for automatic premium
- **UPI**: QR code generation + manual verification
- **Premium plans**: Pro (₹49/mo, 100/day), Ultra (₹99/mo, unlimited)
- **Admin grant command**: `/grant <user_id> <days>` to manually set premium

### 2. More Photoroom Features
- [ ] **AI Background replace** — `/api/ai-background` (diffusion-outpaint-v3 endpoint, takes image + prompt)
- [ ] **AI Fill** — `/api/fill` (inpainting via diffusion-backend.photoroom.com, needs mask)
- [ ] **AI Erase** — `/api/erase` (object removal, needs mask)
- [ ] **AI Shadows** — `/api/ai-shadows` (drop shadow generation)
- [ ] **Image Caption** — `/api/caption` (AI image description)

### 3. Referral Automation
- Auto-grant premium days when milestones hit (3/5/10 friends)
- Referral expiry tracking
- Milestone notification

### 4. Admin & Analytics
- `/grant` command for manual premium
- Daily/weekly active users stats
- Error alerting to admin chat
- Response time tracking

### 5. Bot Polish
- Add `/imagine` with style flags: `/imagine --anime <prompt>`
- Add available styles list
- Better error messages
- Queue/rate limiting per user

## Blockers
- **Payment**: Need to set up Telegram Stars merchant account
- **More features**: AI Background, Fill, Erase need mask input → more complex UX on Telegram
