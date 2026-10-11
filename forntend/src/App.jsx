import React, { useState, useEffect } from 'react'
import UserRoutes from './modules/User/routes'
import SellerRoutes from './modules/Seller/routes'
import AdminRoutes from './modules/Admin/routes'
import DeliveryRoutes from './modules/Delivery/routes'
import MockPhonePePage from './components/MockPhonePePage'

function App() {
  const [path, setPath] = useState(window.location.pathname)

  useEffect(() => {
    const handleLocationChange = () => {
      setPath(window.location.pathname)
    }
    
    window.addEventListener('popstate', handleLocationChange)
    
    const originalPushState = window.history.pushState
    const originalReplaceState = window.history.replaceState
    
    window.history.pushState = function(...args) {
      originalPushState.apply(this, args)
      handleLocationChange()
    }
    window.history.replaceState = function(...args) {
      originalReplaceState.apply(this, args)
      handleLocationChange()
    }

    return () => {
      window.removeEventListener('popstate', handleLocationChange)
      window.history.pushState = originalPushState
      window.history.replaceState = originalReplaceState
    }
  }, [])

  if (path === '/mock-phonepe' || path.startsWith('/mock-phonepe')) {
    return <MockPhonePePage />
  }

  if (path === '/delivery' || path.startsWith('/delivery/')) {
    return <DeliveryRoutes />
  }

  if (path === '/seller' || path.startsWith('/seller/')) {
    return <SellerRoutes />
  }

  if (path === '/admin' || path.startsWith('/admin/')) {
    return <AdminRoutes />
  }

  return <UserRoutes />
}

export default App
