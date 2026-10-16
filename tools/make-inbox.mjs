// Versleutelt een Vakwerk-pakket naar inbox/<id>.json (AES-256-GCM).
//   node tools/make-inbox.mjs <pakket.json> <sleutelbestand.json>
// Het sleutelbestand ({ id, key }) wordt aangemaakt als het nog niet bestaat. Bewaar het PRIVÉ
// (bijv. in OneDrive), nooit in deze repo. Print de koppel-link voor de iPad.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { randomBytes, createCipheriv } from 'node:crypto';

const [packPath, keyPath] = process.argv.slice(2);
if (!packPath || !keyPath) { console.error('gebruik: node tools/make-inbox.mjs <pakket.json> <sleutelbestand.json>'); process.exit(1); }
const b64url = buf => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

let k;
if (existsSync(keyPath)) k = JSON.parse(readFileSync(keyPath, 'utf8'));
else { k = { id: b64url(randomBytes(9)), key: b64url(randomBytes(32)) }; writeFileSync(keyPath, JSON.stringify(k, null, 1)); console.log('Nieuwe sleutel aangemaakt:', keyPath); }

const plain = readFileSync(packPath);
JSON.parse(plain); // moet geldige JSON zijn
const iv = randomBytes(12);
const key = Buffer.from(k.key.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const c = createCipheriv('aes-256-gcm', key, iv);
const data = Buffer.concat([c.update(plain), c.final(), c.getAuthTag()]);
const outDir = new URL('../inbox/', import.meta.url);
mkdirSync(outDir, { recursive: true });
writeFileSync(new URL(`${k.id}.json`, outDir), JSON.stringify({ v: 1, alg: 'AES-GCM', iv: b64url(iv), data: b64url(data), updated: new Date().toISOString() }));
console.log(`inbox/${k.id}.json geschreven (${data.length} bytes)`);
console.log(`Koppel-link: https://cihan270.github.io/vakwerk/#/koppel?bron=inbox/${k.id}.json&sleutel=${k.key}`);
