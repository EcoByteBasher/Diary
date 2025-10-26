#!/usr/bin/env node
/**
 * batch_encrypt.js
 *
 * Usage:
 *   node batch_encrypt.js /path/to/diaries
 *
 * This script reads all .txt files in the target folder, encrypts each with
 * a passphrase-derived key (PBKDF2 -> AES-GCM), writes out filename.txt.enc,
 * and produces/updates manifest.json listing the .enc files.
 *
 * The produced JSON package format is compatible with the browser decryptPackage() function.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Use WebCrypto Subtle if available (Node 16+: globalThis.crypto.subtle or require('crypto').webcrypto)
const subtle = (globalThis.crypto && globalThis.crypto.subtle) ? globalThis.crypto.subtle
  : (require('crypto').webcrypto && require('crypto').webcrypto.subtle)
    ? require('crypto').webcrypto.subtle
    : null;

if (!subtle) {
  console.error("ERROR: WebCrypto Subtle API not available. Use Node 16+ or 18+.");
  process.exit(1);
}

// Helpers
function bufToB64(buf) {
  return Buffer.from(buf).toString('base64');
}
function b64ToBuf(b64) {
  return Buffer.from(b64, 'base64');
}
function strToUint8(s) {
  return new TextEncoder().encode(s);
}
function uint8ToStr(u8) {
  return new TextDecoder().decode(u8);
}
function randomBytes(n) {
  return cryptoGetRandomValues(new Uint8Array(n));
}
function cryptoGetRandomValues(u8) {
  // Using globalThis.crypto.getRandomValues when available
  if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') {
    return globalThis.crypto.getRandomValues(u8);
  }
  // Fallback to Node Buffer (shouldn't be needed with webcrypto present)
  return Uint8Array.from(require('crypto').randomBytes(u8.length));
}

// Prompt for passphrase without echo
async function promptHidden(promptText) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const stdin = process.stdin;
    process.stdout.write(promptText);

    // put stdin into raw mode so we can capture each char without echo
    stdin.setRawMode(true);
    stdin.resume();

    let value = '';
    stdin.on('data', onData);

    function onData(charBuf) {
      const char = String(charBuf);

      if (char === '\u0003') { // ctrl-c
        stdin.setRawMode(false);
        rl.close();
        process.stdout.write('\n');
        process.exit(1);
      } else if (char === '\r' || char === '\n') { // enter
        stdin.removeListener('data', onData);
        stdin.setRawMode(false);
        stdin.pause();
        rl.close();
        process.stdout.write('\n');
        resolve(value);
      } else if (char === '\u0008' || char === '\u007f') { // backspace
        if (value.length > 0) {
          value = value.slice(0, -1);
        }
      } else {
        // append char
        value += char;
      }
    }
  });
}

// Derive AES-GCM 256 key from passphrase using PBKDF2
async function deriveKeyFromPasswordNode(password, saltBytes, iterations = ITERATIONS) {
  // import raw password
  const baseKey = await subtle.importKey(
    'raw',
    strToUint8(password),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  const key = await subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: iterations,
      hash: 'SHA-256'
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
  return key;
}

// Encrypt plaintext -> JSON package string
async function encryptTextNode(plaintext, password, iterations = ITERATIONS) {
  const salt = randomBytes(16); // 16 bytes salt
  const iv = randomBytes(12);   // 12 bytes IV for AES-GCM
  const key = await deriveKeyFromPasswordNode(password, salt, iterations);

  const encBuf = await subtle.encrypt(
    { name: 'AES-GCM', iv: iv },
    key,
    strToUint8(plaintext)
  );

  const pkg = {
    v: 1,
    kdf: "PBKDF2",
    kdf_iter: iterations,
    salt: bufToB64(salt.buffer),
    iv: bufToB64(iv.buffer),
    ct: bufToB64(encBuf)
  };
  return JSON.stringify(pkg);
}

// Main
(async () => {
  try {
    const targetDir = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve('./diaries');
    if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
      console.error(`Directory not found: ${targetDir}`);
      process.exit(1);
    }

    console.log(`Encrypting .txt files in: ${targetDir}`);

    // Read .txt files
    const allFiles = fs.readdirSync(targetDir);
    const txtFiles = allFiles.filter(f => f.toLowerCase().endsWith('.txt'));
    if (txtFiles.length === 0) {
      console.log("No .txt files found. Nothing to do.");
      process.exit(0);
    }

    // Prompt passphrase twice to confirm
    const pass1 = await promptHidden("Enter passphrase to encrypt diaries: ");
    const pass2 = await promptHidden("Confirm passphrase: ");
    if (pass1 !== pass2) {
      console.error("Passphrases do not match. Aborting.");
      process.exit(1);
    }
    const passphrase = pass1;

    // iterations (tunable)
    const ITERATIONS = 1000000; // min recommended is 600,000

    // For each .txt, create .txt.enc unless exists (prompt to overwrite)
    const encNames = [];
    for (const fname of txtFiles) {
      const infile = path.join(targetDir, fname);
      const outname = fname + '.enc';
      const outfile = path.join(targetDir, outname);

      // Read plaintext
      const plain = fs.readFileSync(infile, 'utf8');

      // Encrypt
      process.stdout.write(`Encrypting ${fname} ... `);
      const pkg = await encryptTextNode(plain, passphrase, ITERATIONS);
      fs.writeFileSync(outfile, pkg, { encoding: 'utf8', flag: 'w' });
      encNames.push(outname);
      console.log('done ->', outname);
    }

    // Write manifest.json (overwrites existing)
    const manifest = { files: encNames.sort() };
    const manifestPath = path.join(targetDir, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    console.log(`Wrote manifest with ${encNames.length} files: ${manifestPath}`);

    console.log("Encryption complete. Upload the .enc files and manifest.json to your remote host (GitHub Pages).");
    console.log("IMPORTANT: Keep your passphrase safe. Losing it means losing access to your diaries.");

  } catch (err) {
    console.error("Fatal error:", err);
    process.exit(1);
  }
})();

