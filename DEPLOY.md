# Deploy to Oracle Cloud (100% FREE, 24/7)

## Step 1: Create Oracle Cloud Account
1. Go to https://cloud.oracle.com
2. Click "Free Tier" → "Start for free"
3. Enter email, password, etc.
4. Add credit card (₹500 hold hoga, refund ho jayega)
5. Verify phone with OTP

## Step 2: Create VM Instance
1. Login → Dashboard → "Create a VM instance"
2. Name: `bg-bot`
3. Image: **Canonical Ubuntu 22.04** (or 24.04)
4. Shape: **VM.Standard.A1.Flex** (ARM) — 4 OCPUs, 24GB RAM
5. Boot volume: 200GB (free)
6. Add SSH key:
   - Windows: Open PowerShell → `ssh-keygen -t rsa -b 4096` → Enter Enter Enter
   - Public key from: `C:\Users\mohit\.ssh\id_rsa.pub` — copy paste karo
7. Click "Create"

## Step 3: SSH into VM
Instance ready hone par IP address dikhega (e.g. `129.xxx.xxx.xxx`)

```powershell
ssh ubuntu@129.xxx.xxx.xxx -i C:\Users\mohit\.ssh\id_rsa
```

## Step 4: Setup Bot (copy-paste yeh sab)
```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs git

# Verify
node -v  # Should be v22.x
npm -v

# Create project
mkdir -p ~/bot
cd ~/bot

# Initialize project
npm init -y
npm install telegraf sharp better-sqlite3 dotenv
```

## Step 5: Upload Bot Code
**From your PC (PowerShell):**
```powershell
# Zip bot code (exclude node_modules)
cd D:\Projects\exp\telegram-bot
Compress-Archive -Path .\src\,.\package.json,.\package-lock.json,.\PLAN.md -DestinationPath .\bot.zip

# Upload to VPS
scp -i C:\Users\mohit\.ssh\id_rsa .\bot.zip ubuntu@129.xxx.xxx.xxx:~/bot/
```

**On VPS (SSH):**
```bash
cd ~/bot
unzip bot.zip

# Set bot token
nano .env
# → Paste: BOT_TOKEN=7998216092:AAFp-16p4jI0KUYyRPpjVok0Rjy21arOGys
# → Ctrl+X, then Y, then Enter

# Test
node src/index.js
# If working, Ctrl+C
```

## Step 6: PM2 (Auto-start on boot)
```bash
# Install PM2 globally
sudo npm install -g pm2

# Start bot
pm2 start src/index.js --name bg-bot

# Auto-start on VM reboot
pm2 startup
# → Copy-paste the command it shows you
pm2 save
```

## Step 7: Done! ✅
```
pm2 status        # Check if running
pm2 logs bg-bot   # See logs
pm2 restart bg-bot  # Restart if needed
```

## Admin Commands
Bot me `/stats` bhejo apne use dekhne ke liye

## Useful PM2 Commands
| Command | What it does |
|---------|-------------|
| `pm2 status` | Check if bot running |
| `pm2 logs bg-bot` | See live logs |
| `pm2 restart bg-bot` | Restart bot |
| `pm2 stop bg-bot` | Stop bot |
| `pm2 delete bg-bot` | Remove from PM2 |
