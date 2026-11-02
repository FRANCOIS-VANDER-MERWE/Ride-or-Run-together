#!/usr/bin/env node
// scripts/mint-apple-token.mjs
// Mints an ES256 Apple MusicKit Developer Token JWT from your Apple `.p8` private key
// and writes `EXPO_PUBLIC_APPLE_MUSICKIT_DEVELOPER_TOKEN` to `.env`.
//
// Usage:
//   npm run mint:apple-token -- --key /path/to/AuthKey_XXXXXXXXXX.p8 --team YOUR_TEAM_ID [--kid XXXXXXXXXX]

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--key' || arg === '-k') out.keyPath = argv[++i];
    else if (arg === '--team' || arg === '-t') out.teamId = argv[++i];
    else if (arg === '--kid' || arg === '-i') out.keyId = argv[++i];
    else if (arg === '--days' || arg === '-d') out.days = Number(argv[++i]);
    else if (!arg.startsWith('-') && arg.endsWith('.p8')) out.keyPath = arg;
  }
  return out;
}

function base64UrlEncode(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input, 'utf8');
  return buf
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function autoDiscoverP8File() {
  const searchDirs = [process.cwd(), path.join(os.homedir(), 'Downloads'), path.join(os.homedir(), 'Desktop')];
  for (const dir of searchDirs) {
    try {
      const files = fs.readdirSync(dir);
      const match = files.find((f) => f.endsWith('.p8') && f.startsWith('AuthKey_'));
      if (match) return path.join(dir, match);
      const anyP8 = files.find((f) => f.endsWith('.p8'));
      if (anyP8) return path.join(dir, anyP8);
    } catch {
      // ignore
    }
  }
  return null;
}

const args = parseArgs(process.argv);
const keyPath = args.keyPath || process.env.APPLE_P8_PATH || autoDiscoverP8File();

if (!keyPath || !fs.existsSync(keyPath)) {
  console.error('\n❌ Could not find your .p8 file.');
  console.error('Run:\n  npm run mint:apple-token -- --key /path/to/AuthKey_XXXXXXXXXX.p8 --team YOUR_10_CHAR_TEAM_ID\n');
  process.exit(1);
}

// Auto-extract 10-char Key ID from filename like `AuthKey_ABC1234567.p8`
const basename = path.basename(keyPath);
const kidMatch = basename.match(/AuthKey_([A-Z0-9]{10})\.p8/i);
const keyId = args.keyId || process.env.APPLE_KEY_ID || (kidMatch ? kidMatch[1] : null);
const teamId = args.teamId || process.env.APPLE_TEAM_ID;

if (!keyId) {
  console.error(`\n❌ Could not infer Key ID (kid) from filename "${basename}".`);
  console.error('Please pass --kid YOUR_10_CHAR_KEY_ID:\n  npm run mint:apple-token -- --key "' + keyPath + '" --kid XXXXXXXXXX --team YYYYYYYYYY\n');
  process.exit(1);
}

if (!teamId) {
  console.error(`\n✅ Found .p8 key: ${keyPath} (Key ID: ${keyId})`);
  console.error('❌ Missing your 10-character Apple Developer Team ID (--team).');
  console.error('Find your Team ID in the top-right of https://developer.apple.com/account (under Membership Details) and run:');
  console.error(`\n  npm run mint:apple-token -- --key "${keyPath}" --kid ${keyId} --team YOUR_TEAM_ID\n`);
  process.exit(1);
}

const privateKeyPem = fs.readFileSync(keyPath, 'utf8');
// Backdate iat by 120s so minor local clock skew never causes Apple to reject the token as "issued in the future"
const nowSec = Math.floor(Date.now() / 1000) - 120;
// Max allowed by Apple MusicKit is 6 months (180 days); default to 150 days
const validityDays = Math.min(179, Math.max(1, args.days || 150));
const expSec = nowSec + validityDays * 86400;

const header = {
  alg: 'ES256',
  kid: keyId,
  typ: 'JWT',
};

const payload = {
  iss: teamId,
  iat: nowSec,
  exp: expSec,
};

const signingInput = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}`;

// ES256 JWT requires IEEE P1363 signature encoding (64-byte r||s), not ASN.1 DER
const signature = crypto.sign('sha256', Buffer.from(signingInput, 'utf8'), {
  key: privateKeyPem,
  dsaEncoding: 'ieee-p1363',
});

const jwt = `${signingInput}.${base64UrlEncode(signature)}`;

// Write or update `.env` in project root
const envPath = path.join(process.cwd(), '.env');
const examplePath = path.join(process.cwd(), '.env.example');
let envContent = '';

if (fs.existsSync(envPath)) {
  envContent = fs.readFileSync(envPath, 'utf8');
} else if (fs.existsSync(examplePath)) {
  envContent = fs.readFileSync(examplePath, 'utf8');
}

const envLine = `EXPO_PUBLIC_APPLE_MUSICKIT_DEVELOPER_TOKEN=${jwt}`;
if (envContent.includes('EXPO_PUBLIC_APPLE_MUSICKIT_DEVELOPER_TOKEN=')) {
  envContent = envContent.replace(
    /^EXPO_PUBLIC_APPLE_MUSICKIT_DEVELOPER_TOKEN=.*$/m,
    envLine
  );
} else {
  envContent = `${envContent.trimEnd()}\n${envLine}\n`;
}

fs.writeFileSync(envPath, envContent, 'utf8');

console.log('\n✅ Successfully minted Apple MusicKit ES256 Developer Token!');
console.log(`   • Key file : ${keyPath}`);
console.log(`   • Key ID   : ${keyId}`);
console.log(`   • Team ID  : ${teamId}`);
console.log(`   • Expires  : ${new Date(expSec * 1000).toISOString()} (${validityDays} days)`);
console.log(`   • Saved to : ${envPath} (EXPO_PUBLIC_APPLE_MUSICKIT_DEVELOPER_TOKEN)\n`);

