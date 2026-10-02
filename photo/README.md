# macc.lol/photo

A shared photo roll for mack and friends. Anyone can look; posting takes the invite code.

It runs as one Cloudflare Worker on the routes `macc.lol/photo` and `macc.lol/photo/*`. GitHub Pages still serves the rest of macc.lol. Because the Worker takes over `/photo`, nothing in this folder is ever served by GitHub Pages, and that includes `prog.exe`.

| piece | where |
| --- | --- |
| page, styles, script, fonts | `public/photo/` (Workers static assets) |
| API, image serving, share pages | `src/worker.js` |
| photo metadata, members | D1 database `macc-photo` (`schema.sql`) |
| image files | R2 bucket `macc-photo` (`full/<id>.jpg`, `thumb/<id>.jpg`) |
| songs | Apple Music 30 second previews (iTunes Search API), looped as a 15 second window |

The browser re-encodes every upload as a JPEG, 2400px on the long edge plus a 900px thumbnail, before sending it. That also removes the EXIF data, so GPS location never reaches the server.

## Run it locally

```bash
cd photo
npm install
npm run db:local      # create the tables in the local D1
npm run dev           # http://localhost:8787/photo/
```

Local secrets live in `.dev.vars`, which is gitignored. Copy the example file and fill it in. These values only apply to `wrangler dev` on your machine, so don't reuse the production codes:

```bash
cp .dev.vars.example .dev.vars
```

Local photos and data are stored in `.wrangler/`. Delete that folder to start over.

## First deploy

1. `npx wrangler login`
2. In the Cloudflare dashboard, open **R2** and turn it on. Cloudflare asks for a payment method, but you stay free up to 10 GB.
3. Create the database and bucket, then copy the printed `database_id` into `wrangler.jsonc`:
   ```bash
   npx wrangler d1 create macc-photo
   npx wrangler r2 bucket create macc-photo
   npm run db:remote
   ```
4. Deploy, then set the secrets:
   ```bash
   npm run deploy
   openssl rand -hex 32 | npx wrangler secret put SESSION_SECRET
   npx wrangler secret put INVITE_CODE    # the code you give friends
   npx wrangler secret put ADMIN_CODE     # your code; it can edit or delete anything
   ```
5. Open https://macc.lol/photo, tap **post**, and enter your admin code with your name. The name you use with the admin code is reserved, so friends can't post under it.

## Day to day

- **Ship changes:** `npm run deploy`. To make sure browsers pick up new CSS and JS, bump the `?v=` on `photo.css` and `photo.js` in `index.html`.
- **Change the invite code:** `npx wrangler secret put INVITE_CODE`. This signs every friend out. They rejoin with the new code under the same name, and their old posts are still theirs.
- **Remove someone's post:** sign in with the admin code, open the photo, and choose delete.
- **Logs:** `npx wrangler tail`

## How posting works

- Joining with the invite code plus a name creates that member, or picks them back up if the name already exists. That way friends can post from a phone and a laptop.
- Sessions are signed cookies that last a year and are scoped to `/photo`. The signature includes the current code, which is why changing a code signs people out.
- After 8 wrong codes from one IP, joining is blocked for 15 minutes.
- People can edit or delete only their own posts. The admin can edit or delete any post.

## Free tier, roughly

- Workers: 100k requests a day. A page view costs about one request per thumbnail on screen.
- R2: 10 GB storage, which is roughly 10,000 photos.
- D1: 5 GB.

Nothing here is backed up automatically. To back up the photos, use `npx wrangler r2 object get` or the dashboard. For the metadata, run `npx wrangler d1 export macc-photo --remote --output backup.sql`.
