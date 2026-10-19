import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import FeedbackProvider from './components/feedback/FeedbackProvider'
import { initAppZoomPrevention } from './utils/preventZoom'
import { initCustomerHeaderInsets } from './utils/customerHeaderInsets'

initCustomerHeaderInsets()
initAppZoomPrevention()

if (window.location.pathname === '/') {
  window.history.replaceState(window.history.state, '', `/grocery--home${window.location.search}${window.location.hash}`)
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <FeedbackProvider><App /></FeedbackProvider>
  </StrictMode>,
)
