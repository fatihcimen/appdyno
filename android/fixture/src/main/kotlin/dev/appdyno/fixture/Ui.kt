package dev.appdyno.fixture

import android.app.Activity
import android.content.Context
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import java.io.File

/** The screen's views, one under another; `scroll`: in a ScrollView, so that what a small or turned screen leaves out is reached. */
internal fun Activity.column(scroll: Boolean = false, build: LinearLayout.() -> Unit): LinearLayout = LinearLayout(this).apply {
    orientation = LinearLayout.VERTICAL
    setPadding(32, 96, 32, 32)
    build()
    setContentView(if (scroll) ScrollView(context).also { it.addView(this) } else this)
}

internal fun LinearLayout.label(text: String, viewId: Int = View.NO_ID) = TextView(context).apply {
    this.text = text
    textSize = 18f
    id = viewId
    addView(this)
}

internal fun LinearLayout.button(text: String, viewId: Int = View.NO_ID, onClick: () -> Unit) = Button(context).apply {
    this.text = text
    id = viewId
    setOnClickListener { onClick() }
    addView(this)
}

/** A number a test wrote into the app's files, as a known cost; absent, none. */
internal fun Context.costMs(name: String) = File(filesDir, name).takeIf { it.exists() }?.readText()?.trim()?.toLongOrNull()
