# Telegram Bot — AI Background Remover

## Tech Stack
- **Runtime**: Node.js v22
- **Bot Framework**: Telegraf v4
- **Image Processing**: sharp
- **Database**: Supabase PostgreSQL
- **Auth**: Firebase anonymous auth
- **Hosting**: Render.com (webhook) + UptimeRobot

---

## Phase 1 ✅ — MVP (Complete 24 May 2026)
- [x] Bot setup with Telegraf + webhook mode on Render
- [x] Photo → Background removal → Result (Photoroom mask API)
- [x] Supabase PostgreSQL database (4 tables: users, daily_usage, referrals, images)
- [x] 3/day free limit with proper counter
- [x] Referral system (/share)
- [x] Admin panel (/admin + /password)
- [x] Debug command (/debug)
- [x] All `await` bugs fixed (8 total)
- [x] XOR-encrypted API URLs in config
- [x] AGENTS.md + NEXT_SESSION.md created

---

## Phase 2 🔜 — Freemium (Next)
- [ ] Payment: Telegram Stars / UPI
- [ ] Pro plan: ₹49/month (100/day, HD, AI Background, Upscale 2x)
- [ ] Ultra plan: ₹99/month (Unlimited, 4K, AI Shadow, AI Fill)
- [ ] AI Background replace
- [ ] AI Upscale
- [ ] Auto grant referral rewards

---

## Phase 3 🔜 — Scale
- [ ] Admin web dashboard
- [ ] Revenue + analytics tracking
- [ ] Response time monitoring
- [ ] Bulk processing
- [ ] White-label for businesses

## Commands
| Command | Description |
|---------|-------------|
| /start | Welcome + referral |
| /help | Instructions + remaining tries |
| /share | Referral link |
| /stats | Your usage stats |
| /admin | Bot analytics |
| /password | Admin auth |
| /debug | Env status + errors |
