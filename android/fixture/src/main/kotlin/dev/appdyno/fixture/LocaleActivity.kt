package dev.appdyno.fixture

import android.app.Activity
import android.os.Bundle

/** The language this launch runs in, as an app is told it. */
class LocaleActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        column { label("language: ${resources.configuration.locales[0].toLanguageTag()}", R.id.result) }
    }
}
