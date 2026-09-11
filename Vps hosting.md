# VPS Hosting Guide — HQEPL Project

One server, one folder on the VPS: `server/` holds the API **and** the built
React client (inside `server/public`). You never run the `client` folder on
the VPS — you only build it on your own machine and copy the result in.

---

## 0. One-time: put the project on GitHub

On your **local machine**, from the project root (`Structure_Hqepl/`):

```bash
git init                      # only if not already a git repo
git add .
git commit -m "initial commit"
git remote add origin <your-github-repo-url>
git push -u origin main
```

From here on, every change you make locally: `git add . && git commit -m "..." && git push`.

---

## 1. First-time VPS setup (do this once)

SSH into your Hostinger VPS:

```bash
ssh root@your-vps-ip
```

Install Node.js (v18+) and git if not already there:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt install -y nodejs git
node -v      # confirm it installed
```

Clone your repo:

```bash
cd /var/www          # or any folder you prefer
git clone <your-github-repo-url> hqepl
cd hqepl
```

---

## 2. Build the client (on your LOCAL machine, not the VPS)

Every time you want to deploy new frontend changes:

```bash
cd client
```

Open `client/.env` and make sure `VITE_API_BASE_URL` points to your **live**
domain/IP (comment out the localhost line, uncomment/add the production one):

```
# VITE_API_BASE_URL=http://localhost:5000
VITE_API_BASE_URL=https://your-domain.com
```

Then build:

```bash
npm install
npm run build
```

This creates `client/dist/`.

---

## 3. Copy the build into the server folder

Still on your local machine, copy everything inside `client/dist/` into
`server/public/` (create the `public` folder if it doesn't exist):

```bash
cd ..                                   # back to project root
rm -rf server/public
mkdir -p server/public
cp -r client/dist/* server/public/
```

`server/public` is git-ignored on purpose (it's a build output — it gets
regenerated on every deploy, not committed).

---

## 4. Push local changes, pull on VPS

Local machine:

```bash
git add .
git commit -m "deploy: update build"
git push
```

> Note: since `server/public` is git-ignored, pushing/pulling won't move the
> build files through git. Two options:
> - **Simplest:** repeat step 2–3 directly on the VPS (build client on the
>   VPS itself after `git pull`), OR
> - **Recommended if VPS is low on RAM:** `scp` the `server/public` folder
>   from your machine straight to the VPS instead of building there:
>   ```bash
>   scp -r server/public root@your-vps-ip:/var/www/hqepl/server/public
>   ```

If you choose to build on the VPS itself:

```bash
ssh root@your-vps-ip
cd /var/www/hqepl
git pull
cd client && npm install && npm run build
cd .. && rm -rf server/public && mkdir server/public
cp -r client/dist/* server/public/
```

---

## 5. Server `.env` on the VPS

This file lives inside `server/` on the VPS (same folder as `server.js`).
It is **not** pulled from git (it's git-ignored) — create it manually once,
directly on the VPS:

```bash
cd /var/www/hqepl/server
nano .env
```

Paste and fill in real values:

```
NODE_ENV=production
PORT=5000
APP_NAME=AI_Inventory_Tool
APP_HOST=https://your-domain.com

MONGO_URI=<your real Atlas connection string>

JWT_SECRET=<generate a strong random string>
JWT_EXPIRES_IN=7d
JWT_REFRESH_SECRET=<generate a strong random string>
JWT_REFRESH_EXPIRES_IN=30d
JWT_COOKIE_EXPIRES_IN=7

BCRYPT_SALT_ROUNDS=12
```

**About `PORT`:** yes — whatever you set here is the port the app actually
listens on (`app.listen(PORT)` in `server.js`). It's not automatically
"live" to the internet just by being in `.env`:
- If you open `PORT` (e.g. 5000) directly in the VPS firewall, people access
  it as `http://your-vps-ip:5000`.
- If you put Nginx in front (recommended — see step 7), Nginx listens on the
  standard web ports 80/443 and forwards to your app's `PORT` internally, so
  people just visit `https://your-domain.com` with no port number.

Install dependencies once:

```bash
npm install --production
```

---

## 6. Keeping the server alive — what "auto run" actually means

Right now, if you just run `node server.js`, the process dies the moment you:
- close your SSH session, or
- the app crashes on an error, or
- the VPS reboots.

"Keeping it alive" means using a **process manager** that watches your app
and restarts it automatically in all three of those cases. You don't have to
use one, but without it you'd have to manually SSH in and re-run the command
every time something interrupts it — not practical for a live site.

**Simplest option — `nohup` (no auto-restart on crash/reboot, just survives you closing SSH):**
```bash
cd /var/www/hqepl/server
nohup node server.js > out.log 2>&1 &
```
Good enough for quick testing, not for a real live server — if it crashes at
2 AM, it just stays down until you notice.

**Recommended option — PM2 (a process manager, restarts on crash + on VPS reboot):**
```bash
npm install -g pm2
cd /var/www/hqepl/server
pm2 start server.js --name hqepl-server
pm2 save                # remembers this process
pm2 startup             # prints a command — run that command once, it makes PM2 (and your app) start automatically on VPS reboot
```

Useful PM2 commands afterward:
```bash
pm2 status              # see if it's running
pm2 logs hqepl-server   # view live logs
pm2 restart hqepl-server   # after a new deploy (new code pulled)
pm2 stop hqepl-server
```

This is the "automatic" part you were asking about: PM2 is what makes the
server come back up by itself if it crashes or the VPS restarts, without you
having to SSH in and type `node server.js` again.

---

## 7. (Optional but recommended) Nginx + free SSL

So visitors hit `https://your-domain.com` instead of `http://ip:5000`:

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
```

Create `/etc/nginx/sites-available/hqepl`:
```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:5000;   # must match PORT in .env
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Enable it and get SSL:
```bash
sudo ln -s /etc/nginx/sites-available/hqepl /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl restart nginx
sudo certbot --nginx -d your-domain.com
```

Point your domain's DNS **A record** to the VPS IP first, or `certbot` will
fail to verify.

---

## 8. Every future deploy — the short version

Once everything above is set up once, updating the live site is just:

**Local machine:**
```bash
# after editing client code
cd client && npm run build && cd ..
rm -rf server/public && mkdir server/public && cp -r client/dist/* server/public/
git add . && git commit -m "deploy update" && git push
scp -r server/public root@your-vps-ip:/var/www/hqepl/server/public
```

**On the VPS (only if server code also changed):**
```bash
ssh root@your-vps-ip
cd /var/www/hqepl
git pull
cd server && npm install --production
pm2 restart hqepl-server
```

If only the client changed, you don't even need to touch the VPS beyond the
`scp` step — but `pm2 restart` is harmless to run anyway if unsure.

**For Redis :**
```bash
sudo apt-get update && sudo apt-get install -y redis-server
sudo service redis-server start
```