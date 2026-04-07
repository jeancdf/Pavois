import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Ion } from 'cesium'
import './index.css'
import App from './App.tsx'

// Free Cesium ion token — sign up at https://cesium.com/ion/signup
// Replace this with your own token before deploying
Ion.defaultAccessToken = import.meta.env.VITE_CESIUM_ION_TOKEN ?? ''

const root = document.getElementById('root')
if (!root) throw new Error('Root element not found')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
