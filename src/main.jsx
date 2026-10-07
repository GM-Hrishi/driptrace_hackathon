import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { MotionConfig } from 'motion/react'

// UI sans: Plus Jakarta Sans, refined and geometric without being decorative.
// Readouts: Geist Mono, fixed-width so live numbers never jitter sideways.
// Both are variable fonts; unicode-range keeps the browser on the Latin files.
import '@fontsource-variable/plus-jakarta-sans/wght.css'
import '@fontsource-variable/geist-mono/wght.css'
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
