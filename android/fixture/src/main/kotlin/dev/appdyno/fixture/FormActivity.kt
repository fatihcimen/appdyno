package dev.appdyno.fixture

import android.app.Activity
import android.os.Bundle
import android.text.InputType
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView

class FormActivity : Activity() {
    // a device's password manager would offer to save the form over the next screens, importance flags or not
    override fun onPause() {
        getSystemService(android.view.autofill.AutofillManager::class.java)?.cancel()
        super.onPause()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        column {
            label("Enter your details")
            val name = EditText(context).apply { id = R.id.name_input; hint = "Your name"; addView(this) }
            EditText(context).apply {
                id = R.id.phone_input
                hint = "Phone"
                inputType = InputType.TYPE_CLASS_PHONE
                addView(this)
            }
            // a text-input layout as Material draws one: a label above the field and helper text below,
            // so the layout's middle is not on its field (a tap there focuses nothing)
            LinearLayout(context).apply {
                id = R.id.gsm_layout
                orientation = LinearLayout.VERTICAL
                TextView(context).apply { text = "Mobile phone"; addView(this) }
                EditText(context).apply {
                    id = R.id.gsm_input
                    inputType = InputType.TYPE_CLASS_PHONE
                    addView(this)
                }
                TextView(context).apply {
                    text = "We will reach you at this number"
                    minHeight = 240
                    addView(this)
                }
                this@column.addView(this)
            }
            EditText(context).apply {
                id = R.id.password_input
                hint = "Password"
                inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
                addView(this)
            }
            val result = TextView(context)
            button("Send", R.id.submit) { result.text = "Sent: ${name.text}" }
            result.id = R.id.result
            addView(result)
        }
    }
}
