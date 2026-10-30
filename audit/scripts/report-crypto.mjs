// Encrypts and decrypts report data so ciphertext can live in this public
// repository while the key lives only in the Pages build environment.
//
//   node scripts/report-crypto.mjs keygen
//   REPORT_DATA_KEY=... node scripts/report-crypto.mjs encrypt src/data/private/<slug>.json
//   REPORT_DATA_KEY=... node scripts/report-crypto.mjs decrypt   (all of src/data/encrypted, used by render)
//
// AES-256-GCM, random 96-bit nonce per file, key is 32 bytes base64.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { resolve, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const encDir = resolve(root, 'src/data/encrypted');
const privDir = resolve(root, 'src/data/private');

function key() {
  const k = process.env.REPORT_DATA_KEY;
  if (!k) throw new Error('REPORT_DATA_KEY is not set');
  const buf = Buffer.from(k, 'base64');
  if (buf.length !== 32) throw new Error('REPORT_DATA_KEY must be 32 bytes, base64');
  return buf;
}

export function encryptFile(path) {
  const plain = readFileSync(path);
  JSON.parse(plain.toString('utf8')); // must be valid report JSON
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(plain), cipher.final()]);
  const out = { v: 1, alg: 'aes-256-gcm', iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
  mkdirSync(encDir, { recursive: true });
  const target = resolve(encDir, basename(path) + '.enc');
  writeFileSync(target, JSON.stringify(out));
  return target;
}

export function decryptAll() {
  if (!existsSync(encDir)) return 0;
  const k = key();
  mkdirSync(privDir, { recursive: true });
  let n = 0;
  for (const f of readdirSync(encDir)) {
    if (!f.endsWith('.json.enc')) continue;
    const env = JSON.parse(readFileSync(resolve(encDir, f), 'utf8'));
    const decipher = createDecipheriv('aes-256-gcm', k, Buffer.from(env.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(env.tag, 'base64'));
    const plain = Buffer.concat([decipher.update(Buffer.from(env.data, 'base64')), decipher.final()]);
    writeFileSync(resolve(privDir, f.replace(/\.enc$/, '')), plain);
    n++;
  }
  return n;
}

const [, , cmd, ...args] = process.argv;
if (import.meta.url === `file://${process.argv[1]}`) {
  if (cmd === 'keygen') console.log(randomBytes(32).toString('base64'));
  else if (cmd === 'encrypt') for (const a of args) console.log('encrypted', encryptFile(resolve(a)));
  else if (cmd === 'decrypt') console.log('decrypted', decryptAll(), 'report(s)');
  else { console.error('usage: keygen | encrypt <file...> | decrypt'); process.exit(1); }
}
