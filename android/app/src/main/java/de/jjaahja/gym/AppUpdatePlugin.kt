package de.jjaahja.gym

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import androidx.core.content.pm.PackageInfoCompat
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * Updates direkt aus der App: neue APK laden, prüfen (Prüfsumme, gleiches Paket, höhere Version) und den
 * System-Installer öffnen. Android installiert sie nur, wenn sie mit demselben Schlüssel signiert ist.
 * Einmalig muss der Nutzer „Apps aus dieser Quelle installieren“ für die App erlauben.
 */
@CapacitorPlugin(name = "AppUpdate")
class AppUpdatePlugin : Plugin() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private fun installedVersionCode(): Long =
        PackageInfoCompat.getLongVersionCode(context.packageManager.getPackageInfo(context.packageName, 0))

    private fun canInstall(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.O || context.packageManager.canRequestPackageInstalls()

    @PluginMethod
    fun getInfo(call: PluginCall) {
        val info = context.packageManager.getPackageInfo(context.packageName, 0)
        call.resolve(JSObject().apply {
            put("versionCode", PackageInfoCompat.getLongVersionCode(info))
            put("versionName", info.versionName ?: "")
            put("canInstall", canInstall())
        })
    }

    /** Einstellung „Apps aus dieser Quelle installieren“ für diese App öffnen. */
    @PluginMethod
    fun openInstallSettings(call: PluginCall) {
        try {
            val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}"))
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
            call.resolve()
        } catch (e: Exception) {
            call.reject("Einstellung nicht verfügbar", null, e)
        }
    }

    /** Erwartet: url (https), sha256 (hex). Meldet Fortschritt als „downloadProgress“ { loaded, total }. */
    @PluginMethod
    fun downloadAndInstall(call: PluginCall) {
        val url = call.getString("url") ?: return call.reject("url fehlt")
        val expected = call.getString("sha256")?.lowercase() ?: return call.reject("sha256 fehlt")
        if (!url.startsWith("https://")) return call.reject("Nur HTTPS")
        if (!canInstall()) return call.reject("INSTALL_NOT_ALLOWED")

        scope.launch {
            val dir = File(context.cacheDir, "updates").apply { mkdirs() }
            dir.listFiles()?.forEach { it.delete() }
            val file = File(dir, "gym-update.apk")
            try {
                val connection = (URL(url).openConnection() as HttpURLConnection).apply {
                    connectTimeout = 15_000
                    readTimeout = 30_000
                }
                if (connection.responseCode != 200) {
                    call.reject("Download fehlgeschlagen (HTTP ${connection.responseCode})")
                    return@launch
                }
                val total = connection.contentLengthLong
                val digest = MessageDigest.getInstance("SHA-256")
                var loaded = 0L
                var lastReported = -1L
                connection.inputStream.use { input ->
                    file.outputStream().use { output ->
                        val buffer = ByteArray(64 * 1024)
                        while (true) {
                            val n = input.read(buffer)
                            if (n < 0) break
                            output.write(buffer, 0, n)
                            digest.update(buffer, 0, n)
                            loaded += n
                            // höchstens ~50 Meldungen
                            val step = if (total > 0) total / 50 else 256L * 1024
                            if (loaded - lastReported >= step) {
                                lastReported = loaded
                                notifyListeners("downloadProgress", JSObject().apply {
                                    put("loaded", loaded)
                                    put("total", total)
                                })
                            }
                        }
                    }
                }
                val actual = digest.digest().joinToString("") { "%02x".format(it) }
                if (actual != expected) {
                    file.delete()
                    call.reject("Prüfsumme stimmt nicht – Download beschädigt")
                    return@launch
                }
                val archive = context.packageManager.getPackageArchiveInfo(file.path, 0)
                if (archive == null || archive.packageName != context.packageName) {
                    file.delete()
                    call.reject("Keine gültige Version dieser App")
                    return@launch
                }
                if (PackageInfoCompat.getLongVersionCode(archive) <= installedVersionCode()) {
                    file.delete()
                    call.reject("Nicht neuer als die installierte Version")
                    return@launch
                }
                val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
                val intent = Intent(Intent.ACTION_VIEW).apply {
                    setDataAndType(uri, "application/vnd.android.package-archive")
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                activity.runOnUiThread { context.startActivity(intent) }
                call.resolve(JSObject().apply {
                    put("started", true)
                    put("versionCode", PackageInfoCompat.getLongVersionCode(archive))
                })
            } catch (e: Exception) {
                file.delete()
                call.reject("Update fehlgeschlagen: ${e.message}", null, e)
            }
        }
    }
}
