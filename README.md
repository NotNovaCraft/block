# Nova's Blocks Server — Blocks Multiplayer Server

Run your own free Blocks multiplayer server and share the address with friends!

## Files Included
- `server.js` — Express + WebSocket multiplayer server
- `games/*.json` — Project files for every hosted game on your server
- `server.properties.json` — Server name, MOTD, max players, starting R$, and owner key
- `package.json` — Dependencies (`express`, `ws`)

---

## Option 1: Host Free on Render.com (Recommended)
1. Upload this folder (including the `games/` folder) to a free GitHub repository.
2. Go to [render.com](https://render.com) → **New +** → **Web Service** → connect your repo.
3. Set:
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Instance Type**: **Free**
4. Click **Deploy**. Copy your `https://your-server.onrender.com` URL and paste it into **Blocks → Multiplayer → Server Address**!

## Option 2: Host Free on Glitch.com or Replit
1. Create a new **Node.js** project on Glitch or Replit.
2. Upload `server.js`, `package.json`, `server.properties.json`, and the `games/` folder.
3. Click **Run**. Copy the live project URL and paste it into **Blocks → Multiplayer → Server Address**!

## Option 3: Run on Your Computer
```bash
npm install
npm start
```
Connect locally using `http://localhost:3000` (or share with friends using [ngrok](https://ngrok.com) / [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)).

## Adding Games & Reviewing Player Submissions
- **Any player** can build a game in **Blocks Studio** and submit it to your server for review.
- **As the Server Owner**: set an `ownerKey` in `server.properties.json` (or `BLOCKS_OWNER_KEY` environment variable), connect to your server, and click **Owner Login** to preview, approve, or decline player submissions—or drop `.json` project files directly into `games/`!

## Server Console Commands (when running locally)
- `list` — Show online players
- `say <message>` — Broadcast a server announcement
- `kick <player>` — Kick a player
