package dev.appdyno.fixture

import android.app.Activity
import android.os.Bundle
import android.widget.LinearLayout
import android.widget.RadioButton
import android.widget.TextView
import com.google.android.material.bottomsheet.BottomSheetDialog

/**
 * A page under a Material bottom sheet that opens with it, as an app asks for a choice as it starts: the sheet's own
 * window holds the screen, and what is under it is in no read until it closes.
 */
class SheetActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        lateinit var result: TextView
        column {
            label("Plans", R.id.title)
            button("Next", R.id.next_button) { result.text = "Next tapped" }
            result = label("", R.id.result)
        }
        BottomSheetDialog(this, com.google.android.material.R.style.Theme_MaterialComponents_Light_BottomSheetDialog).apply {
            setContentView(
                LinearLayout(context).apply {
                    orientation = LinearLayout.VERTICAL
                    setPadding(48, 48, 48, 48)
                    label("Choose a plan")
                    for (plan in listOf("Basic plan", "Full plan")) {
                        addView(
                            RadioButton(context).apply {
                                text = plan
                                setOnClickListener {
                                    result.text = "Chosen: $plan"
                                    dismiss()
                                }
                            },
                        )
                    }
                    button("Compare plans") { }
                },
            )
            show()
        }
    }
}
