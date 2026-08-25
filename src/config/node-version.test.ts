import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * The Node version is pinned in two files because no single one is read by
 * everything: mise will stop honouring .node-version by default, while
 * actions/setup-node, nvm, and fnm do not read mise.toml. Cheap to keep both;
 * expensive to discover they disagree on draft night.
 */
describe('node version pins', () => {
  const nodeVersion = readFileSync('.node-version', 'utf8').trim()
  const miseToml = readFileSync('mise.toml', 'utf8')

  it('.node-version holds a concrete version', () => {
    expect(nodeVersion).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('mise.toml agrees with .node-version', () => {
    expect(miseToml).toContain(`node = "${nodeVersion}"`)
  })

  it('meets the Vite 7 floor', () => {
    const [major, minor] = nodeVersion.split('.').map(Number) as [number, number]
    expect(
      (major === 20 && minor >= 19) || (major === 22 && minor >= 12) || major > 22,
    ).toBe(true)
  })

  it('is the version CI installs', () => {
    const workflow = readFileSync('.github/workflows/deploy.yml', 'utf8')
    expect(workflow).toContain('node-version-file: .node-version')
  })
})
