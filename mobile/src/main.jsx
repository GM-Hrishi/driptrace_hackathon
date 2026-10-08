import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router'
import { MotionConfig } from 'motion/react'

// Same type and tokens as the website, bundled into the APK so the app works
// without fetching fonts.
import '@fontsource-variable/geist/wght.css'
import '@fontsource-variable/geist-mono/wght.css'
import '../../src/index.css'
import './mobile.css'

import App from './App.jsx'

// Hash routing: the WebView serves static assets, so there is no server to
// rewrite deep links, and MainActivity can open a bed with location.hash.
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <HashRouter>
        <App />
      </HashRouter>
    </MotionConfig>
  </StrictMode>,
)
