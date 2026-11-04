package dev.appdyno.fixture

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp

class ComposeActivity : ComponentActivity() {
    @OptIn(ExperimentalComposeUiApi::class)
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            var value by remember { mutableStateOf("") }
            var saved by remember { mutableStateOf("") }
            Column(Modifier.fillMaxSize().padding(16.dp)) {
                Text("Compose screen", Modifier.testTag("compose_title").padding(top = 32.dp))
                TextField(value = value, onValueChange = { value = it }, label = { Text("Not") }, modifier = Modifier.testTag("compose_input"))
                Button(onClick = { saved = value }, modifier = Modifier.testTag("compose_save")) { Text("Save") }
                Text(if (saved.isEmpty()) "Nothing saved" else "Saved: $saved", Modifier.testTag("compose_result"))
                LazyColumn(Modifier.testTag("compose_list")) {
                    items(50) { i -> Text("Row ${i + 1}", Modifier.testTag("row_$i").padding(12.dp)) }
                }
            }
        }
    }
}
