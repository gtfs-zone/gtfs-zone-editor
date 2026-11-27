import { defineConfig, searchForWorkspaceRoot } from 'vite'
import { resolve } from 'path'
import gitDescribe from 'git-describe'
import { execSync } from 'child_process'
import { readFileSync, realpathSync } from 'fs'

// Get version from git tags using git-describe
let version = '0.0.0-development'
try {
  const gitInfo = gitDescribe.gitDescribeSync({
    longSemver: true,
    dirtySemver: false,
  })

  // If we're exactly on a tag, use the clean version
  if (gitInfo.distance === 0) {
    version = gitInfo.tag.replace(/^v/, '')
  } else {
    // Otherwise, include commits since tag + hash
    version = `${gitInfo.tag.replace(/^v/, '')}-${gitInfo.distance}-g${gitInfo.hash}`
  }
} catch (error) {
  // No git tags found, use development version with commit hash
  try {
    const hash = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim()
    version = `0.0.0-dev.${hash}`
  } catch {
    console.warn('Could not determine git version, using default')
  }
}

// Real path of gtfs-zone-web-common: the pnpm store copy, or the sibling
// checkout while `pnpm common:local` links it.
const webCommonDir = realpathSync(resolve(import.meta.dirname, 'node_modules/gtfs-zone-web-common'))
const webCommonPeers = Object.keys(
  JSON.parse(readFileSync(resolve(webCommonDir, 'package.json'), 'utf-8')).peerDependencies
)

// Inlines src/intro.html at `<!-- @intro -->`, so the copy the home panel shows
// for an empty feed is also in the static HTML.
const inlineIntro = {
  name: 'inline-intro',
  transformIndexHtml: (html) =>
    html.replace('<!-- @intro -->', readFileSync(resolve(import.meta.dirname, 'src/intro.html'), 'utf-8'))
}

// Restarts the dev server when pnpm-lock.yaml changes. A dependency bump moves
// gtfs-zone-web-common to a new store path, and cached transforms (mainly the
// shared stylesheet's CSS @import) keep serving the old copy until a restart.
const restartOnLockfile = {
  name: 'restart-on-lockfile',
  apply: 'serve',
  configureServer(server) {
    const lockfile = resolve(import.meta.dirname, 'pnpm-lock.yaml')
    server.watcher.add(lockfile)
    server.watcher.on('change', (file) => {
      if (file === lockfile) {
        server.config.logger.info('[restart-on-lockfile] pnpm-lock.yaml changed, restarting')
        void server.restart()
      }
    })
  },
}

export default defineConfig({
  plugins: [inlineIntro, restartOnLockfile],
  root: 'src',
  publicDir: '../public',
  define: {
    __APP_VERSION__: JSON.stringify(version)
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rolldownOptions: {
      input: resolve(import.meta.dirname, 'src/index.html')
    }
  },
  server: {
    port: 8080,
    open: true,
    host: true, // Allow external connections
    fs: {
      allow: [searchForWorkspaceRoot(import.meta.dirname), webCommonDir]
    }
  },
  css: {
    postcss: './postcss.config.js'
  },
  resolve: {
    alias: {
      // The real path, so the app's imports and web-common's relative ones get
      // the same module URL (a path through node_modules gets a ?v= query)
      'gtfs-zone-web-common': resolve(webCommonDir, 'src')
    },
    // Resolves web-common's peers from this app, not from a linked checkout's
    // own node_modules, so the page holds one copy of each
    dedupe: webCommonPeers
  },
  optimizeDeps: {
    include: ['maplibre-gl', '@maplibre/geojson-vt', '@maplibre/vt-pbf', 'codemirror', 'jszip', 'papaparse'],
    // gtfs-zone-web-common ships raw .ts; let vite transform it as source
    exclude: ['gtfs-zone-web-common']
  }
})