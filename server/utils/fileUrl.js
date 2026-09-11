const path = require("path");
const fs = require("fs");

const UPLOADS_ROOT = path.join(__dirname, "../uploads");

// Builds a public, absolute URL for a file that multer just saved to disk.
// Uses SERVER_BASE_URL if set (recommended for production, especially
// behind a reverse proxy), otherwise falls back to the incoming request's
// own protocol + host.
const toPublicUrl = (req, absolutePath) => {
  if (!absolutePath) return null;
  const rel = path.relative(UPLOADS_ROOT, absolutePath).split(path.sep).join("/");
  const base = (process.env.SERVER_BASE_URL || `${req.protocol}://${req.get("host")}`).replace(/\/+$/, "");
  return `${base}/uploads/${rel}`;
};

// Express middleware — run this right after any multer upload middleware.
// Rewrites req.file.path / req.files[].path (single, array, or fields form)
// from an absolute filesystem path into a public URL, so controllers can
// keep doing `req.file.path` / `f.path` unchanged and just store it.
const rewriteUploadPaths = (req, res, next) => {
  if (req.file) {
    req.file.path = toPublicUrl(req, req.file.path);
  }
  if (req.files) {
    if (Array.isArray(req.files)) {
      req.files.forEach((f) => { f.path = toPublicUrl(req, f.path); });
    } else {
      Object.values(req.files).forEach((arr) => {
        arr.forEach((f) => { f.path = toPublicUrl(req, f.path); });
      });
    }
  }
  next();
};

// Deletes a locally-stored upload given its public URL (e.g. when replacing
// or removing a profile pic / logo / attachment). Silently no-ops for
// anything that isn't one of our own /uploads/ URLs.
const deleteLocalFile = (url) => {
  try {
    if (!url) return;
    const marker = "/uploads/";
    const idx = url.indexOf(marker);
    if (idx === -1) return;
    const rel = url.substring(idx + marker.length);
    const absolutePath = path.join(UPLOADS_ROOT, rel);
    // Guard against path traversal outside the uploads root.
    if (!absolutePath.startsWith(UPLOADS_ROOT)) return;
    if (fs.existsSync(absolutePath)) {
      fs.unlinkSync(absolutePath);
    }
  } catch (err) {
    console.error("Failed to delete local upload:", err.message);
  }
};

module.exports = { toPublicUrl, rewriteUploadPaths, deleteLocalFile, UPLOADS_ROOT };
