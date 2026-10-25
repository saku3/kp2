// Run by `npm version <x.y.z>`: copy the new package.json version into server/Cargo.toml
// and Cargo.lock, so the release tag check in .github/workflows/release.yml passes.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const path = 'server/Cargo.toml';
const toml = readFileSync(path, 'utf8');
// Same rule as the release workflow: the first `version = "..."` line is the package version.
if (!/^version = ".*"$/m.test(toml)) throw new Error(`no version line found in ${path}`);
writeFileSync(path, toml.replace(/^version = ".*"$/m, `version = "${version}"`));
execFileSync('cargo', ['update', '-p', 'kp2', '--manifest-path', path], { stdio: 'inherit' });
