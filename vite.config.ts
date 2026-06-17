import { defineConfig } from 'vite'

export default defineConfig({
  // Emit RELATIVE asset URLs (./assets/...) instead of root-absolute (/assets/...)
  // so the build loads correctly when served from a subpath — e.g. YouTube
  // Playables serves the bundle from .../playables/<id>/ rather than a domain root.
  base: './',
})
