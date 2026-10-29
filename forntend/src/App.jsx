import React, { Suspense, lazy, useState, useEffect } from 'react'
import UserRoutes from './modules/User/routes'
import CustomerSessionGate from './components/CustomerSessionGate'

// Shoppers download only the shop. The seller, admin and delivery apps load when one is opened.
const SellerRoutes = lazy(() => import('./modules/Seller/routes'))
const AdminRoutes = lazy(() => import('./modules/Admin/routes'))
const DeliveryRoutes = lazy(() => import('./modules/Delivery/routes'))
// A spinner on a plain page while a partner app loads, as in index.html.
const PartnerLoading = () => <div className="boot-home boot-home--partner" role="status" aria-busy="true" aria-label="Loading Bulkimart"><b className="boot-spinner" /></div>

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
    return <Suspense fallback={<PartnerLoading />}><DeliveryRoutes /></Suspense>
  }

  if (path === '/seller' || path.startsWith('/seller/')) {
    return <Suspense fallback={<PartnerLoading />}><SellerRoutes /></Suspense>
  }

  if (path === '/admin' || path.startsWith('/admin/')) {
    return <Suspense fallback={<PartnerLoading />}><AdminRoutes /></Suspense>
  }

  return <CustomerSessionGate><UserRoutes /></CustomerSessionGate>
}

export default App
