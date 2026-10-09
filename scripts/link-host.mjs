import { lstatSync, mkdirSync, realpathSync, symlinkSync, unlinkSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// A source-linked plugin must share the host's singleton contexts and registries.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const check = args.includes('--check')
const hostArg = args.find(arg => arg !== '--check')
if (!hostArg) throw new Error('Usage: bun scripts/link-host.mjs <editor-workspace-root> [--check]')
const host = realpathSync(resolve(hostArg))
const names = ['react', 'react-dom', 'three', 'zod', 'zustand', '@react-three/fiber', '@react-three/drei', '@types/react', '@types/react-dom', '@types/three', '@pascal-app/core', '@pascal-app/editor', '@pascal-app/viewer']
// Validate every target before modifying any links.
const links = names.map(name => ({ name, target: realpathSync(resolve(host, 'node_modules', name)), link: resolve(root, 'node_modules', name) }))
for (const { link } of links) {
  try { if (!lstatSync(link).isSymbolicLink()) throw new Error(`Refusing to replace a real directory: ${link}`) }
  catch (error) { if (error.code !== 'ENOENT') throw error }
}
let mismatch = false
for (const { name, target, link } of links) {
  let current
  try { current = realpathSync(link) } catch {}
  if (current !== target) {
    mismatch = true
    if (!check) {
      mkdirSync(dirname(link), { recursive: true })
      try { unlinkSync(link) } catch (error) { if (error.code !== 'ENOENT') throw error }
      symlinkSync(target, link, 'dir')
    }
  }
  console.log(`${name}: ${current === target ? 'shared' : check ? 'MISMATCH' : 'linked'}`)
}
if (check && mismatch) process.exitCode = 1
