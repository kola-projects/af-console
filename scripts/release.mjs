#!/usr/bin/env node
/**
 * Bump semver (patch|minor|major) → commit package.json → tag vX.Y.Z → push.
 * GitHub Action `.github/workflows/deploy-tag.yml` sẽ deploy tag lên Vercel Production.
 *
 * Usage:
 *   pnpm release:patch
 *   pnpm release:minor
 *   pnpm release:major
 *   node scripts/release.mjs patch [--dry-run]
 */
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BUMPS = new Set(['patch', 'minor', 'major'])

function run(cmd, opts = {}) {
  console.log(`$ ${cmd}`)
  return execSync(cmd, { cwd: ROOT, stdio: 'inherit', ...opts })
}

function runOut(cmd) {
  return execSync(cmd, { cwd: ROOT, encoding: 'utf8' }).trim()
}

function die(msg) {
  console.error(`\n✖ ${msg}`)
  process.exit(1)
}

const bump = process.argv[2]
const dryRun = process.argv.includes('--dry-run')

if (!BUMPS.has(bump)) {
  die(`Cần bump: patch | minor | major\n\n  pnpm release:patch\n  pnpm release:minor\n  pnpm release:major`)
}

const branch = runOut('git rev-parse --abbrev-ref HEAD')
if (branch !== 'main' && branch !== 'master') {
  die(`Phải đứng trên main (hiện tại: ${branch}). git checkout main && git pull`)
}

const status = runOut('git status --porcelain')
if (status) {
  die(`Working tree bẩn — commit/stash trước khi release:\n${status}`)
}

// Đồng bộ remote trước khi tag, tránh tag lệch commit.
run('git fetch origin')
const upstream = runOut(`git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null || true`)
if (upstream) {
  const behind = Number(runOut(`git rev-list --count HEAD..${upstream}`))
  if (behind > 0) die(`Branch local chậm ${behind} commit so với ${upstream}. Chạy: git pull`)
}

const before = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version
console.log(`\n→ Release ${bump}: ${before} → …`)

if (dryRun) {
  console.log('(dry-run) dừng trước khi bump/tag/push')
  process.exit(0)
}

// pnpm version: sửa package.json + commit + tạo annotated tag vX.Y.Z
run(`pnpm version ${bump} -m "release: v%s"`)

const after = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version
const tag = `v${after}`

run(`git push origin ${branch} --follow-tags`)

console.log(`
✔ Released ${tag}

Vercel Production sẽ deploy khi GitHub Action "Deploy tag" chạy xong.
Theo dõi: gh run watch   hoặc  GitHub → Actions → Deploy tag
`)
