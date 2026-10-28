import React, { useState, useEffect } from 'react'
import UserRoutes from './modules/User/routes'
import SellerRoutes from './modules/Seller/routes'
import AdminRoutes from './modules/Admin/routes'
import DeliveryRoutes from './modules/Delivery/routes'
import CustomerSessionGate from './components/CustomerSessionGate'

function App() {
  const [path, setPath] = useState(window.location.pathname)

  useEffect(() => {
    const handleLocationChange = () => {
      setPath(window.location.pathname)
      window.dispatchEvent(new Event('app:locationchange'))
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

  if (path === '/delivery' || path.startsWith('/delivery/')) {
    return <DeliveryRoutes />
  }

  if (path === '/seller' || path.startsWith('/seller/')) {
    return <SellerRoutes />
  }

  if (path === '/admin' || path.startsWith('/admin/')) {
    return <AdminRoutes />
  }

  return <CustomerSessionGate><UserRoutes /></CustomerSessionGate>
}

export default App
