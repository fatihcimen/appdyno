package dev.appdyno.fixture

import android.app.Activity
import android.app.AlertDialog
import android.app.Dialog
import android.os.Bundle
import android.text.InputType
import android.view.WindowManager
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView

class DialogActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        column {
            val result = TextView(context)
            button("Open dialog", R.id.open_dialog) {
                AlertDialog.Builder(this@DialogActivity)
                    .setTitle("Emin misiniz?")
                    .setMessage("The basket will be emptied.")
                    .setPositiveButton("OK") { _, _ -> result.text = "Confirmed" }
                    .setNegativeButton("Cancel") { _, _ -> result.text = "Cancelled" }
                    .show()
            }
            // a sheet as a login builds one: its own window, the field focused and the keyboard asked for as it
            // opens (typing goes into it with no tap; seen: the focus not found there, the number lost)
            button("Dialog with field", R.id.open_field_dialog) {
                val field = EditText(this@DialogActivity).apply {
                    id = R.id.sheet_input
                    hint = "Phone number"
                    inputType = InputType.TYPE_CLASS_PHONE
                }
                Dialog(this@DialogActivity).apply {
                    setContentView(LinearLayout(context).apply {
                        orientation = LinearLayout.VERTICAL
                        setPadding(48, 48, 48, 48)
                        addView(TextView(context).apply { text = "Enter your phone number" })
                        addView(field)
                    })
                    window?.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE)
                    setOnShowListener { field.requestFocus() }
                    show()
                }
            }
            // the same sheet on an app (or device) that answers nothing for 6 s before its field takes the focus:
            // a starved emulator froze 4 s while a login typed into its sheet, and the wait for the focus ran out
            button("Busy dialog", R.id.open_busy_dialog) {
                val field = EditText(this@DialogActivity).apply {
                    id = R.id.busy_input
                    hint = "Phone number"
                    inputType = InputType.TYPE_CLASS_PHONE
                }
                Dialog(this@DialogActivity).apply {
                    setContentView(field)
                    window?.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE)
                    show()
                }
                field.post {
                    Thread.sleep(6_000)
                    field.requestFocus()
                }
            }
            result.id = R.id.result
            addView(result)
        }
    }
}
