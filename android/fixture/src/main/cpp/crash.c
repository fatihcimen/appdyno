#include <jni.h>

/* Static, so that a stripped library has no name for it: what only a symbol file can give a tombstone. */
__attribute__((noinline)) static void fixture_native_crash(volatile int *where) { *where = 1; }

JNIEXPORT void JNICALL Java_dev_appdyno_fixture_Native_crash(JNIEnv *env, jclass type) {
    fixture_native_crash(0);
}
