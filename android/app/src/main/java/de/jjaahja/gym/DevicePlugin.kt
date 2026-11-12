package de.jjaahja.gym

import android.view.WindowManager
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/** Gerätefunktionen für das Training: Bildschirm anlassen. */
@CapacitorPlugin(name = "GymDevice")
class DevicePlugin : Plugin() {
    @PluginMethod
    fun keepAwake(call: PluginCall) {
        val enabled = call.getBoolean("enabled") ?: true
        activity.runOnUiThread {
            if (enabled) activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            else activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            call.resolve()
        }
    }
}
