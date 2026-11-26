package com.bulkimart.delivery

import android.app.Application
import com.facebook.react.common.assets.ReactFontManager
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.bulkimart.delivery.otp.OtpAutofillPackage
import com.bulkimart.delivery.alert.OrderAlertModule
import com.bulkimart.delivery.alert.OrderAlertPackage

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // Packages that cannot be autolinked yet can be added manually here, for example:
          // add(MyReactNativePackage())
          // Phone Number Hint + SMS Retriever OTP autofill (local module, see ./otp).
          add(OtpAutofillPackage())
          // Ringing for new offers + the "New order offers" notification channel (local module, see ./alert).
          add(OrderAlertPackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    // Bundled Inter: phone font themes (e.g. handwriting fonts) must not restyle the app.
    ReactFontManager.getInstance().addCustomFont(this, "Inter", R.font.xml_inter)
    // Created at every start (no-op once it exists) so offer pushes ring even before the app is opened again.
    OrderAlertModule.ensureChannel(this)
    loadReactNative(this)
  }
}
