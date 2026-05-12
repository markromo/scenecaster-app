#!/usr/bin/env node
const crypto = require('crypto')
const { argv } = require('process')
const LICENSE_SECRET = '625e52515fb8f1ed9fcf73c801c9fa2c67c0c2f1fed30384dde29d378a96c4b3'
function getArg(flag) { const i = argv.indexOf(flag); return i !== -1 ? argv[i + 1] : null }
const showName = getArg('--show'), expiryDate = getArg('--expiry'), packId = getArg('--pack'), storeUrl = getArg('--store') || 'https://your-store.com'
if (!showName || !expiryDate || !packId) { console.error('Usage: node scripts/generate-key.js --show "Name" --expiry YYYY-MM-DD --pack "id"'); process.exit(1) }
function base64url(obj) { return Buffer.from(JSON.stringify(obj)).toString('base64url') }
const header = base64url({ alg: 'HS256', typ: 'JWT' })
const payload = base64url({ showName, packId, expiryDate, storeUrl, issuedAt: new Date().toISOString() })
const sig = crypto.createHmac('sha256', LICENSE_SECRET).update(`${header}.${payload}`).digest('base64url')
console.log(`\nSHOWRUNNER LICENSE KEY\nShow: ${showName} | Expires: ${expiryDate}\n\n${header}.${payload}.${sig}\n`)
