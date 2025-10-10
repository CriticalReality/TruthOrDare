# Abide — Drive-backed Shorts POC

This repo is a proof-of-concept (POC) frontend app that uses **Google Drive** as the per-user storage backend. Each user stores videos in their own `/abide/` folder. The web app signs users in with Google OAuth, uploads videos into that folder, can set files to "anyone with link", and lists playable videos from that folder.

> This is a POC. It is not production-ready: authentication and permissions are handled client-side and must be hardened before production.

## Features
- Google Sign-In (OAuth token client)
- Ensure `/abide/` folder exists (creates if missing)
- Upload videos from browser directly to user's Google Drive
- Optionally set uploaded file permission to "anyoneWithLink"
- List videos from `/abide/` and show as a vertically-scrollable "shorts" feed
- Basic tagging stored in each file's `description` as JSON (tags saved on upload)

## How to set up (Google Cloud console)
You must create an OAuth client ID to allow the web app to request Drive API scopes.

1. Visit Google Cloud Console: https://console.cloud.google.com
2. Create a new project (or pick an existing).
3. Enable the **Google Drive API** for the project (APIs & Services → Library → Google Drive API → Enable).
4. Configure OAuth consent screen (APIs & Services → OAuth consent screen).
   - Choose "External" for simple testing (you may need to set up test users).
   - Add the scope: `../auth/drive.file` (the script requests `drive.file` and `drive.metadata.readonly`).
5. Create OAuth 2.0 credentials (OAuth client ID) (APIs & Services → Credentials → Create Credentials → OAuth client ID).
   - Application type: **Web application**
   - Authorized JavaScript origins: add your GitHub Pages URL (e.g. `https://<github-username>.github.io` or `http://localhost:5500` for local testing).
   - Authorized redirect URIs: not required for the token client, but you can leave empty.
6. Copy the **Client ID** and paste it into `script.js` replacing `PLACEHOLDER_CLIENT_ID.apps.googleusercontent.com`.

## Run locally (recommended for development)
- You can serve the files locally with a static server (e.g., `npx http-server` or VSCode Live Server).
- If testing locally, add `http://localhost:PORT` to your OAuth authorized origins.

## Deploy on GitHub Pages
1. Push this repo to GitHub.
2. Settings → Pages → Source: `main / (root)` (or `gh-pages` branch if you prefer).
3. Add the GitHub Pages origin to OAuth authorized origins (same value shown by GitHub).

## Notes on permissions and public visibility
- By default, uploaded files are private to the user. If you check "Make public (anyone with link)", the script will call Drive permissions API to allow `anyone` with role `reader`. Only do that if the user consents.
- If you want your app to index videos across *many users* (to form a global feed), you need a central metadata index that other users can query:
  - Option A (recommended for PoC): Use **Firestore**/Firebase to collect metadata (uploader email, drive file ID, tags, public boolean) whenever a user uploads and allows indexing.
  - Option B: Have users manually make their `/abide/` folder public and publish a small `index.json` file in the folder; your app can then attempt to fetch public `index.json` from known user folders. This is clumsy for scale.

## Optional: Add a central metadata store (Firestore)
If you want cross-user recommendations, follow the Firebase quickstart and write metadata into Firestore on upload. The code includes places where you can call your own backend or Firestore to register new files.

## Limitations & caveats
- Drive API quotas may apply (per app).
- This app uses `drive.file` scope which allows file creation and modification only for files created by the app. You may adjust scopes if you need more access, but that may require verification for production.
- The Drive direct-download URL (`https://drive.google.com/uc?export=download&id=FILEID`) is used for playback. Google may throttle large or many requests.
- For truly public scaling, consider R2/Cloudflare or a proper CDN-backed storage.

---

## Summary of the flow
1. User clicks **Sign in with Google**.
2. App requests `drive.file` scope token.
3. App ensures a folder named `abide` exists (creating it if needed).
4. User can upload a video; it is placed inside their `/abide/` folder.
5. If user opts, the app can set file permission to `anyoneWithLink`.
6. The app lists videos from user’s `/abide/` folder and displays them as shorts.

---

If you want, I can:
- Provide a variant of the script that registers uploaded file metadata into Firestore (I’ll include the exact snippet and instructions to create a Firebase project).
- Add a "global feed" sample that reads a Firestore collection of video entries created by consenting users, enabling cross-user recommendations by tags.

Pick which extra step you want next (Firestore registration for indexing, or make the UI smaller/cleaner) and I’ll generate the exact code and instructions.
