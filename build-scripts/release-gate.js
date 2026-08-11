#!/usr/bin/env node
/**
 * Release gate: fails the pipeline fast when credentials required for a
 * VERIFIABLE release are missing. Prevents shipping unsigned artifacts with
 * green exits.
 */
require("dotenv").config();

const failures = [];

if (!process.env.GH_TOKEN) {
  failures.push("GH_TOKEN is required to upload release assets and publish the draft.");
}

if (!process.env.GPG_KEY_ID) {
  failures.push("GPG_KEY_ID is required — .asc signatures must come from the documented key, not a random default key.");
} else if (!/F2FBC20F/i.test(process.env.GPG_KEY_ID)) {
  failures.push(`GPG_KEY_ID ${process.env.GPG_KEY_ID} does not match the documented signing key (0xF2FBC20F).`);
}

if (process.platform === "win32" && !process.env.CSC_LINK) {
  failures.push("CSC_LINK is required on Windows — without it the installer is unsigned (Unknown Publisher) and the updater skips signature verification.");
}

if (failures.length > 0) {
  console.error("✗ Release gate failed:");
  for (const f of failures) console.error(`   - ${f}`);
  process.exit(1);
}
console.log("✓ Release gate passed (GH_TOKEN, GPG key, signing config present).");
