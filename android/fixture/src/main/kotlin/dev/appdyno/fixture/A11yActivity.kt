package dev.appdyno.fixture

import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Text
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/**
 * Known accessibility problems, one of each, for the audit's device tests: faint text, a small target, an
 * unnamed icon button, a faint icon, two buttons read alike, text cut by its frame, ellipsized text (a
 * view's and Compose's), and a price read before the name above it (a traversal hint: the platform sorts
 * a view's children by place). "Continue" has none of them.
 */
class A11yActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val density = resources.displayMetrics.density
        fun px(v: Int) = (v * density).toInt()
        val white = android.graphics.Color.WHITE
        column {
            setBackgroundColor(white)
            label("Accessibility", R.id.title).setTextColor(android.graphics.Color.BLACK)
            label("Faint text", R.id.a11y_faint).setTextColor(android.graphics.Color.parseColor("#C8C8C8"))
            addView(View(context).apply {
                id = R.id.a11y_small
                contentDescription = "Small"
                setBackgroundColor(android.graphics.Color.parseColor("#1F3A93"))
                setOnClickListener {}
            }, LinearLayout.LayoutParams(px(24), px(24)))
            addView(android.widget.ImageButton(context).apply {
                id = R.id.a11y_icon
                setImageResource(android.R.drawable.ic_input_add)
                setOnClickListener {}
            }, LinearLayout.LayoutParams(px(56), px(56)))
            addView(android.widget.ImageView(context).apply {
                id = R.id.a11y_faint_icon
                contentDescription = "Faint icon"
                setImageDrawable(android.graphics.drawable.InsetDrawable(
                    android.graphics.drawable.GradientDrawable().apply {
                        shape = android.graphics.drawable.GradientDrawable.OVAL
                        setColor(android.graphics.Color.parseColor("#E2E2E2"))
                    },
                    px(12),
                ))
                setOnClickListener {}
            }, LinearLayout.LayoutParams(px(48), px(48)))
            button("Add", R.id.a11y_add_1) {}
            button("Add", R.id.a11y_add_2) {}
            // three lines of text in a frame one line tall
            addView(TextView(context).apply {
                id = R.id.a11y_cut
                text = "This text is too long for its frame and its lower lines do not show"
                textSize = 16f
                setTextColor(android.graphics.Color.BLACK)
            }, LinearLayout.LayoutParams(px(160), px(24)))
            addView(TextView(context).apply {
                id = R.id.a11y_ellipsized
                text = "Unmissable Prices and Deals of the Week"
                textSize = 16f
                maxLines = 1
                ellipsize = android.text.TextUtils.TruncateAt.END
                setTextColor(android.graphics.Color.BLACK)
            }, LinearLayout.LayoutParams(px(120), ViewGroup.LayoutParams.WRAP_CONTENT))
            addView(androidx.compose.ui.platform.ComposeView(context).apply {
                setContent {
                    // in a column: the view's exact width would override the text's own
                    Column {
                        Text(
                            "A very long product name in Compose is cut here",
                            maxLines = 1,
                            overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                            modifier = Modifier.width(120.dp),
                        )
                    }
                }
            })
            // the card's price is read first (a traversal hint), though it sits below the name
            addView(android.widget.FrameLayout(context).apply {
                id = R.id.a11y_card
                addView(TextView(context).apply {
                    id = R.id.a11y_price
                    text = "24,90 TL"
                    accessibilityTraversalBefore = R.id.a11y_name
                    setTextColor(android.graphics.Color.BLACK)
                }, android.widget.FrameLayout.LayoutParams(-2, -2).apply { topMargin = px(32) })
                addView(TextView(context).apply {
                    id = R.id.a11y_name
                    text = "Ayran 1 L"
                    setTextColor(android.graphics.Color.BLACK)
                }, android.widget.FrameLayout.LayoutParams(-2, -2))
            }, LinearLayout.LayoutParams(px(200), px(64)))
            button("Continue", R.id.a11y_ok) {}
        }
    }
}
