package de.jjaahja.gym

import android.content.ClipData
import android.content.Intent
import android.util.Base64
import android.view.WindowManager
import androidx.core.content.FileProvider
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File

/** Gerätefunktionen: Bildschirm im Training anlassen; Dateien (Datenexport, Fotos) über das Teilen-Menü weitergeben. */
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

    /**
     * Erwartet: name (Dateiname), mime, data (Base64). Die Datei liegt im Cache (exports/) und wird per FileProvider
     * nur der gewählten App zum Lesen freigegeben – z. B. „In Dateien speichern“, Drive oder E-Mail.
     */
    @PluginMethod
    fun shareFile(call: PluginCall) {
        val name = call.getString("name") ?: return call.reject("name fehlt")
        val mime = call.getString("mime") ?: "application/octet-stream"
        val data = call.getString("data") ?: return call.reject("data fehlt")
        try {
            val dir = File(context.cacheDir, "exports").apply { mkdirs() }
            dir.listFiles()?.forEach { it.delete() }
            val file = File(dir, name.replace(Regex("[^A-Za-z0-9._-]"), "_"))
            file.writeBytes(Base64.decode(data, Base64.DEFAULT))
            val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
            val send = Intent(Intent.ACTION_SEND).apply {
                type = mime
                putExtra(Intent.EXTRA_STREAM, uri)
                clipData = ClipData.newRawUri(file.name, uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            activity.runOnUiThread {
                activity.startActivity(Intent.createChooser(send, file.name).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
                call.resolve()
            }
        } catch (e: Exception) {
            call.reject("Datei konnte nicht geteilt werden: ${e.message}", null, e)
        }
    }
}
