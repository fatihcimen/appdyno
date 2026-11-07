package dev.appdyno.agent

import android.content.res.Configuration
import android.os.LocaleList

/**
 * The whole device's languages, set as Settings sets them: the system keeps them (`persist.sys.locale`), so they
 * outlive this process and a reboot. Shell holds what the call asks for, CHANGE_CONFIGURATION and WRITE_SETTINGS.
 */
object Locales {
    private val activities by lazy { Platform.asInterface("android.app.IActivityManager\$Stub", Platform.service("activity")) }

    /** Language tags, most preferred first: `tr-TR,en-US`. */
    fun get(): String = configuration().locales.toLanguageTags()

    fun set(tags: String): String {
        val c = configuration()
        c.setLocales(LocaleList.forLanguageTags(tags))
        // what tells the system a person chose it, and makes it keep the choice
        Configuration::class.java.getField("userSetLocale").setBoolean(c, true)
        try {
            Platform.callByTypes(activities, "updatePersistentConfigurationWithAttribution", c, SHELL)
        } catch (_: AgentFailure) {
            // before Android 12 the call names no caller
            Platform.callByTypes(activities, "updatePersistentConfiguration", c)
        }
        return get()
    }

    private fun configuration() = Platform.callByTypes(activities, "getConfiguration") as Configuration

    private const val SHELL = "com.android.shell"
}
