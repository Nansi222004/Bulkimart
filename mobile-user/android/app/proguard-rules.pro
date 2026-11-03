# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# react-native-reanimated
-keep class com.swmansion.reanimated.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }

# Add any project specific keep options here:

# Kept even if minify is turned back on (release crashed on launch when R8 removed these):
# WorkManager's Room database, created by reflection at app start (androidx.startup).
-keep class androidx.work.impl.** { *; }
-keep class * extends androidx.room.RoomDatabase { *; }
# Razorpay checkout
-keep class com.razorpay.** { *; }
-dontwarn com.razorpay.**
-keepattributes *Annotation*
-keepclassmembers class * { @android.webkit.JavascriptInterface <methods>; }

# OTP autofill native module (looked up by name from JS).
-keep class **.otp.OtpAutofill* { *; }
