package com.bulkimart.delivery

import android.app.Application
import com.facebook.react.common.assets.ReactFontManager
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.bulkimart.delivery.otp.OtpAutofillPackage

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
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    // Bundled Inter: phone font themes (e.g. handwriting fonts) must not restyle the app.
    ReactFontManager.getInstance().addCustomFont(this, "Inter", R.font.xml_inter)
    loadReactNative(this)
  }
}
