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
} else {
  // gpg accepts emails, short ids, full fingerprints and 0x-prefixed hex as
  // key selectors — any of those is fine as long as it is set. A hex
  // fingerprint that does NOT match the documented key gets a hard warning
  // (the signatures would be unverifiable by users), but an email selector
  // is a legitimate way to name the key and must not fail the gate.
  const value = process.env.GPG_KEY_ID.trim();
  // A value that is (almost) entirely hex digits after stripping separators
  // is a fingerprint; warn (never fail) when it misses the documented key.
  // Emails ("code@rosie.run"), short ids and 0x-prefixed ids are legitimate
  // selectors and must not trip the fingerprint check.
  const stripped = value.replace(/[^0-9A-Fa-f]/g, "");
  const remainder = value.replace(/[0-9A-Fa-f]/g, "");
  const isFingerprintLike =
    stripped.length >= 8 &&
    /^[@./\s:_-]*$/.test(remainder);
  if (isFingerprintLike && !/F2FBC20F/i.test(stripped)) {
    console.warn(
      `⚠ GPG_KEY_ID ${value} does not contain the documented signing key fingerprint (0xF2FBC20F) — ` +
        "verify this is intentional, or users will not be able to verify the .asc signatures.",
    );
  }
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
