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
// The key is typed at a hidden prompt and held only in memory. Registering needs
// the account key (or a usage key that can manage the decrypt group), and a key
// that powerful must never sit in a file: .env files get committed (KEY-BINDING.md
// F7). The dry run needs no key at all, because deriving a CID is unauthenticated.

import { keccak256, toUtf8Bytes } from 'ethers';
import { LIT_DECRYPT_ACTION_CODE } from '../src/services/litAction.js';

const LIT_API_URL =
  process.env.LIT_API_URL || process.env.VITE_LIT_API_URL || 'https://api.chipotle.litprotocol.com/core/v1';
// No default. Group 1 holds the encrypt Action; the decrypt Action belongs in its
// own group (KEY-BINDING.md, steps C/D), and defaulting to 1 is how it would end
// up beside a stray permissive entry.
const GROUP_ID = Number(process.env.LIT_GROUP_ID);

const SHOULD_REGISTER = process.argv.includes('--register');

let apiKey = '';
const redact = (text) => (apiKey ? String(text).split(apiKey).join('<REDACTED>') : String(text));

function promptHidden(question) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      console.error('No interactive terminal: run this in your own terminal so the key can be typed.');
      process.exit(1);
    }
    process.stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';
    const onData = (chunk) => {
      for (const c of chunk) {
        if (c === '\r' || c === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          process.stdout.write('\n');
          resolve(value.trim());
          return;
        }
        if (c === '\u0003') process.exit(130);
        if (c === '\u007f' || c === '\b') value = value.slice(0, -1);
        else value += c;
      }
    };
    stdin.on('data', onData);
  });
}

async function api(endpoint, body, method = 'POST') {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (apiKey) opts.headers['X-Api-Key'] = apiKey;
  if (body && method !== 'GET') opts.body = JSON.stringify(body);

  const res = await fetch(LIT_API_URL + endpoint, opts);
  const text = await res.text();
  console.log(`  ${endpoint} -> ${res.status}: ${redact(text)}`);

  if (!res.ok) throw new Error(`${endpoint} failed with ${res.status}`);
  return text;
}

// A GET that prints nothing, for the key check below: its listings are long.
async function read(endpoint) {
  const res = await fetch(LIT_API_URL + endpoint, { headers: { 'X-Api-Key': apiKey } });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // left null; the caller reports the status
  }
  return { status: res.status, json };
}

// Lit answers a usage key's management write with a bare 403 "Permission denied",
// which reads like a broken account. So name the key first, with free reads only.
// Lit stores usage keys by keccak256 of the key and lists those hashes to any key
// on the account, so hashing what was typed identifies it without printing it.
// The account key is the one key that is not in that list.
// Returns a reason to stop, or null to go ahead.
async function checkKey() {
  const exists = await read('/account_exists');
  if (exists.json !== true) {
    return 'Lit does not recognise that key: mistyped, or not a Lit key.';
  }
  const groups = await read('/list_groups?page_number=0&page_size=100');
  const keys = await read('/list_api_keys?page_number=0&page_size=100');
  if (!Array.isArray(groups.json) || !Array.isArray(keys.json)) {
    return `Could not read the account (list_groups ${groups.status}, list_api_keys ${keys.status}).`;
  }

  const group = groups.json.find((g) => BigInt(g.id) === BigInt(GROUP_ID));
  if (!group) {
    const names = groups.json.map((g) => `${BigInt(g.id)} "${g.name}"`).join(', ') || 'none';
    return `This key's account has no group ${GROUP_ID}, so it is a different Lit account. Its groups: ${names}.`;
  }
  console.log(`   Group ${GROUP_ID} on this key's account: "${group.name}"`);

  const hash = keccak256(toUtf8Bytes(apiKey)).toLowerCase();
  const usage = keys.json.find((k) => String(k.api_key_hash).toLowerCase() === hash);
  if (!usage) {
    console.log('   Key: the account key.');
    return null;
  }
  const manages = (usage.can_manage_ipfs_ids_in_groups || []).map(Number);
  if (!manages.includes(GROUP_ID)) {
    return (
      `That is the usage key "${usage.name}", which cannot add Actions to group ${GROUP_ID}; Lit would\n` +
      'answer 403 "Permission denied". Use the account key: the one Lit showed once when the\n' +
      'account was created. Neither key in AlexNode/.env can do this, by design.'
    );
  }
  console.log(`   Key: usage key "${usage.name}", which can manage group ${GROUP_ID}.`);
  return null;
}

async function main() {
  if (process.env.LIT_API_KEY) {
    console.error('LIT_API_KEY is set, probably in .env. Remove it: this script asks for the key at a');
    console.error('hidden prompt, so a key that can manage Lit groups is never written to a file.');
    process.exit(1);
  }

  console.log(`Decryption Action source: ${LIT_DECRYPT_ACTION_CODE.length} bytes\n`);

  console.log('1. Derive IPFS CID (free, read-only, no key needed)...');
  const cid = JSON.parse(await api('/get_lit_action_ipfs_id', LIT_DECRYPT_ACTION_CODE));
  console.log(`   CID: ${cid}`);

  console.log(`   The backend relay only forwards this exact code: set LIT_DECRYPT_ACTION_CID=${cid}`);
  console.log('   in AlexNode/.env once it is registered.');

  if (!SHOULD_REGISTER) {
    console.log('\nDry run — nothing was registered.');
    console.log('Re-run with --register to permit this CID in the decrypt group.');
    return;
  }

  if (!Number.isInteger(GROUP_ID) || GROUP_ID < 1) {
    console.error('\nLIT_GROUP_ID is not set. Set it to the "Alexandria decrypt" group id.');
    process.exit(1);
  }
  if (GROUP_ID === 1) {
    console.error('\nRefusing group 1: it is the encryption group. The decrypt Action needs its own group');
    console.error('(KEY-BINDING.md, steps C/D and R6).');
    process.exit(1);
  }

  apiKey = await promptHidden('\nLit account key, or a usage key that can manage this group (hidden): ');
  if (!apiKey) {
    console.error('No key entered.');
    process.exit(1);
  }

  console.log('\n2. Check the key (free reads, nothing is changed)...');
  const problem = await checkKey();
  if (problem) {
    console.error(`\n${problem}\nNothing was changed.`);
    process.exit(1);
  }

  console.log('\n3. Register action...');
  await api('/add_action', {
    action_ipfs_cid: cid,
    name: 'alexandria-decrypt',
    description:
      'Releases the AES key for an Alexandria book to an active renter, the uploader, ' +
      'or a librarian reviewing it inside its challenge window.',
  });

  console.log(`\n4. Add action to group ${GROUP_ID}...`);
  await api('/add_action_to_group', { group_id: GROUP_ID, action_ipfs_cid: cid });

  // KEY-BINDING.md asks for this list to be enumerated after every change: a
  // stray permissive Action left over from testing defeats every check above.
  console.log(`\n5. What group ${GROUP_ID} permits — read both lists, do not skip them...`);
  await api(`/list_actions?group_id=${GROUP_ID}&page_number=0&page_size=100`, null, 'GET');
  await api(`/list_wallets_in_group?group_id=${GROUP_ID}&page_number=0&page_size=100`, null, 'GET');

  console.log('\nRegistered. The group should hold this CID and our PKP, and nothing else:');
  console.log('no "Any" action, no 0x000… wallet, no leftover test actions.');
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
