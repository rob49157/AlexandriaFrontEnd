// Register the decryption Lit Action and permit its CID against the PKP.
//
//   npm run lit:register            — show the CID, change nothing
//   npm run lit:register -- --register
//
// Registration is deliberately opt-in. Deriving the CID is a free read; adding
// an action and attaching it to a group are metered writes against the account's
// credits, so a bare run tells you what WOULD be registered and stops.
//
// Why this has to run at all: the browser sends the Action source to Lit, which
// hashes it to an IPFS CID. Lit.Actions.Decrypt only works for a CID the PKP has
// permitted — that is precisely what stops an attacker from submitting their own
// Action with the access checks removed. Edit the Action, and its CID changes,
// and the new one must be permitted before any reader can decrypt again.
//
// A previously permitted CID is left alone. An older Action grants strictly less
// than this one, so during a rollout an older frontend keeps working. Remove it
// from the group once no old clients remain — and remove it immediately if an
// edit ever leaves the older Action MORE permissive than the new one.
//
// Credentials come from .env via `node --env-file` (see package.json). LIT_API_KEY
// has no VITE_ prefix on purpose: Vite only exposes VITE_* to the bundle, so this
// admin key stays out of the shipped app.

import { LIT_DECRYPT_ACTION_CODE } from '../src/services/litAction.js';

const LIT_API_URL =
  process.env.LIT_API_URL || process.env.VITE_LIT_API_URL || 'https://api.chipotle.litprotocol.com/core/v1';
const LIT_API_KEY = process.env.LIT_API_KEY;
const GROUP_ID = Number(process.env.LIT_GROUP_ID || 1);

const SHOULD_REGISTER = process.argv.includes('--register');

async function api(endpoint, body, method = 'POST') {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': LIT_API_KEY },
  };
  if (body && method !== 'GET') opts.body = JSON.stringify(body);

  const res = await fetch(LIT_API_URL + endpoint, opts);
  const text = await res.text();
  console.log(`  ${endpoint} -> ${res.status}: ${text}`);

  if (!res.ok) throw new Error(`${endpoint} failed with ${res.status}`);
  return text;
}

async function main() {
  if (!LIT_API_KEY) {
    console.error('LIT_API_KEY is not set. Add it to .env (no VITE_ prefix — it must not reach the bundle).');
    process.exit(1);
  }

  console.log(`Decryption Action source: ${LIT_DECRYPT_ACTION_CODE.length} bytes\n`);

  console.log('1. Derive IPFS CID (free, read-only)...');
  const cid = JSON.parse(await api('/get_lit_action_ipfs_id', LIT_DECRYPT_ACTION_CODE));
  console.log(`   CID: ${cid}`);

  if (!SHOULD_REGISTER) {
    console.log('\nDry run — nothing was registered.');
    console.log('Re-run with --register to permit this CID against the PKP.');
    return;
  }

  console.log('\n2. Register action...');
  await api('/add_action', {
    action_ipfs_cid: cid,
    name: 'alexandria-decrypt',
    description:
      'Releases the AES key for an Alexandria book to an active renter, the uploader, ' +
      'or a librarian reviewing it inside its challenge window.',
  });

  console.log(`\n3. Add action to group ${GROUP_ID}...`);
  await api('/add_action_to_group', { group_id: GROUP_ID, action_ipfs_cid: cid });

  // KEY-BINDING.md asks for this list to be enumerated after every change: a
  // stray permissive Action left over from testing defeats every check above.
  console.log('\n4. Permitted actions — read this list, do not skip it...');
  await api('/list_actions?page_number=0&page_size=100', null, 'GET');

  console.log('\nRegistered. Every entry above should be one you recognise.');
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
