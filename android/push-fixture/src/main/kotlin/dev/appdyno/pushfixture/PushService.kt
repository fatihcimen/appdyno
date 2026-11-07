package dev.appdyno.pushfixture

import android.util.Log
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/** What Firebase Messaging hands the app's code, one line a message, for the push suite to read from logcat. */
class PushService : FirebaseMessagingService() {
    override fun onMessageReceived(message: RemoteMessage) {
        val data = message.data.toSortedMap().entries.joinToString(",") { "${it.key}=${it.value}" }
        val shown = message.notification?.let { "${it.title}|${it.body}|${it.imageUrl ?: ""}" } ?: "none"
        Log.i(
            TAG,
            "onMessageReceived id=${message.messageId} from=${message.from} collapse=${message.collapseKey} " +
                "priority=${message.priority} data=$data notification=$shown",
        )
    }

    companion object {
        const val TAG = "PushFixture"
    }
}
