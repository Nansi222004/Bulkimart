package com.bulkimart.delivery.alert

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.net.Uri
import android.os.Build
import android.provider.Settings
import com.bulkimart.delivery.R
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.module.annotations.ReactModule

/**
 * Ringing for new rider offers.
 *
 * - [ensureChannel] creates the "New order offers" notification channel (called at app start). The backend sends
 *   order / parcel / return offers to channel [CHANNEL_ID] (backend/services/fcm.service.js), so with the app
 *   closed Android shows a pop-up and plays res/raw/order_alert. Other notifications keep the default channel.
 * - [start] / [stop] loop the same sound while an offer pop-up is open in the app; [stop] also clears offer
 *   notifications from the tray, so the tray sound stops once the rider is looking at the offer.
 *
 * The sound follows the phone's ring volume (USAGE_NOTIFICATION_RINGTONE), so silent mode is respected.
 */
@ReactModule(name = OrderAlertModule.NAME)
class OrderAlertModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
  private var player: MediaPlayer? = null

  override fun getName() = NAME

  @ReactMethod
  fun start() {
    if (player != null) return
    try {
      player = MediaPlayer().apply {
        setAudioAttributes(ringAttributes())
        setDataSource(reactContext, soundUri(reactContext))
        isLooping = true
        prepare()
        start()
      }
    } catch (_: Exception) {
      release()
    }
  }

  @ReactMethod
  fun stop() {
    release()
    clearOfferNotifications(reactContext)
  }

  /** Opens Android's settings page for the offers channel, so the rider can change its sound or volume. */
  @ReactMethod
  fun openChannelSettings() {
    val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
        .putExtra(Settings.EXTRA_APP_PACKAGE, reactContext.packageName)
        .putExtra(Settings.EXTRA_CHANNEL_ID, CHANNEL_ID)
    } else {
      Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${reactContext.packageName}"))
    }
    reactContext.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
  }

  override fun invalidate() {
    release()
    super.invalidate()
  }

  private fun release() {
    player?.let {
      try { if (it.isPlaying) it.stop() } catch (_: Exception) { /* already stopped */ }
      it.release()
    }
    player = null
  }

  companion object {
    const val NAME = "BulkimartOrderAlert"
    // Changing the sound later needs a NEW id: Android never updates an existing channel's sound.
    const val CHANNEL_ID = "rider_offers_v1"

    private fun ringAttributes(): AudioAttributes = AudioAttributes.Builder()
      .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
      .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
      .build()

    private fun soundUri(context: Context): Uri =
      Uri.parse("android.resource://${context.packageName}/${R.raw.order_alert}")

    fun ensureChannel(context: Context) {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
      val manager = context.getSystemService(NotificationManager::class.java) ?: return
      if (manager.getNotificationChannel(CHANNEL_ID) != null) return
      val channel = NotificationChannel(CHANNEL_ID, "New order offers", NotificationManager.IMPORTANCE_HIGH).apply {
        description = "Rings when a new order, parcel or return pickup is offered to you"
        setSound(soundUri(context), ringAttributes())
        enableVibration(true)
        vibrationPattern = longArrayOf(0, 600, 400, 600, 400, 600)
        lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
      }
      manager.createNotificationChannel(channel)
    }

    fun clearOfferNotifications(context: Context) {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
      val manager = context.getSystemService(NotificationManager::class.java) ?: return
      try {
        manager.activeNotifications
          .filter { it.notification.channelId == CHANNEL_ID }
          .forEach { manager.cancel(it.tag, it.id) }
      } catch (_: Exception) { /* nothing to clear */ }
    }
  }
}
