import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'

export function updatePackageJson({ crateDir, outDir, js, inline }) {
  const pkgPath = join(crateDir, 'package.json')
  if (!existsSync(pkgPath)) return

  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  const relOutDir = './' + relative(crateDir, outDir)

  if (!pkg.exports) pkg.exports = {}

  const mainExports = {}
  if (js.emit.types) {
    mainExports.types = `${relOutDir}/node.d.ts`
  }
  if (js.emit.browser) {
    mainExports.browser = `${relOutDir}/browser.js`
  }
  if (js.emit.node) {
    mainExports.node = `${relOutDir}/node.js`
    if (!mainExports.default) mainExports.default = `${relOutDir}/node.js`
  }

  if (Object.keys(mainExports).length > 0) {
    pkg.exports['.'] = mainExports
  }

  if (inline && js.emit.inline) {
    const inlineExports = {}
    if (js.emit.types) {
      inlineExports.types = `${relOutDir}/node-inline.d.ts`
    }
    if (js.emit.browser) {
      inlineExports.browser = `${relOutDir}/browser-inline.js`
    }
    if (js.emit.node) {
      inlineExports.node = `${relOutDir}/node-inline.js`
      if (!inlineExports.default)
        inlineExports.default = `${relOutDir}/node-inline.js`
    }
    if (Object.keys(inlineExports).length > 0) {
      pkg.exports['./inline'] = inlineExports
    }
  }

  if (js.emit.types) {
    pkg.types = `${relOutDir}/node.d.ts`
  }
  if (js.emit.node) {
    pkg.main = `${relOutDir}/node.js`
  }
  if (js.emit.browser) {
    pkg.module = `${relOutDir}/browser.js`
  }

  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
  console.log('Updated package.json exports and fields')
}
