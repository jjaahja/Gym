package de.jjaahja.gym

import androidx.activity.result.ActivityResult
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.ActiveCaloriesBurnedRecord
import androidx.health.connect.client.records.ExerciseSegment
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.NutritionRecord
import androidx.health.connect.client.records.Record
import androidx.health.connect.client.records.RestingHeartRateRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.metadata.Metadata
import androidx.health.connect.client.request.AggregateGroupByPeriodRequest
import androidx.health.connect.client.time.TimeRangeFilter
import androidx.health.connect.client.units.Energy
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.Period
import java.time.ZoneId
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * Ab App 1.3 außerdem lesen (je Tag): Ernährung (Eiweiß, Kalorien), Schlaf und Ruhepuls – für Eiweiß-Ziel und
 * Erholungshinweis. Nur nach Erlaubnis, jede Art einzeln.
 *
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

    private val readPermissions = mapOf(
        "nutrition" to HealthPermission.getReadPermission(NutritionRecord::class),
        "sleep" to HealthPermission.getReadPermission(SleepSessionRecord::class),
        "restingHeartRate" to HealthPermission.getReadPermission(RestingHeartRateRecord::class),
    )

    private fun readStatus(granted: Set<String>): JSObject = JSObject().apply {
        readPermissions.forEach { (type, permission) -> put(type, granted.contains(permission)) }
    }

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

    @PluginMethod
    fun checkReadPermissions(call: PluginCall) {
        val client = client() ?: return call.reject("Health Connect ist nicht verfügbar")
        scope.launch {
            try {
                call.resolve(readStatus(client.permissionController.getGrantedPermissions()))
            } catch (e: Exception) {
                call.reject("Berechtigungen nicht lesbar", null, e)
            }
        }
    }

    /** Erwartet: types = ["nutrition", "sleep", "restingHeartRate"] (Teilmenge). */
    @PluginMethod
    fun requestReadPermissions(call: PluginCall) {
        val client = client() ?: return call.reject("Health Connect ist nicht verfügbar")
        val types = call.getArray("types")?.toList<String>() ?: readPermissions.keys.toList()
        val wanted = types.mapNotNull { readPermissions[it] }.toSet()
        if (wanted.isEmpty()) return call.reject("Keine bekannte Datenart")
        scope.launch {
            try {
                val granted = client.permissionController.getGrantedPermissions()
                if (granted.containsAll(wanted)) {
                    call.resolve(readStatus(granted))
                    return@launch
                }
                val intent = PermissionController.createRequestPermissionResultContract().createIntent(context, wanted)
                activity.runOnUiThread { startActivityForResult(call, intent, "readPermissionsResult") }
            } catch (e: Exception) {
                call.reject("Berechtigungsdialog nicht verfügbar", null, e)
            }
        }
    }

    @ActivityCallback
    private fun readPermissionsResult(call: PluginCall?, result: ActivityResult) {
        if (call == null) return
        val client = client() ?: return call.reject("Health Connect ist nicht verfügbar")
        scope.launch {
            try {
                call.resolve(readStatus(client.permissionController.getGrantedPermissions()))
            } catch (e: Exception) {
                call.reject("Berechtigungen nicht lesbar", null, e)
            }
        }
    }

    /**
     * Tageswerte der letzten `days` Tage (1–30), nur für erlaubte Arten:
     * nutrition [{ day, proteinG, energyKcal }], sleep [{ day (Aufwachtag), minutes }], restingHeartRate [{ day, bpm }].
     * Schlaf wird von Mittag bis Mittag gezählt, damit eine Nacht nicht auf zwei Tage fällt.
     */
    @PluginMethod
    fun readDaily(call: PluginCall) {
        val client = client() ?: return call.reject("Health Connect ist nicht verfügbar")
        val days = (call.getInt("days") ?: 14).coerceIn(1, 30).toLong()
        scope.launch {
            try {
                val granted = client.permissionController.getGrantedPermissions()
                val today = LocalDate.now()
                val out = JSObject()
                if (granted.contains(readPermissions["nutrition"])) {
                    val groups = client.aggregateGroupByPeriod(
                        AggregateGroupByPeriodRequest(
                            metrics = setOf(NutritionRecord.PROTEIN_TOTAL, NutritionRecord.ENERGY_TOTAL),
                            timeRangeFilter = TimeRangeFilter.between(today.minusDays(days - 1).atStartOfDay(), today.plusDays(1).atStartOfDay()),
                            timeRangeSlicer = Period.ofDays(1),
                        ),
                    )
                    val list = JSArray()
                    for (g in groups) {
                        val protein = g.result[NutritionRecord.PROTEIN_TOTAL]?.inGrams
                        val energy = g.result[NutritionRecord.ENERGY_TOTAL]?.inKilocalories
                        if (protein == null && energy == null) continue
                        list.put(JSObject().apply {
                            put("day", g.startTime.toLocalDate().toString())
                            if (protein != null) put("proteinG", protein)
                            if (energy != null) put("energyKcal", energy)
                        })
                    }
                    out.put("nutrition", list)
                }
                if (granted.contains(readPermissions["sleep"])) {
                    val groups = client.aggregateGroupByPeriod(
                        AggregateGroupByPeriodRequest(
                            metrics = setOf(SleepSessionRecord.SLEEP_DURATION_TOTAL),
                            timeRangeFilter = TimeRangeFilter.between(today.minusDays(days).atTime(LocalTime.NOON), today.atTime(LocalTime.NOON)),
                            timeRangeSlicer = Period.ofDays(1),
                        ),
                    )
                    val list = JSArray()
                    for (g in groups) {
                        val minutes = g.result[SleepSessionRecord.SLEEP_DURATION_TOTAL]?.toMinutes() ?: continue
                        if (minutes <= 0) continue
                        list.put(JSObject().apply {
                            put("day", g.endTime.toLocalDate().toString())
                            put("minutes", minutes)
                        })
                    }
                    out.put("sleep", list)
                }
                if (granted.contains(readPermissions["restingHeartRate"])) {
                    val groups = client.aggregateGroupByPeriod(
                        AggregateGroupByPeriodRequest(
                            metrics = setOf(RestingHeartRateRecord.BPM_AVG),
                            timeRangeFilter = TimeRangeFilter.between(today.minusDays(days - 1).atStartOfDay(), today.plusDays(1).atStartOfDay()),
                            timeRangeSlicer = Period.ofDays(1),
                        ),
                    )
                    val list = JSArray()
                    for (g in groups) {
                        val bpm = g.result[RestingHeartRateRecord.BPM_AVG] ?: continue
                        list.put(JSObject().apply {
                            put("day", g.startTime.toLocalDate().toString())
                            put("bpm", bpm)
                        })
                    }
                    out.put("restingHeartRate", list)
                }
                call.resolve(out)
            } catch (e: Exception) {
                call.reject("Lesen aus Health Connect fehlgeschlagen: ${e.message}", null, e)
            }
        }
    }
}
