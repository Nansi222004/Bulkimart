package com.bulkimart.seller.otp

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

/** Registers [OtpAutofillModule] (added manually in MainApplication; not autolinked). */
class OtpAutofillPackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
    if (name == OtpAutofillModule.NAME) OtpAutofillModule(reactContext) else null

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider {
    mapOf(
      OtpAutofillModule.NAME to ReactModuleInfo(
        OtpAutofillModule.NAME,
        OtpAutofillModule::class.java.name,
        false, // canOverrideExistingModule
        false, // needsEagerInit
        false, // isCxxModule
        false, // isTurboModule (legacy module via the New Architecture interop layer)
      ),
    )
  }
}
