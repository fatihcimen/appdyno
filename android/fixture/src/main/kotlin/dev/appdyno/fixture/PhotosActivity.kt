package dev.appdyno.fixture

import android.os.Bundle
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts.PickMultipleVisualMedia
import androidx.activity.result.contract.ActivityResultContracts.PickVisualMedia

/** The system's photo picker, which asks no permission: how many photos and videos were picked from the library. */
class PhotosActivity : ComponentActivity() {
    private lateinit var picked: TextView
    private val pick = registerForActivityResult(PickMultipleVisualMedia()) { uris ->
        picked.text = "Picked: ${uris.size}"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        column {
            button("Pick photos", R.id.pick_photos) {
                pick.launch(PickVisualMediaRequest(PickVisualMedia.ImageAndVideo))
            }
            picked = label("Picked: none", R.id.picked)
        }
    }
}
