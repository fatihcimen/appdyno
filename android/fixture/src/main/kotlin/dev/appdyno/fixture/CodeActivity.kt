package dev.appdyno.fixture

import android.app.Activity
import android.os.Bundle
import android.text.InputType
import android.view.ViewGroup
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView

/**
 * A code entry as login screens build it: four one-character fields, the next one focused after each
 * digit; the code so far is shown below. A code set into the first field at once does not fit.
 */
class CodeActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        column {
            label("Verification code")
            val result = TextView(context).apply { id = R.id.result }
            val boxes = mutableListOf<EditText>()
            val row = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL }
            for (i in 0 until 4) {
                val box = EditText(context).apply {
                    tag = "code_box_$i"
                    contentDescription = if (i == 0) "Code" else null
                    inputType = InputType.TYPE_CLASS_NUMBER
                    filters = arrayOf(android.text.InputFilter.LengthFilter(1))
                    layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
                }
                box.addTextChangedListener(object : android.text.TextWatcher {
                    override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
                    override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
                    override fun afterTextChanged(e: android.text.Editable?) {
                        result.text = "Code: " + boxes.joinToString("") { it.text.toString() }
                        if (!e.isNullOrEmpty() && i < 3) boxes[i + 1].requestFocus()
                    }
                })
                boxes.add(box)
                row.addView(box)
            }
            addView(row)
            addView(result)
            boxes[0].requestFocus()
        }
    }
}
