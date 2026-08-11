const path = require('node:path');
// Zephus is not code-signing yet: the Azure Artifact Signing machinery is
// wired up but OPTIONAL. Sign only when every Azure variable is present
// (or SKIP_WIN_CODESIGN=1 forces unsigned); otherwise produce unsigned
// artifacts with a clear warning instead of failing the build.
const skipWindowsCodeSigning = process.env.SKIP_WIN_CODESIGN?.trim() === '1';

const azure = [
  'AZURE_CLIENT_ID',
  'AZURE_TENANT_ID',
  'AZURE_CLIENT_SECRET',
  'AZURE_ARTIFACT_SIGNING_ENDPOINT',
  'AZURE_ARTIFACT_SIGNING_ACCOUNT',
  'AZURE_ARTIFACT_SIGNING_PROFILE',
  'AZURE_ARTIFACT_SIGNING_PUBLISHER',
];
const complete = !azure.some((name) => !process.env[name]?.trim());
const willSign = !skipWindowsCodeSigning && complete;

if (process.platform !== 'win32') {
  throw new Error('Signed Windows builds must run on Windows.');
}
if (skipWindowsCodeSigning) {
  console.warn('[electron-builder] SKIP_WIN_CODESIGN=1; producing unsigned Windows artifacts.');
} else if (!complete) {
  const missing = azure.filter((name) => !process.env[name]?.trim());
  console.warn(
    `[electron-builder] Azure Artifact Signing environment variables incomplete ` +
      `(${missing.join(', ')} missing); producing UNSIGNED Windows artifacts. ` +
      'Set the AZURE_* variables (see .env.example) to enable Authenticode signing.',
  );
}

module.exports = {
  extends: path.resolve(
    process.env.ELECTRON_BUILDER_WINDOWS_BASE_CONFIG || 'electron-builder.base.yml'
  ),
  forceCodeSigning: willSign,
  win: {
    ...(willSign
      ? {
          signtoolOptions: {
            publisherName: process.env.AZURE_ARTIFACT_SIGNING_PUBLISHER.trim(),
            signingHashAlgorithms: ['sha256'],
            sign: path.join(__dirname, 'electron-builder-artifact-sign.cjs'),
          },
        }
      : {
          signExecutable: false,
        }),
  },
};
