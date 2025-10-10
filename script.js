/* script.js
   - Single-file client logic for:
     * Google OAuth token-based sign-in (GSI token client)
     * Creating/locating /abide/ folder in user's Drive
     * Uploading videos (multipart upload)
     * Listing videos in /abide/ and presenting feed
     * Making files public (optional)
   - Replace PLACEHOLDER_CLIENT_ID with your Google OAuth client ID (see README)
*/

const CLIENT_ID = "PLACEHOLDER_CLIENT_ID.apps.googleusercontent.com"; // <-- replace
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.metadata.readonly";
let tokenClient;
let accessToken = null;
let abideFolderId = null; // caches user's /abide/ folder id

/* ---------- UI elements ---------- */
const googleBtn = document.getElementById("google-signin");
const authSection = document.getElementById("auth-section");
const uploadSection = document.getElementById("upload-section");
const feedSection = document.getElementById("feed-section");
const fileInput = document.getElementById("file-input");
const uploadBtn = document.getElementById("upload-btn");
const tagsInput = document.getElementById("tags-input");
const publicCheckbox = document.getElementById("public-checkbox");
const uploadStatus = document.getElementById("upload-status");
const videoFeed = document.getElementById("video-feed");
const signoutBtn = document.getElementById("signout-btn");
const signedArea = document.getElementById("signed-area");
const userEmailSpan = document.getElementById("user-email");
const filterTagInput = document.getElementById("filter-tag");
const applyFilterBtn = document.getElementById("apply-filter");
const clearFilterBtn = document.getElementById("clear-filter");

function initTokenClient() {
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: DRIVE_SCOPE,
    callback: (resp) => {
      if (resp.error) {
        console.error("Token error", resp);
        alert("Failed to get token: " + resp.error);
        return;
      }
      accessToken = resp.access_token;
      onSignInSuccess();
    }
  });
}

/* ---------- Authentication flow ---------- */
googleBtn.addEventListener("click", () => {
  if (!tokenClient) initTokenClient();
  tokenClient.requestAccessToken({prompt: "consent"});
});

signoutBtn.addEventListener("click", () => {
  // Revoke token (best-effort)
  if (accessToken) {
    fetch(`https://oauth2.googleapis.com/revoke?token=${accessToken}`, {method: "POST"})
      .catch(()=>{});
  }
  accessToken = null;
  abideFolderId = null;
  userEmailSpan.textContent = "";
  signedArea.classList.add("hidden");
  uploadSection.classList.add("hidden");
  feedSection.classList.add("hidden");
  authSection.classList.remove("hidden");
  videoFeed.innerHTML = "";
});

/* ---------- After sign-in ---------- */
async function onSignInSuccess(){
  authSection.classList.add("hidden");
  uploadSection.classList.remove("hidden");
  feedSection.classList.remove("hidden");
  signedArea.classList.remove("hidden");

  // get basic user info from token
  const tokenInfo = await fetch(`https://www.googleapis.com/oauth2/v3/userinfo`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  }).then(r => r.json());

  userEmailSpan.textContent = tokenInfo.email || tokenInfo.sub || "(signed in)";

  // ensure abide folder exists (or create)
  abideFolderId = await ensureAbideFolder();
  // initial load
  await refreshFeed();
}

/* ---------- Drive helpers ---------- */

async function driveFetch(path, method='GET', body=null, headers={}) {
  const url = `https://www.googleapis.com/drive/v3${path}`;
  const res = await fetch(url, {
    method,
    headers: Object.assign({ Authorization: `Bearer ${accessToken}` }, headers),
    body
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Drive API ${method} ${path} failed: ${res.status} ${text}`);
  }
  return res.json();
}

async function ensureAbideFolder(){
  // find folder named 'abide' in root (only search user's drive)
  const q = encodeURIComponent("name = 'abide' and mimeType = 'application/vnd.google-apps.folder' and trashed = false");
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&fields=files(id,name)`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  }).then(r => r.json());

  if (res.files && res.files.length > 0) {
    return res.files[0].id;
  }

  // create folder in root if not exists
  const create = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'abide', mimeType: 'application/vnd.google-apps.folder' })
  }).then(r => r.json());

  return create.id;
}

/* ---------- Upload a video (multipart) ---------- */
uploadBtn.addEventListener("click", async () => {
  const file = fileInput.files[0];
  if (!file) {
    alert('Pick a video file first');
    return;
  }
  uploadStatus.textContent = "Uploading...";
  try {
    const fileId = await uploadFileToAbide(file);
    // optionally make public
    if (publicCheckbox.checked) {
      await makeFilePublic(fileId);
    }
    // store tags as a description (simple approach)
    const tags = (tagsInput.value || "").trim();
    if (tags) {
      await updateFileMetadata(fileId, { description: JSON.stringify({ tags: tags.split(',').map(t=>t.trim()) })});
    }
    uploadStatus.textContent = "Upload complete ✨";
    fileInput.value = "";
    tagsInput.value = "";
    await refreshFeed();
  } catch (err) {
    console.error(err);
    uploadStatus.textContent = "Upload failed: " + (err.message || err);
  }
});

/* multipart upload: metadata + file */
async function uploadFileToAbide(file) {
  // Step 1: create metadata with parent = abideFolderId (requires folder id)
  const metadata = {
    name: file.name,
    mimeType: file.type || 'video/mp4',
    parents: [abideFolderId],
  };

  const boundary = '-------314159265358979323846';
  const delimiter = "\r\n--" + boundary + "\r\n";
  const close_delim = "\r\n--" + boundary + "--";

  const reader = new FileReader();
  const fileContent = await new Promise((resolve, reject) => {
    reader.onload = e => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });

  const base64Data = btoa(
    new Uint8Array(fileContent)
      .reduce((data, byte) => data + String.fromCharCode(byte), '')
  );

  const multipartRequestBody =
    delimiter +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) +
    delimiter +
    'Content-Type: ' + (file.type || 'application/octet-stream') + '\r\n' +
    'Content-Transfer-Encoding: base64\r\n' +
    '\r\n' +
    base64Data +
    close_delim;

  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,parents', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'multipart/related; boundary="' + boundary + '"'
    },
    body: multipartRequestBody
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error('Upload failed: ' + txt);
  }
  const json = await res.json();
  return json.id;
}

/* update metadata (description) */
async function updateFileMetadata(fileId, metadataObj) {
  return fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,description`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(metadataObj)
  }).then(r => r.json());
}

/* make a file public (anyone with link can read) */
async function makeFilePublic(fileId) {
  return fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'reader', type: 'anyone' })
  }).then(r => r.json());
}

/* list videos in /abide/ folder */
async function listAbideVideos() {
  // list video mime types in the abide folder
  // query: parents in folder & mimeType contains video
  const q = encodeURIComponent(`'${abideFolderId}' in parents and mimeType contains 'video/' and trashed = false`);
  const url = `https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&fields=files(id,name,mimeType,description,webContentLink,webViewLink,owners)&orderBy=createdTime desc&pageSize=100`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }});
  const json = await res.json();
  return json.files || [];
}

/* ---------- Feed UI logic ---------- */
async function refreshFeed(filterTag=null) {
  try {
    videoFeed.innerHTML = "";
    const files = await listAbideVideos();
    // map files to items with tags parsed from description if available
    const items = files.map(f => {
      let tags = [];
      try {
        const d = f.description;
        if (d) {
          const parsed = JSON.parse(d);
          if (parsed && parsed.tags) tags = parsed.tags;
        }
      } catch(e){ /* ignore */ }
      // build a download/stream url - prefer drive direct download endpoint
      const streamUrl = `https://drive.google.com/uc?export=download&id=${f.id}`;
      return { id: f.id, name: f.name, owners: f.owners, streamUrl, tags };
    });

    // optional filter
    let filtered = items;
    if (filterTag) {
      const t = filterTag.toLowerCase();
      filtered = items.filter(it => it.tags.map(x=>x.toLowerCase()).some(tag => tag.includes(t)));
    }
    // randomize order for "endless" effect
    filtered.sort(() => 0.5 - Math.random());

    if (filtered.length === 0) {
      videoFeed.innerHTML = `<div class="video-card"><div class="muted">No videos found in your /abide/ folder yet.</div></div>`;
      return;
    }

    // create video cards
    filtered.forEach(it => {
      const card = document.createElement('div');
      card.className = 'video-card';
      const meta = document.createElement('div');
      meta.className = 'video-meta';
      meta.innerHTML = `<div>${it.name}</div><div class="muted">${(it.tags||[]).join(' ')}</div>`;
      const vid = document.createElement('video');
      vid.src = it.streamUrl;
      vid.setAttribute('playsinline','');
      vid.controls = true;
      vid.loop = true;
      card.appendChild(vid);
      card.appendChild(meta);
      videoFeed.appendChild(card);
    });

    setupAutoPlay();
  } catch (err) {
    console.error(err);
    videoFeed.innerHTML = `<div class="video-card"><div class="muted">Failed to load videos: ${err.message || err}</div></div>`;
  }
}

/* autoplay logic: play when >70% visible */
function setupAutoPlay(){
  const videos = document.querySelectorAll('.video-card video');
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      const video = entry.target;
      if (entry.intersectionRatio > 0.7) {
        video.play().catch(()=>{});
      } else {
        video.pause();
      }
    });
  }, { threshold: [0.25,0.5,0.7,0.9] });

  videos.forEach(v => {
    observer.observe(v);
    v.addEventListener('click', () => {
      if (v.paused) v.play(); else v.pause();
    });
  });
}

/* ---------- filtering ---------- */
applyFilterBtn.addEventListener('click', () => {
  const tag = filterTagInput.value.trim();
  refreshFeed(tag ? tag : null);
});
clearFilterBtn.addEventListener('click', () => {
  filterTagInput.value = "";
  refreshFeed(null);
});

/* ---------- init ---------- */
window.addEventListener('load', () => {
  // make sure CLIENT_ID is set
  if (CLIENT_ID.includes("PLACEHOLDER")) {
    console.warn("Replace CLIENT_ID in script.js with your Google OAuth client ID (see README).");
    // leave the UI active; clicking sign-in will fail until replaced
  }
  try {
    initTokenClient();
  } catch(e) {
    console.warn("Token client not ready yet; will init when user clicks sign in.");
  }
});
