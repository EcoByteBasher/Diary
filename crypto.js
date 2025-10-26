/** ---------- Web Crypto helpers (AES-GCM + PBKDF2) ---------- **/

// utils
function rndBytes(n) { const b = new Uint8Array(n); crypto.getRandomValues(b); return b; }
function bufToB64(buf) { return btoa(String.fromCharCode(...new Uint8Array(buf))); }
function b64ToBuf(b64) { const s = atob(b64); const u = new Uint8Array(s.length); for (let i=0;i<s.length;i++) u[i]=s.charCodeAt(i); return u.buffer; }
function strToBuf(s){ return new TextEncoder().encode(s); }
function bufToStr(b){ return new TextDecoder().decode(b); }

// Derive an AES-GCM 256 key from password using PBKDF2
// iterations: choose high enough to be slow on attack, but acceptable UX. (200000 shown here.)
async function deriveKeyFromPassword(password, saltBytes, iterations = 200000) {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    strToBuf(password),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );
  const key = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: saltBytes,
      iterations: iterations,
      hash: "SHA-256"
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt","decrypt"]
  );
  return key;
}

// Encrypt plaintext string -> JSON string containing salt, iv, ciphertext (base64)
export async function encryptText(plaintext, password) {
  const salt = rndBytes(16);       // 16 bytes salt
  const iv = rndBytes(12);         // 12 bytes IV for AES-GCM
  const key = await deriveKeyFromPassword(password, salt, 200000);

  const ctBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    strToBuf(plaintext)
  );

  const pkg = {
    v: 1,
    kdf: "PBKDF2",
    kdf_iter: 200000,
    salt: bufToB64(salt.buffer),
    iv: bufToB64(iv.buffer),
    ct: bufToB64(ctBuf)
  };
  return JSON.stringify(pkg);
}

// Decrypt package JSON (string or object) -> plaintext string
export async function decryptPackage(pkgJsonOrObj, password) {
  const pkg = (typeof pkgJsonOrObj === "string") ? JSON.parse(pkgJsonOrObj) : pkgJsonOrObj;
  if (!pkg || pkg.v !== 1) throw new Error("Unsupported package version");
  if (!pkg.salt || !pkg.iv || !pkg.ct) throw new Error("Malformed package");

  const saltBuf = b64ToBuf(pkg.salt);
  const ivBuf = b64ToBuf(pkg.iv);
  const ctBuf = b64ToBuf(pkg.ct);
  const iterations = pkg.kdf_iter || 200000;

  const key = await deriveKeyFromPassword(password, new Uint8Array(saltBuf), iterations);

  let plainBuf;
  try {
    plainBuf = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: new Uint8Array(ivBuf) },
      key,
      ctBuf
    );
  } catch (err) {
    // likely authentication / wrong password
    throw new Error("Decryption failed (wrong passphrase or corrupted data)");
  }

  return bufToStr(plainBuf);
}

