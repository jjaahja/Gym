package de.jjaahja.gym

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.res.ColorStateList
import android.content.res.Configuration
import android.graphics.Color
import android.os.Build
import android.view.View
import android.widget.RemoteViews

/**
 * Startbildschirm-Widget: nächstes Training und Wochenziel. Den Inhalt berechnet die App (GymDevice.updateWidget) und
 * legt ihn in den SharedPreferences ab; das Widget zeigt ihn nur an und öffnet beim Antippen die App.
 */
class GymWidgetProvider : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        manager.updateAppWidget(ids, views(context))
    }

    companion object {
        const val PREFS = "gym_widget"

        fun updateAll(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(ComponentName(context, GymWidgetProvider::class.java))
            if (ids.isNotEmpty()) manager.updateAppWidget(ids, views(context))
        }

        private fun color(value: String?, fallback: Int): Int =
            try {
                if (value.isNullOrBlank()) fallback else Color.parseColor(value)
            } catch (e: IllegalArgumentException) {
                fallback
            }

        fun views(context: Context): RemoteViews {
            val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val views = RemoteViews(context.packageName, R.layout.gym_widget)
            views.setTextViewText(R.id.widget_label, prefs.getString("label", "Gym"))
            views.setTextViewText(R.id.widget_title, prefs.getString("title", "Öffne die App"))
            views.setTextViewText(R.id.widget_subtitle, prefs.getString("subtitle", "Dein nächstes Training erscheint hier"))
            views.setTextViewText(R.id.widget_footer, prefs.getString("footer", ""))

            val max = prefs.getInt("max", 0)
            if (max > 0) {
                views.setViewVisibility(R.id.widget_progress, View.VISIBLE)
                views.setProgressBar(R.id.widget_progress, max, prefs.getInt("progress", 0).coerceIn(0, max), false)
            } else {
                views.setViewVisibility(R.id.widget_progress, View.GONE)
            }

            // Akzentfarbe des gewählten Themas (hell bzw. dunkel)
            val night = (context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
            val accent = color(prefs.getString(if (night) "accentDark" else "accentLight", null), context.getColor(R.color.widget_accent))
            views.setTextColor(R.id.widget_label, accent)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                views.setColorStateList(R.id.widget_progress, "setProgressTintList", ColorStateList.valueOf(accent))
            }

            val open = Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            views.setOnClickPendingIntent(
                R.id.widget_root,
                PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT),
            )
            return views
        }
    }
}
