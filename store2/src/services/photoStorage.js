const crypto = require("crypto");
const path = require("path");
const { getStorage, getDownloadURL } = require("firebase-admin/storage");

const MAX_PHOTO_BYTES = 650 * 1024;
const DEFAULT_PHOTO =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='700' height='700' viewBox='0 0 700 700'%3E%3Crect width='700' height='700' fill='%23f6f0e8'/%3E%3Crect x='95' y='95' width='510' height='510' rx='36' fill='%23ffffff' stroke='%23d8c8b7' stroke-width='8'/%3E%3Cpath d='M230 405l74-86 58 64 47-52 76 74H230z' fill='%23d8c8b7'/%3E%3Ccircle cx='445' cy='265' r='38' fill='%23c79a5b'/%3E%3Ctext x='350' y='535' text-anchor='middle' font-family='Arial, Helvetica, sans-serif' font-size='46' font-weight='700' fill='%2370472c'%3EUpload image%3C/text%3E%3C/svg%3E";

function httpError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function storageSetupError(err) {
  if (err?.code !== 404 || !/bucket does not exist/i.test(String(err.message || ""))) {
    return err;
  }
  return httpError(
    "Firebase Storage bucket is not created yet. In Firebase Console, go to Storage, click Get started, create the default bucket, then retry photo migration.",
    400
  );
}

function extensionForContentType(contentType) {
  const known = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
  };
  return known[contentType] || "img";
}

function decodePhotoDataUrl(input) {
  const photo = String(input || "").trim();
  if (!photo) return null;
  const match = photo.match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i);
  if (!match) throw httpError("Photo must be a base64 image data URL.");

  const contentType = match[1].toLowerCase();
  const buffer = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  if (!buffer.length) throw httpError("Photo is empty.");
  if (buffer.length > MAX_PHOTO_BYTES) throw httpError("Image must be 650 KB or smaller.");
  return { buffer, contentType };
}

function filePhotoInput(file) {
  if (!file) return null;
  if (!String(file.mimetype || "").startsWith("image/")) {
    throw httpError("Photo must be an image file.");
  }
  if (file.size > MAX_PHOTO_BYTES) throw httpError("Image must be 650 KB or smaller.");
  return { buffer: file.buffer, contentType: file.mimetype };
}

function cleanPhotoUrl(input) {
  const photo = String(input || "").trim();
  if (!photo) return null;
  let url;
  try {
    url = new URL(photo);
  } catch {
    throw httpError("Photo URL must be a valid URL.");
  }
  if (!["https:", "http:"].includes(url.protocol)) {
    throw httpError("Photo URL must use http or https.");
  }
  return url.toString();
}

function storagePath(storeId, itemId, contentType) {
  const ext = extensionForContentType(contentType);
  const nonce = crypto.randomBytes(8).toString("hex");
  return path.posix.join("item-photos", storeId, itemId, `${Date.now()}-${nonce}.${ext}`);
}

async function uploadItemPhoto({ storeId, itemId, buffer, contentType }) {
  if (!buffer || !contentType) return null;
  const file = getStorage().bucket().file(storagePath(storeId, itemId, contentType));
  try {
    await file.save(buffer, {
      resumable: false,
      metadata: {
        contentType,
        cacheControl: "public, max-age=31536000",
      },
    });
    return {
      photo: await getDownloadURL(file),
      photoStoragePath: file.name,
    };
  } catch (err) {
    throw storageSetupError(err);
  }
}

function preparePhotoInput({ file, photoDataUrl, photoUrl } = {}) {
  const fileInput = filePhotoInput(file);
  if (fileInput) return { upload: fileInput };

  const dataUrlInput = decodePhotoDataUrl(photoDataUrl);
  if (dataUrlInput) return { upload: dataUrlInput };

  const url = cleanPhotoUrl(photoUrl);
  return url ? { fields: { photo: url, photoStoragePath: null } } : null;
}

async function uploadPhotoInput({ storeId, itemId, file, photoDataUrl, photoUrl }) {
  const input = preparePhotoInput({ file, photoDataUrl, photoUrl });
  if (input?.upload) return uploadItemPhoto({ storeId, itemId, ...input.upload });
  return input?.fields || null;
}

async function deleteStoredPhoto(item) {
  if (!item?.photoStoragePath) return;
  await getStorage().bucket().file(item.photoStoragePath).delete({ ignoreNotFound: true });
}

module.exports = {
  DEFAULT_PHOTO,
  MAX_PHOTO_BYTES,
  decodePhotoDataUrl,
  preparePhotoInput,
  uploadItemPhoto,
  uploadPhotoInput,
  deleteStoredPhoto,
};
