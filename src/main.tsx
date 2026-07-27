import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { loadOoz } from './save/ooz.ts'
import './styles/tokens.css'
import './styles/ui.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// F1 spike wiring: proves ooz-wasm (GPL, loaded lazily) code-splits into its own chunk instead of
// the entry bundle — see src/save/ooz.spike.test.ts and the F1 task report. The URL-param gate
// (rather than a build-time constant) keeps a bundler from dead-code-eliminating the import, while
// guaranteeing normal page loads never fetch it. F2 replaces this with the real worker call.
if (new URLSearchParams(window.location.search).has('__oozSpike')) {
  void loadOoz().then((decompress) => {
    console.info('[ooz spike] decompress loaded:', typeof decompress === 'function')
  })
}
