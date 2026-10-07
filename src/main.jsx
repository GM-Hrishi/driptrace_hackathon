import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { MotionConfig } from 'motion/react'

import '@fontsource-variable/ibm-plex-sans'
// Latin subsets only. The full packages ship Cyrillic, Greek and Vietnamese
// faces this dashboard never renders.
import '@fontsource/ibm-plex-mono/latin-400.css'
import '@fontsource/ibm-plex-mono/latin-600.css'
import './index.css'

import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {/* reducedMotion="user" makes every motion animation in the tree honour the
        OS preference, so alarm motion degrades to the static heavy-outline
        treatment without any component opting in. */}
    <MotionConfig reducedMotion="user">
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </MotionConfig>
  </StrictMode>,
)
