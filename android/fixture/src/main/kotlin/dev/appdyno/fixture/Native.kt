package dev.appdyno.fixture

object Native {
    init { System.loadLibrary("fixture_native") }

    external fun crash()
}
