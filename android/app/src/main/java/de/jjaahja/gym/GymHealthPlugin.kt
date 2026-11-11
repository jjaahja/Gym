package de.jjaahja.gym

import androidx.activity.result.ActivityResult
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.ActiveCaloriesBurnedRecord
import androidx.health.connect.client.records.ExerciseSegment
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.Record
import androidx.health.connect.client.records.metadata.Metadata
import androidx.health.connect.client.units.Energy
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import java.time.Instant
import java.time.ZoneId
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * Trainings in Health Connect speichern: Krafttraining-Einheit mit einem Segment je Satz (Übung + Wiederholungen)
 * und geschätzten aktiven Kalorien. Das Lese-Plugin (@capgo/capacitor-health) kann keine Trainings schreiben.
 *
 * Idempotent über clientRecordId („gym-session-<id>“): erneutes Senden aktualisiert statt zu verdoppeln.
 */
@CapacitorPlugin(name = "GymHealth")
class GymHealthPlugin : Plugin() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private val writePermissions = setOf(
        HealthPermission.getWritePermission(ExerciseSessionRecord::class),
        HealthPermission.getWritePermission(ActiveCaloriesBurnedRecord::class),
    )

    private fun client(): HealthConnectClient? =
        if (HealthConnectClient.getSdkStatus(context) == HealthConnectClient.SDK_AVAILABLE) {
            HealthConnectClient.getOrCreate(context)
        } else {
            null
        }

    private fun statusOf(granted: Set<String>): JSObject = JSObject().apply {
        put("workouts", granted.contains(HealthPermission.getWritePermission(ExerciseSessionRecord::class)))
        put("calories", granted.contains(HealthPermission.getWritePermission(ActiveCaloriesBurnedRecord::class)))
    }

    @PluginMethod
    fun checkWritePermissions(call: PluginCall) {
        val client = client() ?: return call.reject("Health Connect ist nicht verfügbar")
        scope.launch {
            try {
                call.resolve(statusOf(client.permissionController.getGrantedPermissions()))
            } catch (e: Exception) {
                call.reject("Berechtigungen nicht lesbar", null, e)
            }
        }
    }

    @PluginMethod
    fun requestWritePermissions(call: PluginCall) {
        val client = client() ?: return call.reject("Health Connect ist nicht verfügbar")
        scope.launch {
            try {
                val granted = client.permissionController.getGrantedPermissions()
                if (granted.containsAll(writePermissions)) {
                    call.resolve(statusOf(granted))
                    return@launch
                }
                val intent = PermissionController.createRequestPermissionResultContract().createIntent(context, writePermissions)
                activity.runOnUiThread { startActivityForResult(call, intent, "writePermissionsResult") }
            } catch (e: Exception) {
                call.reject("Berechtigungsdialog nicht verfügbar", null, e)
            }
        }
    }

    @ActivityCallback
    private fun writePermissionsResult(call: PluginCall?, result: ActivityResult) {
        if (call == null) return
        val client = client() ?: return call.reject("Health Connect ist nicht verfügbar")
        scope.launch {
            try {
                call.resolve(statusOf(client.permissionController.getGrantedPermissions()))
            } catch (e: Exception) {
                call.reject("Berechtigungen nicht lesbar", null, e)
            }
        }
    }

    /**
     * Erwartet: id, title, notes?, startTime, endTime (ISO-8601), version (Zahl, steigt bei Änderungen),
     * segments: [{ startTime, endTime, type (ExerciseSegment-Konstante), repetitions }], activeCaloriesKcal?.
     */
    @PluginMethod
    fun writeWorkout(call: PluginCall) {
        val client = client() ?: return call.reject("Health Connect ist nicht verfügbar")
        val id = call.getString("id") ?: return call.reject("id fehlt")
        val start = call.getString("startTime")?.let(Instant::parse) ?: return call.reject("startTime fehlt")
        val end = call.getString("endTime")?.let(Instant::parse) ?: return call.reject("endTime fehlt")
        if (!end.isAfter(start)) return call.reject("Ende liegt nicht nach dem Start")
        val title = call.getString("title")
        val notes = call.getString("notes")
        val version = call.getLong("version") ?: 1L
        val kcal = call.getDouble("activeCaloriesKcal")
        val rawSegments = call.getArray("segments")
        val zone = ZoneId.systemDefault().rules

        val segments = mutableListOf<ExerciseSegment>()
        if (rawSegments != null) {
            for (i in 0 until rawSegments.length()) {
                val s = rawSegments.getJSONObject(i)
                val segStart = Instant.parse(s.getString("startTime"))
                val segEnd = Instant.parse(s.getString("endTime"))
                if (!segEnd.isAfter(segStart) || segStart.isBefore(start) || segEnd.isAfter(end)) continue
                segments.add(ExerciseSegment(segStart, segEnd, s.optInt("type", ExerciseSegment.EXERCISE_SEGMENT_TYPE_WEIGHTLIFTING), s.optInt("repetitions", 0)))
            }
        }

        fun session(withSegments: List<ExerciseSegment>) = ExerciseSessionRecord(
            startTime = start,
            startZoneOffset = zone.getOffset(start),
            endTime = end,
            endZoneOffset = zone.getOffset(end),
            metadata = Metadata.manualEntry("gym-session-$id", version),
            exerciseType = ExerciseSessionRecord.EXERCISE_TYPE_STRENGTH_TRAINING,
            title = title,
            notes = notes,
            segments = withSegments,
        )

        scope.launch {
            try {
                val granted = client.permissionController.getGrantedPermissions()
                if (!granted.contains(HealthPermission.getWritePermission(ExerciseSessionRecord::class))) {
                    call.reject("Keine Berechtigung zum Speichern von Trainings")
                    return@launch
                }
                // Segmenttypen, die Health Connect für Krafttraining nicht akzeptiert → „anderes Training“, notfalls ohne Segmente
                var segmentMode = "exact"
                val record = try {
                    session(segments)
                } catch (e: IllegalArgumentException) {
                    try {
                        segmentMode = "generic"
                        session(segments.map { ExerciseSegment(it.startTime, it.endTime, ExerciseSegment.EXERCISE_SEGMENT_TYPE_OTHER_WORKOUT, it.repetitions) })
                    } catch (e2: IllegalArgumentException) {
                        segmentMode = "none"
                        session(emptyList())
                    }
                }
                val records = mutableListOf<Record>(record)
                val caloriesAllowed = granted.contains(HealthPermission.getWritePermission(ActiveCaloriesBurnedRecord::class))
                if (kcal != null && kcal > 0 && caloriesAllowed) {
                    records.add(
                        ActiveCaloriesBurnedRecord(
                            startTime = start,
                            startZoneOffset = zone.getOffset(start),
                            endTime = end,
                            endZoneOffset = zone.getOffset(end),
                            energy = Energy.kilocalories(kcal),
                            metadata = Metadata.manualEntry("gym-session-$id-kcal", version),
                        ),
                    )
                }
                client.insertRecords(records)
                call.resolve(JSObject().apply {
                    put("segments", if (segmentMode == "none") 0 else segments.size)
                    put("segmentMode", segmentMode)
                    put("calories", records.size > 1)
                })
            } catch (e: Exception) {
                call.reject("Training konnte nicht gespeichert werden: ${e.message}", null, e)
            }
        }
    }
}
