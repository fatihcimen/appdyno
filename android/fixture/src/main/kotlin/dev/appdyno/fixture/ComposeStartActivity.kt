package dev.appdyno.fixture

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.ui.Modifier

/** A first frame of many controls: a start of known weight, all of it code a Compose app runs when it starts. */
class ComposeStartActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            Column(Modifier.fillMaxSize()) {
                repeat(150) { i -> Button(onClick = {}) { Text("Row ${i + 1}") } }
            }
        }
    }
}
