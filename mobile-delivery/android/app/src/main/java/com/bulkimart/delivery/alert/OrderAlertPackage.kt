package com.bulkimart.delivery.alert

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

/** Registers [OrderAlertModule] (added manually in MainApplication; not autolinked). Same pattern as ../otp. */
class OrderAlertPackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
    if (name == OrderAlertModule.NAME) OrderAlertModule(reactContext) else null

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider {
    mapOf(
      OrderAlertModule.NAME to ReactModuleInfo(
        OrderAlertModule.NAME,
        OrderAlertModule::class.java.name,
        false, // canOverrideExistingModule
        false, // needsEagerInit
        false, // isCxxModule
        false, // isTurboModule (legacy module via the New Architecture interop layer)
      ),
    )
  }
}
