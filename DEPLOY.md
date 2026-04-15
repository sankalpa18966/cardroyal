# 🚀 VPS Deployment Guide — CardRoyal

## Prerequisites
- Ubuntu 22.04 VPS (DigitalOcean / Hostinger / Contabo etc.)
- Domain name (optional but recommended)
- SSH access to VPS

---

## STEP 1 — VPS ෙකෙ Docker Install කරන්න

SSH ෙකෙ login වෙලා run කරන්න:

```bash
# System update
sudo apt update && sudo apt upgrade -y

# Docker official script
curl -fsSL https://get.docker.com | sudo sh

# Current user ට docker permission දෙන්න (logout/login required after)
sudo usermod -aG docker $USER

# Docker Compose plugin check
docker compose version
```

---

## STEP 2 — Code VPS ෙකෙට දාන්න

### Option A: Git (Recommended)
```bash
# VPS ෙකෙ
cd /home/$USER
git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git game
cd game
```

### Option B: SCP (Direct upload from Windows)
Windows PowerShell ෙකෙ:
```powershell
scp -r D:\software\game root@YOUR_VPS_IP:/home/cardroyal/game
```

---

## STEP 3 — .env File VPS ෙකෙ Create කරන්න

`.env` git ෙකෙ නෑ — manually create කරන්න:

```bash
cd /home/$USER/game
nano .env
```

Paste කරන්න:
```env
PORT=3000
MONGODB_URI=mongodb+srv://sankalpaprabha262_db_user:Sankalpa%40123@cluster0.8yppizy.mongodb.net/cardgame?appName=Cluster0
JWT_SECRET=cardgame_super_secret_key_2024_xK9p
```
`Ctrl+X` → `Y` → `Enter` save කරන්න.

---

## STEP 4 — Docker ෙකෙ Build + Start

```bash
cd /home/$USER/game
docker compose up -d --build
```

Check කරන්න:
```bash
docker ps
docker compose logs -f
```

App `http://YOUR_VPS_IP:3000` ෙකෙ run වෙනවා. ✅

---

## STEP 5 — Nginx Reverse Proxy (Port 80/443)

### Install Nginx
```bash
sudo apt install nginx -y
sudo systemctl enable nginx
```

### Create site config
```bash
sudo nano /etc/nginx/sites-available/cardroyal
```

Paste (YOUR_DOMAIN replace කරන්න):
```nginx
server {
    listen 80;
    server_name YOUR_DOMAIN www.YOUR_DOMAIN;

    # WebSocket support (Socket.IO)
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 86400s;
    }
}
```

### Enable site
```bash
sudo ln -s /etc/nginx/sites-available/cardroyal /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

---

## STEP 6 — SSL (HTTPS) — Free Certbot

```bash
sudo apt install certbot python3-certbot-nginx -y
sudo certbot --nginx -d YOUR_DOMAIN -d www.YOUR_DOMAIN
```

Auto-renewal setup (automatic):
```bash
sudo systemctl status certbot.timer
```

Done! App `https://YOUR_DOMAIN` ෙකෙ live. 🎉

---

## STEP 7 — Firewall Setup

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

---

## 🔄 Code Update කරන්නේ හැටි

```bash
cd /home/$USER/game
git pull origin main
docker compose up -d --build
```

---

## 📋 Useful Commands

| Command | Purpose |
|---------|---------|
| `docker compose up -d --build` | Build + start |
| `docker compose down` | Stop |
| `docker compose logs -f` | Live logs |
| `docker ps` | Running containers |
| `docker compose restart` | Restart app |
| `sudo systemctl restart nginx` | Restart Nginx |
