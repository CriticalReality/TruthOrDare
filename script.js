/* script.js — Abide minimal video app */

const CLIENT_ID = "274592201441-l24f0rputob0op3flog6gsbjp2lls6cr.apps.googleusercontent.com";
const DRIVE_SCOPE =
  "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.metadata.readonly";

let tokenClient;
let accessToken = null;
let abideFolderId = null;
let tokenExpiresAt = 0;

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

/* ---------- Auth setup ---------- */
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
      tokenExpiresAt = Date.now() + 55 * 60 * 1000; // roughly 55 min lifetime
      onSignInSuccess();
    },
  });
}

async function ensureAccessToken() {
  if (!accessToken || Date.now() > tokenExpiresAt - 30 * 1000) {
    return new Promise((resolve) => {
      tokenClient.callback = (resp) => {
        accessToken = resp.access_token;
        tokenExpiresAt = Date.now() + 55 * 60 * 1000;
        resolve();
      };
      tokenClient.requestAccessToken({ prompt: "" }); // silent refresh
    });
  }
}

/* ---------- Event listeners ---------- */
googleBtn.addEventListener("click", () => {
  if (!tokenClient) initTokenClient();
  tokenClient.requestAccessToken({ prompt: "consent" });
});

signoutBtn.addEventListener("click", () => {
  if (accessToken) {
    fetch(`https://oauth2.googleapis.com/revoke?token=${accessToken}`, { method: "POST" }).catch(() => {});
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
async function onSignInSuccess() {
  authSection.classList.add("hidden");
  uploadSection.classList.remove("hidden");
  feedSection.classList.remove("hidden");
  signedArea.classList.remove("hidden");

  try {
    const info = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (info.ok) {
      const tokenInfo = await info.json();
      userEmailSpan.textContent = tokenInfo.email || tokenInfo.sub || "(signed in)";
    } else {
      console.warn("userinfo fetch failed", info.status);
      userEmailSpan.textContent = "(signed in)";
    }
  } catch {
    userEmailSpan.textContent = "(signed in)";
  }

  abideFolderId = await ensureAbideFolder();
  await refreshFeed();
}

/* ---------- Drive helpers ---------- */
async function driveFetch(path, method = "GET", body = null, headers = {}) {
  await ensureAccessToken();
  const res = await fetch(`https://www.googleapis.com/drive/v3${path}`, {
    method,
    headers: { Authorization: `Bearer ${accessToken}`, ...headers },
    body,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function ensureAbideFolder() {
  await ensureAccessToken();
  const q = encodeURIComponent(
    "name = 'abide' and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
  );
  const res = await driveFetch(`/files?q=${q}&spaces=drive&fields=files(id,name)`);
  if (res.files?.length) return res.files[0].id;

  const create = await driveFetch(
    "/files",
    "POST",
    JSON.stringify({ name: "abide", mimeType: "application/vnd.google-apps.folder" }),
    { "Content-Type": "application/json" }
  );
  return create.id;
}

/* ---------- Upload ---------- */
uploadBtn.addEventListener("click", async () => {
  const file = fileInput.files[0];
  if (!file) return alert("Pick a video file first");

  uploadStatus.textContent = "Uploading...";
  try {
    const fileId = await uploadFileToAbide(file);
    if (publicCheckbox.checked) await makeFilePublic(fileId);

    const tags = (tagsInput.value || "").trim();
    if (tags) {
      await updateFileMetadata(fileId, {
        description: JSON.stringify({ tags: tags.split(",").map((t) => t.trim()) }),
      });
    }
    uploadStatus.textContent = "Upload complete ✨";
    fileInput.value = "";
    tagsInput.value = "";
    await refreshFeed();
  } catch (err) {
    console.error(err);
    uploadStatus.textContent = "Upload failed: " + err.message;
  }
});

async function uploadFileToAbide(file) {
  await ensureAccessToken();
  const metadata = {
    name: file.name,
    mimeType: file.type || "video/mp4",
    parents: [abideFolderId],
  };
  const form = new FormData();
  form.append(
    "metadata",
    new Blob([JSON.stringify(metadata)], { type: "application/json" })
  );
  form.append("file", file);
  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      body: form,
    }
  );
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()).id;
}

async function updateFileMetadata(fileId, meta) {
  await ensureAccessToken();
  return driveFetch(`/files/${fileId}?fields=id,description`, "PATCH", JSON.stringify(meta), {
    "Content-Type": "application/json",
  });
}

async function makeFilePublic(fileId) {
  await ensureAccessToken();
  return driveFetch(`/files/${fileId}/permissions`, "POST", JSON.stringify({ role: "reader", type: "anyone" }), {
    "Content-Type": "application/json",
  });
}

/* ---------- Feed ---------- */
async function listAbideVideos() {
  await ensureAccessToken();
  const q = encodeURIComponent(
    `'${abideFolderId}' in parents and mimeType contains 'video/' and trashed = false`
  );
  const url = `/files?q=${q}&spaces=drive&fields=files(id,name,description,webViewLink,owners)&orderBy=createdTime desc&pageSize=100`;
  const res = await driveFetch(url);
  return res.files || [];
}

async function refreshFeed(filterTag = null) {
  try {
    videoFeed.innerHTML = "";
    const files = await listAbideVideos();

    const items = files.map((f) => {
      let tags = [];
      try {
        if (f.description) {
          const parsed = JSON.parse(f.description);
          if (parsed?.tags) tags = parsed.tags;
        }
      } catch {}
      const streamUrl = `https://drive.google.com/uc?export=preview&id=${f.id}`;
      return { id: f.id, name: f.name, streamUrl, tags };
    });

    const filtered = filterTag
      ? items.filter((it) =>
          it.tags.some((tag) => tag.toLowerCase().includes(filterTag.toLowerCase()))
        )
      : items;

    if (!filtered.length) {
      videoFeed.innerHTML =
        `<div class="video-card"><div class="muted">No videos found in your /abide/ folder yet.</div></div>`;
      return;
    }

    filtered.sort(() => Math.random() - 0.5);
    filtered.forEach((it) => {
      const card = document.createElement("div");
      card.className = "video-card";
      const vid = document.createElement("iframe");
      vid.src = it.streamUrl;
      vid.allow = "autoplay; encrypted-media";
      vid.className = "video-frame";
      const meta = document.createElement("div");
      meta.className = "video-meta";
      meta.innerHTML = `<div>${it.name}</div><div class="muted">${it.tags.join(" ")}</div>`;
      card.appendChild(vid);
      card.appendChild(meta);
      videoFeed.appendChild(card);
    });
  } catch (err) {
    console.error(err);
    videoFeed.innerHTML = `<div class="video-card"><div class="muted">Failed to load videos: ${err.message}</div></div>`;
  }
}

/* ---------- Filters ---------- */
applyFilterBtn.addEventListener("click", () => {
  const tag = filterTagInput.value.trim();
  refreshFeed(tag || null);
});
clearFilterBtn.addEventListener("click", () => {
  filterTagInput.value = "";
  refreshFeed(null);
});

/* ---------- Init ---------- */
window.addEventListener("load", () => {
  if (CLIENT_ID.includes("PLACEHOLDER")) {
    console.warn("Replace CLIENT_ID with your actual OAuth Client ID");
  }
  initTokenClient();
});
