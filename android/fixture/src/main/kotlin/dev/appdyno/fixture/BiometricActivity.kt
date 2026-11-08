package dev.appdyno.fixture

import android.app.Activity
import android.os.Build
import android.os.Bundle

/** Asks for a fingerprint and says what came back: what `device_setting biometric` answers. */
class BiometricActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT < 28) {
            column { label("Biometric prompts need Android 9 or later.", R.id.result) }
            return
        }
        column {
            val result = label("Not asked", R.id.result)
            button("Authenticate", R.id.authenticate) {
                android.hardware.biometrics.BiometricPrompt.Builder(context)
                    .setTitle("Fixture sign-in")
                    .setNegativeButton("Cancel", mainExecutor) { _, _ -> result.text = "Cancelled" }
                    .build()
                    .authenticate(
                        android.os.CancellationSignal(),
                        mainExecutor,
                        object : android.hardware.biometrics.BiometricPrompt.AuthenticationCallback() {
                            override fun onAuthenticationSucceeded(
                                r: android.hardware.biometrics.BiometricPrompt.AuthenticationResult?,
                            ) {
                                result.text = "Authenticated"
                            }

                            override fun onAuthenticationFailed() {
                                result.text = "Not recognized"
                            }

                            override fun onAuthenticationError(code: Int, message: CharSequence?) {
                                result.text = "Error: $message"
                            }
                        },
                    )
            }
        }
    }
}
