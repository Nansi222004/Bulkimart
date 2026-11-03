package com.bulkimart.delivery.otp

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.content.pm.Signature
import android.os.Build
import android.util.Base64
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.module.annotations.ReactModule
import com.google.android.gms.auth.api.identity.GetPhoneNumberHintIntentRequest
import com.google.android.gms.auth.api.identity.Identity
import com.google.android.gms.auth.api.phone.SmsRetriever
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.common.api.CommonStatusCodes
import com.google.android.gms.common.api.Status
import java.nio.charset.StandardCharsets
import java.security.MessageDigest

/**
 * Phone Number Hint + SMS Retriever for the login screens.
 *
 * - Phone Number Hint (Google Identity): a system picker the user must tap; the
 *   app never reads the SIM. Needs no permission.
 * - SMS Retriever: Play services hands over ONE SMS that ends with this app's
 *   11-character hash, for 5 minutes after start. Needs no SMS permission.
 *
 * Only the extracted digits are sent to JS; the SMS text is never logged,
 * stored or forwarded.
 *
 * Keep identical across mobile-user, mobile-seller and mobile-delivery (only
 * the package line differs).
 */
@ReactModule(name = OtpAutofillModule.NAME)
class OtpAutofillModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext), LifecycleEventListener {

  companion object {
    const val NAME = "BulkimartOtpAutofill"
    const val EVENT_CODE = "BulkimartOtpAutofill:code"
    const val EVENT_TIMEOUT = "BulkimartOtpAutofill:timeout"
    private const val PHONE_HINT_REQUEST = 47021
    private val CODE_AFTER_PHRASE = Regex("code is\\s*(\\d{4,8})", RegexOption.IGNORE_CASE)
    private val ANY_CODE = Regex("(?<!\\d)(\\d{4,8})(?!\\d)")

    /** Pulls the OTP digits out of a retrieved SMS. Visible for unit tests. */
    fun extractCode(message: String): String? =
      CODE_AFTER_PHRASE.find(message)?.groupValues?.get(1) ?: ANY_CODE.find(message)?.groupValues?.get(1)

    /** Same algorithm as Google's AppSignatureHelper. */
    fun hashFor(packageName: String, signature: String): String {
      val digest = MessageDigest.getInstance("SHA-256")
        .digest("$packageName $signature".toByteArray(StandardCharsets.UTF_8))
        .copyOfRange(0, 9)
      return Base64.encodeToString(digest, Base64.NO_PADDING or Base64.NO_WRAP).substring(0, 11)
    }
  }

  private var phoneHintPromise: Promise? = null
  private var smsReceiver: BroadcastReceiver? = null

  private val activityListener = object : BaseActivityEventListener() {
    override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
      if (requestCode != PHONE_HINT_REQUEST) return
      val promise = phoneHintPromise ?: return
      phoneHintPromise = null
      // Dismissed picker or "None of the above": the user types the number instead.
      if (resultCode != Activity.RESULT_OK || data == null) {
        promise.resolve(null)
        return
      }
      try {
        promise.resolve(Identity.getSignInClient(activity).getPhoneNumberFromIntent(data))
      } catch (e: Exception) {
        promise.reject("E_PHONE_HINT", "Could not read the selected number.")
      }
    }
  }

  init {
    reactContext.addActivityEventListener(activityListener)
    reactContext.addLifecycleEventListener(this)
  }

  override fun getName(): String = NAME

  private fun playServicesReady(): Boolean =
    GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(reactContext) == ConnectionResult.SUCCESS

  /** True when Google Play services is usable (picker + autofill can work). */
  @ReactMethod
  fun isSupported(promise: Promise) {
    promise.resolve(playServicesReady())
  }

  /**
   * Opens the system phone number picker. Resolves the chosen number (E.164,
   * e.g. "+919876543210") or null if dismissed. Rejects E_NO_HINT when the
   * device has no number to offer, E_UNAVAILABLE without Play services.
   */
  @ReactMethod
  fun requestPhoneNumber(promise: Promise) {
    val activity = reactContext.currentActivity
    if (activity == null) {
      promise.reject("E_NO_ACTIVITY", "The app is not in the foreground.")
      return
    }
    if (!playServicesReady()) {
      promise.reject("E_UNAVAILABLE", "Google Play services is not available on this device.")
      return
    }
    if (phoneHintPromise != null) {
      promise.reject("E_IN_PROGRESS", "The phone number picker is already open.")
      return
    }
    phoneHintPromise = promise
    Identity.getSignInClient(activity)
      .getPhoneNumberHintIntent(GetPhoneNumberHintIntentRequest.builder().build())
      .addOnSuccessListener { pendingIntent ->
        try {
          activity.startIntentSenderForResult(pendingIntent.intentSender, PHONE_HINT_REQUEST, null, 0, 0, 0)
        } catch (e: Exception) {
          phoneHintPromise = null
          promise.reject("E_PHONE_HINT", "Could not open the phone number picker.")
        }
      }
      .addOnFailureListener {
        phoneHintPromise = null
        promise.reject("E_NO_HINT", "No phone number is available on this device.")
      }
  }

  /**
   * Starts a 5-minute SMS Retriever session. Call right before requesting the
   * OTP. Emits EVENT_CODE { code } or EVENT_TIMEOUT once, then stops. Resolves
   * false when autofill is unavailable (manual entry still works).
   */
  @ReactMethod
  fun startSmsListener(promise: Promise) {
    if (!playServicesReady()) {
      promise.resolve(false)
      return
    }
    try {
      registerSmsReceiver()
    } catch (e: Exception) {
      promise.resolve(false)
      return
    }
    SmsRetriever.getClient(reactContext).startSmsRetriever()
      .addOnSuccessListener { promise.resolve(true) }
      .addOnFailureListener {
        unregisterSmsReceiver()
        promise.resolve(false)
      }
  }

  @ReactMethod
  fun stopSmsListener() {
    unregisterSmsReceiver()
  }

  /**
   * The 11-character SMS Retriever hash for the certificate this install is
   * signed with (debug key, upload key or Play App Signing key).
   */
  @ReactMethod
  fun getAppHash(promise: Promise) {
    try {
      val signature = currentSignature()
      promise.resolve(signature?.let { hashFor(reactContext.packageName, it.toCharsString()) })
    } catch (e: Exception) {
      promise.resolve(null)
    }
  }

  // Required by NativeEventEmitter; events go through emitDeviceEvent.
  @ReactMethod
  fun addListener(eventName: String) = Unit

  @ReactMethod
  fun removeListeners(count: Double) = Unit

  private fun currentSignature(): Signature? {
    val pm = reactContext.packageManager
    val pkg = reactContext.packageName
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      pm.getPackageInfo(pkg, PackageManager.GET_SIGNING_CERTIFICATES).signingInfo?.apkContentsSigners?.firstOrNull()
    } else {
      @Suppress("DEPRECATION")
      pm.getPackageInfo(pkg, PackageManager.GET_SIGNATURES).signatures?.firstOrNull()
    }
  }

  private fun registerSmsReceiver() {
    if (smsReceiver != null) return
    val receiver = object : BroadcastReceiver() {
      override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != SmsRetriever.SMS_RETRIEVED_ACTION) return
        val extras = intent.extras ?: return
        @Suppress("DEPRECATION")
        val status = extras.get(SmsRetriever.EXTRA_STATUS) as? Status ?: return
        when (status.statusCode) {
          CommonStatusCodes.SUCCESS -> {
            val code = extractCode(extras.getString(SmsRetriever.EXTRA_SMS_MESSAGE).orEmpty())
            if (code != null) emit(EVENT_CODE, Arguments.createMap().apply { putString("code", code) })
          }
          CommonStatusCodes.TIMEOUT -> emit(EVENT_TIMEOUT, null)
        }
        // One retriever session delivers at most one SMS.
        unregisterSmsReceiver()
      }
    }
    val filter = IntentFilter(SmsRetriever.SMS_RETRIEVED_ACTION)
    // The broadcast comes from Play services (another app), guarded by its permission.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      reactContext.registerReceiver(receiver, filter, SmsRetriever.SEND_PERMISSION, null, Context.RECEIVER_EXPORTED)
    } else {
      reactContext.registerReceiver(receiver, filter, SmsRetriever.SEND_PERMISSION, null)
    }
    smsReceiver = receiver
  }

  private fun unregisterSmsReceiver() {
    val receiver = smsReceiver ?: return
    smsReceiver = null
    try {
      reactContext.unregisterReceiver(receiver)
    } catch (_: IllegalArgumentException) {
      // Already unregistered.
    }
  }

  private fun emit(event: String, payload: WritableMap?) {
    if (reactContext.hasActiveReactInstance()) reactContext.emitDeviceEvent(event, payload)
  }

  // Keep listening while backgrounded (the user may open Messages); clean up on destroy.
  override fun onHostResume() = Unit

  override fun onHostPause() = Unit

  override fun onHostDestroy() {
    unregisterSmsReceiver()
  }

  override fun invalidate() {
    unregisterSmsReceiver()
    phoneHintPromise = null
    reactContext.removeActivityEventListener(activityListener)
    reactContext.removeLifecycleEventListener(this)
    super.invalidate()
  }
}
